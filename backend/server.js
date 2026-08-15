const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { Buffer } = require('buffer');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In-memory cache for GitHub API responses
const cache = new Map();
const CACHE_TTL = 300 * 1000; // 5 minutes in milliseconds

// Helper function to fetch from GitHub, handling authentication
async function fetchFromGitHub(url, token) {
    // --- CRITICAL FIX: Include the token in the cache key for user-specific data ---
    const cacheKey = `${url}::${token}`; // User A's data is now keyed separately from User B's data
    // -------------------------------------------------------------------------------
    
    if (cache.has(cacheKey) && (Date.now() - cache.get(cacheKey).timestamp < CACHE_TTL)) {
        console.log(`[BACKEND TRACE] Cache HIT for URL: ${url}`);
        return cache.get(cacheKey).data;
    }

    const headers = token ? { 'Authorization': `token ${token}` } : {};
    const response = await fetch(url, { headers });

    if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}.`);
    }

    const data = await response.json();
    cache.set(cacheKey, { data, timestamp: Date.now() });
    console.log(`[BACKEND TRACE] Cache MISS, fetched from GitHub: ${url}`);
    return data;
}

// --------------------------------------------------------------------------
// CRITICAL LFS HELPER FUNCTION: Fetches the actual binary LFS file content
// --------------------------------------------------------------------------
async function fetchLFSContent(githubRepo, githubToken, lfsPointerContent) {
    console.log(`[BACKEND TRACE - LFS] Starting LFS fetch for repo: ${githubRepo}`);

    // 1. Parse the OID and Size from the LFS pointer
    const lines = lfsPointerContent.split('\n');
    let oid = '';
    let size = 0;

    for (const line of lines) {
        if (line.startsWith('oid sha256:')) {
            oid = line.substring('oid sha256:'.length).trim();
        } else if (line.startsWith('size ')) {
            size = parseInt(line.substring('size '.length).trim(), 10);
        }
    }

    if (!oid || size === 0) {
        console.error('[BACKEND ERROR - LFS] Failed to parse LFS pointer:', lfsPointerContent);
        throw new Error('Invalid LFS pointer content.');
    }

    console.log(`[BACKEND TRACE - LFS] Parsed OID: ${oid}, Size: ${size}`);

    // 2. Construct the LFS Batch API URL
    const parts = githubRepo.split('/');
    const owner = parts[0];
    const repoName = parts[1];
    const lfsApiUrl = `https://github.com/${owner}/${repoName}.git/info/lfs/objects/batch`;
    
    console.log(`[BACKEND TRACE - LFS] LFS Batch API URL: ${lfsApiUrl}`);

    const lfsPayload = {
        operation: 'download',
        transfers: ['basic'],
        objects: [{ oid: oid, size: size }],
    };

    const headers = {
        'Accept': 'application/vnd.git-lfs+json',
        'Content-Type': 'application/vnd.git-lfs+json',
        'Authorization': `token ${githubToken}`,
    };

    // 3. Request download link from LFS Batch API
    const batchResponse = await fetch(lfsApiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(lfsPayload),
    });

    console.log(`[BACKEND TRACE - LFS] Batch API Response Status: ${batchResponse.status}`);

    if (!batchResponse.ok) {
        const errorText = await batchResponse.text();
        console.error(`[BACKEND ERROR - LFS] LFS Batch API failed: ${batchResponse.status}`, errorText);
        throw new Error(`LFS Batch API failed with status ${batchResponse.status}`);
    }

    const batchData = await batchResponse.json();
    const object = batchData.objects[0];
    
    if (!object || !object.actions || !object.actions.download) {
        throw new Error('LFS object download link not provided by the batch API.');
    }

    const downloadUrl = object.actions.download.href;
    const downloadHeaders = object.actions.download.header || {};
    
    console.log(`[BACKEND TRACE - LFS] LFS Download URL received: ${downloadUrl}`);

    // 4. Download the actual binary content
    const finalDownloadResponse = await fetch(downloadUrl, {
        method: 'GET',
        headers: downloadHeaders,
    });

    console.log(`[BACKEND TRACE - LFS] Final Download Response Status: ${finalDownloadResponse.status}`);

    if (!finalDownloadResponse.ok) {
        const errorText = await finalDownloadResponse.text();
        console.error(`[BACKEND ERROR - LFS] Final LFS download failed: ${finalDownloadResponse.status}`, errorText);
        throw new Error(`Failed to download LFS content with status ${finalDownloadResponse.status}`);
    }

    // Return the raw response, allowing the caller to handle it as a blob/buffer
    console.log(`[BACKEND TRACE - LFS] Successfully retrieved LFS content. Returning raw response.`);
    return finalDownloadResponse;
}

// Endpoint to fetch a file's content (handles LFS and CSV)
app.post('/api/fetch-file', async (req, res) => {
    const { githubToken, githubRepo, filePath, githubDefaultBranch } = req.body;
    
    console.log(`\n--- [BACKEND TRACE] /api/fetch-file received request for: ${filePath} ---`);

    if (!githubToken || !githubRepo || !filePath) {
        return res.status(400).json({ error: 'Missing required parameters.' });
    }

    try {
        const url = `https://api.github.com/repos/${githubRepo}/contents/${filePath}?ref=${githubDefaultBranch}`;
        
        console.log(`[BACKEND TRACE] GitHub Content API URL: ${url}`);
        
        const fileMetadata = await fetchFromGitHub(url, githubToken);
        
        // 1. Check if the file is a standard file (content is base64 encoded)
        if (fileMetadata.content && fileMetadata.encoding === 'base64') {
            const fileContent = Buffer.from(fileMetadata.content, 'base64').toString('utf8');
            
            // 2. Check if the file is an LFS pointer (starts with 'version')
            if (fileContent.startsWith('version https://git-lfs.github.com/spec/v1')) {
                console.log(`[BACKEND TRACE] File is an LFS pointer. Delegating to LFS handler.`);
                
                // CRITICAL: Call the LFS handler to get the raw binary response
                const lfsResponse = await fetchLFSContent(githubRepo, githubToken, fileContent);

                // Set headers based on the LFS response and pipe the data
                res.setHeader('Content-Type', lfsResponse.headers.get('Content-Type') || 'application/octet-stream');
                res.setHeader('Content-Length', lfsResponse.headers.get('Content-Length'));
                
                console.log(`[BACKEND TRACE] Responding with LFS binary data. Content-Type: ${lfsResponse.headers.get('Content-Type')}`);
                lfsResponse.body.pipe(res);
                return;
            }	
            // 3. Handle standard files (like CSVs)
            else {
                console.log(`[BACKEND TRACE] File is a standard file (CSV/small image). Sending text content.`);
                res.status(200).send(fileContent);
                return;
            }
        }	
        // 4. Handle files that are too big for the standard API but aren't LFS (shouldn't happen for images/CSVs)
        else if (fileMetadata.type === 'file' && !fileMetadata.content) {
             console.error(`[BACKEND ERROR] File content is missing or too large for standard API, and not an LFS pointer: ${filePath}`);
             throw new Error(`File is too large or content is not available via standard API. Check LFS setup.`);
        }
        else {
            console.error(`[BACKEND ERROR] Unexpected file metadata structure:`, fileMetadata);
            throw new Error('Could not retrieve file content or unexpected file type.');
        }

    } catch (error) {
        console.error(`[BACKEND ERROR] Failed to fetch file ${filePath}:`, error.message);
        res.status(500).json({ error: error.message });
    }
});


// Endpoint to fetch user repositories
app.post('/api/get-repos', async (req, res) => {
    const { githubToken } = req.body;
    if (!githubToken) {
        return res.status(400).json({ error: 'GitHub token is required.' });
    }

    try {
        const userResponse = await fetchFromGitHub('https://api.github.com/user', githubToken);
        const username = userResponse.login;

        // Fetch repositories (including private ones)
        const reposResponse = await fetchFromGitHub(`https://api.github.com/user/repos?type=all&per_page=100`, githubToken);
        const repos = reposResponse
            .filter(repo => !repo.fork) // Exclude forks for cleaner list
            .map(repo => repo.full_name);

        res.status(200).json({ username, repos });
    } catch (error) {
        console.error('[BACKEND ERROR] Error getting repositories:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to fetch all files and directories in a repository
app.post('/api/get-files', async (req, res) => {
    const { githubToken, githubRepo } = req.body;

    if (!githubToken || !githubRepo) {
        return res.status(400).json({ error: 'Missing required parameters.' });
    }

    try {
        const repoDetails = await fetchFromGitHub(`https://api.github.com/repos/${githubRepo}`, githubToken);
        const defaultBranch = repoDetails.default_branch;

        const treeData = await fetchFromGitHub(`https://api.github.com/repos/${githubRepo}/git/trees/${defaultBranch}?recursive=1`, githubToken);
        
        if (!treeData.tree) {
             console.error('[BACKEND ERROR] Tree data missing for repo:', githubRepo);
             return res.status(404).json({ error: 'Repository tree not found.' });
        }

        const files = treeData.tree.map(item => item.path);

        res.status(200).json({ files, defaultBranch });
    } catch (error) {
        console.error('[BACKEND ERROR] Error getting file tree:', error.message);
        res.status(500).json({ error: error.message });
    }
});


// Endpoint to upload the review data to GitHub
app.post('/api/upload-file', async (req, res) => {
    const { githubToken, githubRepo, path, content, message } = req.body;

    const url = `https://api.github.com/repos/${githubRepo}/contents/${path}`;
    const encodedContent = Buffer.from(content).toString('base64');
    
    console.log(`[BACKEND TRACE] Starting upload of file to: ${url}`);

    try {
        let sha = null;
        try {
            // Check if file exists to get SHA for update
            const getResponse = await fetch(url, { headers: { 'Authorization': `token ${githubToken}` } });
            if (getResponse.ok) {
                const fileData = await getResponse.json();
                sha = fileData.sha;
                console.log(`[BACKEND TRACE] File exists, SHA found: ${sha}`);
            }
        } catch (error) {
            console.log(`[BACKEND TRACE] File does not exist, creating new file.`);
            // File doesn't exist, will create it.
        }

        const payload = { message, content: encodedContent, sha };
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `token ${githubToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error(`[BACKEND ERROR] GitHub upload failed: ${response.status}`, errorData);
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}. Message: ${errorData.message}`);
        }

        console.log(`[BACKEND TRACE] File uploaded successfully.`);
        res.status(200).json({ message: 'File uploaded successfully.' });
    } catch (error) {
        console.error('[BACKEND ERROR] Error uploading file:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Bind to 0.0.0.0 for stability in container environments like Render
app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening at http://0.0.0.0:${port}`);
});
