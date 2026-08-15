// Global variables for state management
let githubToken = '';
let githubUsername = '';
let githubRepo = '';
let githubDefaultBranch = 'main'; // Default to 'main'
let csvPath = '';
let imagesPath = '';
let casesData = [];
let sampleCases = [];
let currentCaseIndex = 0;
let reviewResults = [];
let timerStart = 0;
let timerInterval = null;
let aiAccuracy = 50;
let isAiEnabled = false;
let totalTime = 0; // ADDED: Global variable to track total time
let aiLiePattern = null; // NEW: Holds the fixed pattern for AI lies/truth
let lockdownTrial = null; // NEW: Tracks which lockdown trial is active

// Image Viewer State
let canvas = null;
let canvasContainer = null;
let context = null;
let imageElement = null; // Only used for standard (non-DICOM) images
let imageState = {
    scale: 1,
    x: 0,
    y: 0,
    // Contrast/Brightness State (0-255 for standard images)
    min: 0,
    max: 255
};
let isPanning = false;
let isAdjustingContrast = false;
let lastX = 0;
let lastY = 0;

// UI Elements
const appHeader = document.getElementById('app-header');
const patSection = document.getElementById('pat-section');
const repoSelectionSection = document.getElementById('repo-selection-section');
const aiSection = document.getElementById('ai-section');
const reviewSection = document.getElementById('review-section');
const reportSection = document.getElementById('report-section');
const connectBtn = document.getElementById('connect-btn');
const loadDataBtn = document.getElementById('load-data-btn');
const startReviewBtn = document.getElementById('start-review-btn');
const presentBtn = document.getElementById('present-btn');
const notPresentBtn = document.getElementById('not-present-btn');
const uploadBtn = document.getElementById('upload-btn'); 
const goHomeBtn = document.getElementById('go-home-btn'); 

const lockdownTrial1Btn = document.getElementById('lockdown-trial-1-btn');
const lockdownTrial2Btn = document.getElementById('lockdown-trial-2-btn');
const lockdownTrial3Btn = document.getElementById('lockdown-trial-3-btn');
const lockdownResetBtn = document.getElementById('lockdown-reset-btn');

const githubPatInput = document.getElementById('github-pat');
const githubRepoSelect = document.getElementById('github-repo-select');
const csvPathSelect = document.getElementById('csv-path-select');
const imagesPathSelect = document.getElementById('images-path-select');
const caseCounterSpan = document.getElementById('case-counter');
const totalCasesSpan = document.getElementById('total-cases');
const timerSpan = document.getElementById('timer');
const aiEnabledCheckbox = document.getElementById('ai-enabled');
const aiControlsContainer = document.getElementById('ai-controls-container');
const aiAccuracyInput = document.getElementById('ai-accuracy');
const accuracyValueSpan = document.getElementById('accuracy-value');
const sampleSizeInput = document.getElementById('sample-size');
const githubUsernameSpan = document.getElementById('github-username');
const finalStatsSummary = document.getElementById('final-stats-summary'); 

const imageViewerContainer = document.getElementById('image-viewer-container');
const aiSuggestionBox = document.getElementById('ai-suggestion-box');
const aiSuggestionText = document.getElementById('ai-suggestion-text');
const aiDelayText = document.getElementById('ai-delay-text');
const reportAiAccuracyDisplay = document.getElementById('report-ai-accuracy-display');
const aiPanelColumn = document.getElementById('ai-panel-column'); 

const statusMessage = document.getElementById('status-message');

const reportReviewedCount = document.getElementById('report-reviewed-count');
const reportTotalTime = document.getElementById('report-total-time');
const reportUserAccuracy = document.getElementById('report-user-accuracy');
const reportAiEnabled = document.getElementById('report-ai-enabled');
const reportGithubUsername = document.getElementById('report-github-username');
const reportUploadPath = document.getElementById('report-upload-path');


// Backend URL
// Points at the hosted backend. Change this if running your own instance.
const backendUrl = 'https://datalink-dicom-backend.onrender.com';


canvas = document.getElementById('imageCanvas');
canvasContainer = document.getElementById('image-viewer-container');
context = canvas.getContext('2d');

const resizeCanvas = () => {
    const rect = canvasContainer.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width;
        canvas.height = rect.height;
        if (imageElement) drawImage(); 
    } else {
        canvas.width = canvas.width || 1; 
        canvas.height = canvas.height || 1;
    }
};
window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // Initial call will likely set to 0x0, which is fine for now

// Image viewer event listeners (for standard image zoom/pan/contrast)
canvas.addEventListener('mousedown', (e) => {
    if (!imageElement) return;

    if (e.button === 0) { // Left click for pan
        isPanning = true;
        isAdjustingContrast = false;
    } else if (e.button === 2) { // Right click for contrast
        isAdjustingContrast = true;
        isPanning = false;
    }
    lastX = e.clientX;
    lastY = e.clientY;
});

canvas.addEventListener('mousemove', (e) => {
    if (!imageElement) return;

    if (isPanning) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        imageState.x += dx;
        imageState.y += dy;
        lastX = e.clientX;
        lastY = e.clientY;
        drawImage();
    } else if (isAdjustingContrast) {
        const dy = e.clientY - lastY;
        const sensitivity = 1.5; 
        const delta = dy * sensitivity;
        
        // Simple contrast adjustment (adjusting min/max equally in opposite directions)
        imageState.min = Math.max(0, imageState.min + delta);
        imageState.max = Math.min(255, imageState.max - delta); 

        if (imageState.max <= imageState.min) {
            const center = (imageState.max + imageState.min) / 2;
            imageState.max = center + 1;
            imageState.min = center - 1;
        }

        lastX = e.clientX;
        lastY = e.clientY;
        drawImage();
    }
});

canvas.addEventListener('mouseup', () => {
    isPanning = false;
    isAdjustingContrast = false;
});

// Zoom toward the cursor rather than the canvas center.
canvas.addEventListener('wheel', (e) => {
    if (!imageElement) return;

    e.preventDefault();
    const rect = canvas.getBoundingClientRect();

    // 1. Get Mouse Position (relative to canvas)
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 2. Calculate scale factor and new scale
    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1; // 0.9 = zoom out, 1.1 = zoom in
    const newScale = imageState.scale * scaleFactor;
    const alpha = newScale / imageState.scale; // ratio of new scale to old scale

    // Recalculate fitted image center/dimensions (must match drawImage)
    const imgAspect = imageElement.width / imageElement.height;
    const canvasAspect = canvas.width / canvas.height;
    let baseDrawWidth, baseDrawHeight;

    if (imgAspect > canvasAspect) {
        baseDrawWidth = canvas.width;
        baseDrawHeight = canvas.width / imgAspect;
    } else {
        baseDrawHeight = canvas.height;
        baseDrawWidth = canvas.height * imgAspect;
    }
    const initialX = (canvas.width - baseDrawWidth) / 2;
    const initialY = (canvas.height - baseDrawHeight) / 2;
    // The zoom center used in drawImage (for the central transform)
    const centerX = initialX + baseDrawWidth / 2;
    const centerY = initialY + baseDrawHeight / 2;
    
    // 3. Calculate pan adjustment
    // Dx is the distance from the mouse to the center of zoom (corrected for the current pan)
    // The pan adjustment needed (Delta P_x) = Dx * (1 - alpha)
    const Dx = mouseX - centerX - imageState.x;
    const Dy = mouseY - centerY - imageState.y;

    const panAdjustmentX = Dx * (1 - alpha);
    const panAdjustmentY = Dy * (1 - alpha);
    
    // 4. Update image state
    imageState.scale = newScale;
    imageState.x += panAdjustmentX;
    imageState.y += panAdjustmentY;

    drawImage();
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// UI Event Listeners 

connectBtn.addEventListener('click', async () => {
    githubToken = githubPatInput.value.trim();

    if (!githubToken) {
        showStatusMessage("Please enter your GitHub Personal Access Token.", 'error');
        return;
    }

    connectBtn.disabled = true;
    connectBtn.textContent = "Connecting...";

    try {
        // Use the backend to get user info and repos
        const reposResponse = await fetch(`${backendUrl}/api/get-repos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ githubToken })
        });

        if (!reposResponse.ok) {
            const errorData = await reposResponse.json();
            throw new Error(errorData.error);
        }

        const data = await reposResponse.json();
        githubUsername = data.username;
        const repos = data.repos;

        showStatusMessage(`Successfully connected as ${githubUsername}! Loading repositories...`, 'success');
        patSection.classList.add('hidden');
        repoSelectionSection.classList.remove('hidden');
        githubUsernameSpan.textContent = githubUsername;

        githubRepoSelect.innerHTML = '<option value="">-- Select a Repository --</option>';
        repos.forEach(repo => {
            const option = document.createElement('option');
            option.value = repo;
            option.textContent = repo;
            githubRepoSelect.appendChild(option);
        });

    } catch (error) {
        console.error('Error connecting to GitHub:', error);
        showStatusMessage(`Failed to connect: ${error.message}. Please check your PAT.`, 'error');
        connectBtn.disabled = false;
        connectBtn.textContent = "Connect";
    }
});

githubRepoSelect.addEventListener('change', async (event) => {
    const selectedRepo = event.target.value;
    if (selectedRepo) {
        githubRepo = selectedRepo;
        csvPathSelect.disabled = true;
        imagesPathSelect.disabled = true;
        loadDataBtn.disabled = true;
        csvPathSelect.innerHTML = '<option value="">-- Loading... --</option>';
        imagesPathSelect.innerHTML = '<option value="">-- Loading... --</option>';
        showStatusMessage("Fetching repository files...", 'info');

        try {
            const filesResponse = await fetch(`${backendUrl}/api/get-files`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ githubToken, githubRepo })
            });

            if (!filesResponse.ok) {
                const errorData = await filesResponse.json();
                throw new Error(errorData.error);
            }

            const data = await filesResponse.json();
            githubDefaultBranch = data.defaultBranch;
            const files = data.files;

            csvPathSelect.innerHTML = '<option value="">-- Select a CSV file --</option>';
            imagesPathSelect.innerHTML = '<option value="">-- Select an Image Directory --</option>';

            let bestMatchDir = '';
            let bestMatchScore = 0;
            let bestMatchCSV = '';
            let csvMatchScore = 0;
            const directories = new Set();

            files.forEach(item => {
                if (item.endsWith('.csv')) {
                    const option = document.createElement('option');
                    option.value = item;
                    option.textContent = item;
                    csvPathSelect.appendChild(option);

                    let score = 0;
                    if (item.includes('pneumothorax')) score += 3;
                    if (item.includes('labels')) score += 2;
                    if (item.includes('data')) score += 1;

                    if (score > csvMatchScore) {
                        csvMatchScore = score;
                        bestMatchCSV = item;
                    }
                }

                const dir = item.substring(0, item.lastIndexOf('/'));
                if (dir) {
                    directories.add(dir);

                    if (item.match(/\.(png|jpe?g|dcm|dicom)$/i)) {
                        let score = 0;
                        if (dir.includes('image')) score += 3;
                        if (dir.includes('png') || dir.includes('dicom')) score += 2;

                        if (score > bestMatchScore) {
                            bestMatchScore = score;
                            bestMatchDir = dir;
                        }
                    }
                }
            });

            directories.forEach(dir => {
                const option = document.createElement('option');
                option.value = dir;
                option.textContent = dir;
                imagesPathSelect.appendChild(option);
            });

            csvPathSelect.disabled = false;
            imagesPathSelect.disabled = false;

            if (bestMatchCSV) {
                csvPath = bestMatchCSV;
                csvPathSelect.value = bestMatchCSV;
            }
            if (bestMatchDir) {
                imagesPath = bestMatchDir;
                imagesPathSelect.value = bestMatchDir;
            }

            updateLoadButtonState();
            showStatusMessage("Files loaded. Please select a CSV and image directory.", 'success');

        } catch (error) {
            console.error("Failed to fetch repository contents:", error);
            showStatusMessage(`Failed to fetch repository contents: ${error.message}. Please ensure the repository is not empty and you have access.`, 'error');
        }
    }
});

csvPathSelect.addEventListener('change', () => {
    csvPath = csvPathSelect.value;
    updateLoadButtonState();
});

imagesPathSelect.addEventListener('change', () => {
    imagesPath = imagesPathSelect.value;
    updateLoadButtonState();
});

loadDataBtn.addEventListener('click', async () => {
    if (!githubRepo || !csvPath || !imagesPath) {
        showStatusMessage("Please select all required fields.", 'error');
        return;
    }

    loadDataBtn.disabled = true;
    loadDataBtn.textContent = "Loading...";
    showStatusMessage("Loading dataset... This may take a moment.", 'info');

    try {
        // Use the backend to get and parse the CSV data
        const csvResponse = await fetch(`${backendUrl}/api/fetch-file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                githubToken: githubToken,
                githubRepo: githubRepo,
                filePath: csvPath,
                githubDefaultBranch: githubDefaultBranch
            })
        });

        if (!csvResponse.ok) {
            const errorData = await csvResponse.json();
            throw new Error(`Backend error: ${errorData.error || 'Failed to fetch CSV file.'}`);
        }

        const csvText = await csvResponse.text();
        casesData = parseCSV(csvText);

        if (casesData.length === 0) {
            throw new Error("CSV file is empty or could not be parsed.");
        }

        showStatusMessage(`Successfully loaded ${casesData.length} cases. You can now select a sample size and start the review.`, 'success');
        repoSelectionSection.classList.add('hidden');
        aiSection.classList.remove('hidden');
        setTimeout(() => showStatusMessage('', 'clear'), 5000);
    } catch (error) {
        console.error('Error loading data:', error);
        showStatusMessage(`Failed to load data: ${error.message}`, 'error');
        loadDataBtn.disabled = false;
        loadDataBtn.textContent = "Load Dataset";
    }
});

startReviewBtn.addEventListener('click', () => {
    let sampleSize = parseInt(sampleSizeInput.value); // Get value
            
    if (lockdownTrial) {
        const requiredCases = 50 * lockdownTrial; // 50, 100, 150
        if (casesData.length < requiredCases) {
            showStatusMessage(`Lockdown Trial ${lockdownTrial} requires at least ${requiredCases} cases. You only have ${casesData.length}.`, 'error');
            return;
        }
        sampleSize = 50; // Lockdown size is always 50
    } else {
        if (isNaN(sampleSize) || sampleSize <= 0 || sampleSize > casesData.length) {
            showStatusMessage(`Please enter a valid sample size between 1 and ${casesData.length}.`, 'error');
            return;
        }
    }

    isAiEnabled = aiEnabledCheckbox.checked;
    aiAccuracy = parseInt(aiAccuracyInput.value);

    sampleCases = createRepresentativeSample(casesData, sampleSize);
    totalCasesSpan.textContent = sampleCases.length;
    currentCaseIndex = 0;
    reviewResults = [];
    totalTime = 0; // RESET TOTAL TIME

    // Initialize AI Panel settings
    reportAiAccuracyDisplay.textContent = `${aiAccuracy}%`;

    // Logic to show/hide the AI panel in the review section
    if (isAiEnabled) {
        aiPanelColumn.classList.remove('hidden');
    } else {
        aiPanelColumn.classList.add('hidden');
    }

    aiSection.classList.add('hidden');
    reviewSection.classList.remove('hidden'); 
    
    // Explicitly resize canvas after making the container visible
    resizeCanvas(); 

    // Hide app header when review starts
    if (appHeader) appHeader.classList.add('hidden');

    nextCase();
});

presentBtn.addEventListener('click', () => recordDecision(true));
notPresentBtn.addEventListener('click', () => recordDecision(false));

uploadBtn.addEventListener('click', async () => {
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Uploading...";
    showStatusMessage("Uploading results to GitHub...", 'info');

    const now = new Date();
    const timestamp = now.toISOString().replace(/T|:/g, '-').slice(0, -5);
    const uploadFileName = `review_data_${githubUsername}_${timestamp}.csv`;

    const csvContent = generateCSV(reviewResults);

    try {
        const response = await fetch(`${backendUrl}/api/upload-file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                githubToken,
                githubRepo,
                path: `results/${uploadFileName}`,
                content: csvContent,
                message: `Upload review data from ${githubUsername}`
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Backend error: ${response.status} ${response.statusText}. Message: ${errorData.message}`);
        }

        showStatusMessage("Successfully uploaded the review data to your GitHub repository!", 'success');
        uploadBtn.textContent = "Upload Complete!";
        uploadBtn.classList.add('bg-green-600', 'hover:bg-green-600');
    } catch (error) {
        console.error('Error uploading file:', error);
        showStatusMessage(`Failed to upload file to GitHub: ${error.message}`, 'error');
        uploadBtn.disabled = false;
        uploadBtn.textContent = "Upload to GitHub";
    }
});

if (lockdownTrial1Btn) {
    lockdownTrial1Btn.addEventListener('click', () => setLockdownTrial(1));
}
if (lockdownTrial2Btn) {
    lockdownTrial2Btn.addEventListener('click', () => setLockdownTrial(2));
}
if (lockdownTrial3Btn) {
    lockdownTrial3Btn.addEventListener('click', () => setLockdownTrial(3));
}
if (lockdownResetBtn) {
    lockdownResetBtn.addEventListener('click', resetLockdown);
}

if (goHomeBtn) {
    goHomeBtn.addEventListener('click', () => {
        // A simple page reload effectively returns the user to the initial state
        window.location.reload(); 
    });
}

aiEnabledCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
        aiControlsContainer.classList.remove('hidden');
    } else {
        aiControlsContainer.classList.add('hidden');
    }
});

aiAccuracyInput.addEventListener('input', () => {
    accuracyValueSpan.textContent = aiAccuracyInput.value;
});

function updateLoadButtonState() {
    if (githubRepoSelect.value && csvPathSelect.value && imagesPathSelect.value) {
        loadDataBtn.disabled = false;
    } else {
        loadDataBtn.disabled = true;
    }
}

// Main Logic Functions 
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length <= 1) return [];

    const header = lines[0].split(',').map(h => h.trim());

    const originalFilenameIndex = header.indexOf('original_filename');
    const pneumothoraxPresentIndex = header.indexOf('pneumothorax_present');

    if (originalFilenameIndex === -1 || pneumothoraxPresentIndex === -1) {
        throw new Error("CSV header must contain 'original_filename' and 'pneumothorax_present' columns.");
    }

    const data = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const row = {};

        row['file name'] = values[originalFilenameIndex];
        row['is disease present'] = values[pneumothoraxPresentIndex]?.toLowerCase() === 'yes' ? 'true' : 'false';

        header.forEach((h, i) => {
            if (i !== originalFilenameIndex && i !== pneumothoraxPresentIndex) {
                row[h] = values[i];
            }
        });

        return row;
    });
    return data;
}

function createRepresentativeSample(data, size) {
     // Lockdown trial mode takes precedence over normal sampling.
    if (lockdownTrial === 1) {
        // Trial 1: First 50 cases (index 0-49)
        return data.slice(0, 50);
    } else if (lockdownTrial === 2) {
        // Trial 2: Second 50 cases (index 50-99)
        return data.slice(50, 100);
    } else if (lockdownTrial === 3) {
        // Trial 3: Third 50 cases (index 100-149)
        return data.slice(100, 150);
    }

     // Check if the enforced setting is active (locked at 50)
    if (size === 50 && sampleSizeInput.getAttribute('max') === '50') {
        // If locked, simply return the first 50 cases, overriding the
        // representative sampling logic.
        return data.slice(0, 50);
    }
    
    // Original representative sampling logic for other sizes
    const positiveCases = data.filter(c => c['is disease present']?.toLowerCase() === 'true');
    const negativeCases = data.filter(c => c['is disease present']?.toLowerCase() === 'false');

    const positiveRatio = positiveCases.length / data.length;
    const negativeRatio = negativeCases.length / data.length;

    const numPositive = Math.round(size * positiveRatio);
    const numNegative = size - numPositive;

    const shuffledPositive = positiveCases.sort(() => 0.5 - Math.random());
    const shuffledNegative = negativeCases.sort(() => 0.5 - Math.random());

    const sample = shuffledPositive.slice(0, numPositive)
        .concat(shuffledNegative.slice(0, numNegative));

    return sample.sort(() => 0.5 - Math.random()); // Shuffle the final sample
}


async function nextCase() {
    if (currentCaseIndex >= sampleCases.length) {
        endReview();
        return;
    }

   const currentCase = sampleCases[currentCaseIndex];
    
    const fileName = currentCase['file name'];
    
    const normalizedImagesPath = imagesPath.replace(/^\/|\/$/g, '');
    const normalizedFileName = fileName.replace(/^\/|\/$/g, '');
    
    const filePath = `${normalizedImagesPath}/${normalizedFileName}`; 
    

    caseCounterSpan.textContent = currentCaseIndex + 1;
    
    presentBtn.disabled = notPresentBtn.disabled = true;
    presentBtn.textContent = "Loading...";
    notPresentBtn.textContent = "Loading...";
    showStatusMessage(`Loading case ${currentCaseIndex + 1}...`, 'info');

    try {
        await loadImageFromBackend(filePath); // Waits until the image is loaded and displayed
        
        timerStart = Date.now();
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            const elapsed = (Date.now() - timerStart) / 1000;
            timerSpan.textContent = `${elapsed.toFixed(1)}s`;
        }, 100);
        
        if (!isAiEnabled) {
            presentBtn.disabled = notPresentBtn.disabled = false;
        }

        presentBtn.textContent = "Disease Present";
        notPresentBtn.textContent = "Not Present";
        showStatusMessage(`Case ${currentCaseIndex + 1} loaded. Please make a decision.`, 'success');
        
        if (isAiEnabled) {
            aiSuggestionBox.classList.add('hidden');
            simulateAI(currentCase);
        }

    } catch (error) {
        console.error('Error loading image:', error);
        showStatusMessage(`Failed to load image for case ${currentCaseIndex + 1}: ${error.message}. Skipping this case.`, 'error');
        currentCaseIndex++; // Move to the next case
        nextCase(); // Try to load the next one
    }
}

// Fetches an image and dispatches to the DICOM or standard renderer.
async function loadImageFromBackend(filePath) {
    imageState.scale = 1;
    imageState.x = 0;
    imageState.y = 0;
    imageState.min = 0;
    imageState.max = 255;
    if (context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    if (typeof cornerstone !== 'undefined' && canvas.classList.contains('cornerstone-enabled-element')) {
        cornerstone.disable(canvas);
        canvas.classList.remove('cornerstone-enabled-element');
    }
    imageElement = null; // Clear standard image state

    try {
        const response = await fetch(`${backendUrl}/api/fetch-file`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                githubToken,
                githubRepo,
                filePath,
                githubDefaultBranch
            }),
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Backend error: ${response.status} ${response.statusText}. Could not retrieve file content.`);
        }

        const fileBlob = await response.blob();
        
        const isDicom = filePath.toLowerCase().endsWith('.dcm') || filePath.toLowerCase().endsWith('.dicom');

        if (isDicom) {
            await displayDicomImage(fileBlob);
        } else {
            await displayStandardImage(fileBlob);
        }

    } catch (error) {
        throw new Error(`Failed to fetch the image: ${error.message}.`);
    }
}

// Separate function to handle standard image display (PNG/JPG)
function displayStandardImage(fileBlob) {
    return new Promise((resolve, reject) => {
        const isImage = fileBlob.type.startsWith('image/') || fileBlob.type === 'application/octet-stream';

        if (isImage) {
            const imgUrl = URL.createObjectURL(fileBlob);
            imageElement = new Image();
            imageElement.onload = () => {
                resizeCanvas(); 
                drawImage(); // Use existing drawImage for standard canvas rendering
                URL.revokeObjectURL(imgUrl);
                resolve();
            };
            imageElement.onerror = () => {
                showStatusMessage("Failed to load image. The file might be corrupted.", 'error');
                reject(new Error("Image file failed to load."));
            };
            imageElement.src = imgUrl;
        } else {
            reject(new Error(`Unsupported file type received from backend: ${fileBlob.type}. Expected an image.`));
        }
    });
}


// Renders DICOM pixel data to canvas via Cornerstone.
async function displayDicomImage(fileBlob) {
    if (typeof cornerstone === 'undefined' || typeof cornerstoneWADOImageLoader === 'undefined') {
        throw new Error("Cornerstone libraries are not loaded. Cannot display DICOM.");
    }
    
    try {
        cornerstone.enable(canvas);
        canvas.classList.add('cornerstone-enabled-element');
    } catch (e) {
        console.warn("Cornerstone enable warning:", e);
    }
    
    const imageId = cornerstoneWADOImageLoader.fileManager.add(fileBlob);
    
    try {
        const image = await cornerstone.loadImage(imageId);
        
        const viewport = cornerstone.getDefaultViewportForImage(canvas, image);
        cornerstone.displayImage(canvas, image, viewport);

        imageElement = null; 
    } catch (error) {
        console.error("[FRONTEND ERROR] Cornerstone DICOM load error:", error);
        throw new Error(`Failed to load DICOM image using Cornerstone: ${error.message}`);
    } finally {
        cornerstoneWADOImageLoader.fileManager.remove(imageId);
    }
}

function drawImage() {
    if (!imageElement || !context || !canvas) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();

    const center = (imageState.max + imageState.min) / 2;
    const width = imageState.max - imageState.min;

    const contrastMultiplier = 255 / width; 
    const brightnessRatio = center / 127.5; 
    
    context.filter = `contrast(${contrastMultiplier}) brightness(${brightnessRatio})`;

    const imgAspect = imageElement.width / imageElement.height;
    const canvasAspect = canvas.width / canvas.height;
    let baseDrawWidth, baseDrawHeight;

    if (imgAspect > canvasAspect) {
        baseDrawWidth = canvas.width;
        baseDrawHeight = canvas.width / imgAspect;
    } else {
        baseDrawHeight = canvas.height;
        baseDrawWidth = canvas.height * imgAspect;
    }

    const initialX = (canvas.width - baseDrawWidth) / 2;
    const initialY = (canvas.height - baseDrawHeight) / 2;

    context.translate(imageState.x, imageState.y); 

    const centerX = initialX + baseDrawWidth / 2;
    const centerY = initialY + baseDrawHeight / 2;
    
    context.translate(centerX, centerY);
    context.scale(imageState.scale, imageState.scale);
    context.translate(-centerX, -centerY);

    context.drawImage(imageElement, initialX, initialY, baseDrawWidth, baseDrawHeight);

    context.restore();
    context.filter = 'none'; 
}

function recordDecision(userDecision) {
    clearInterval(timerInterval);
    const timeTaken = (Date.now() - timerStart) / 1000;
    totalTime += timeTaken; // ACCUMULATE TOTAL TIME
    
    const currentCase = sampleCases[currentCaseIndex];
    const groundTruth = currentCase['is disease present']?.toLowerCase() === 'true';

    let aiAccuracyOnCase = 'N/A';
    if (isAiEnabled) {
        const aiDecision = currentCase.aiDecision;
        const aiCorrect = (aiDecision === groundTruth);
        aiAccuracyOnCase = aiCorrect ? 'Correct' : 'Incorrect';
    }

    reviewResults.push({
        'File Name': currentCase['file name'],
        'Ground Truth': groundTruth,
        'User Decision': userDecision,
        'User GitHub': githubUsername,
        'AI Result': aiAccuracyOnCase, 
        'Time Taken (s)': timeTaken.toFixed(2),
        'Time Taken (ms)': (timeTaken * 1000).toFixed(0)
    });

    currentCaseIndex++;
    nextCase();
}

function simulateAI(currentCase) {
    presentBtn.disabled = notPresentBtn.disabled = true;
    const groundTruth = currentCase['is disease present']?.toLowerCase() === 'true';
    
    // The delay is still calculated, but not shown to the user
    const randomDelay = Math.random() * 3500;

    aiSuggestionBox.classList.remove('hidden', 'bg-red-900/20', 'border-red-700', 'text-red-300', 'bg-emerald-900/20', 'border-emerald-700', 'text-emerald-300');
    aiSuggestionBox.classList.add('bg-slate-700/50', 'border-slate-600', 'text-slate-300');
    aiSuggestionText.textContent = 'AI is processing...';
    aiDelayText.textContent = `(Processing...)`; 

    setTimeout(() => {
        let correct;

        // Use the predetermined correctness pattern when a trial is locked.
        if (aiLiePattern && currentCaseIndex < aiLiePattern.length) {
            // Use the pre-determined correctness based on the case index
            correct = aiLiePattern[currentCaseIndex];
        } else {
            // Fallback to random chance if the pattern isn't set or index is out of bounds
            correct = Math.random() * 100 < aiAccuracy;
        }

        const aiDecision = correct ? groundTruth : !groundTruth; // Boolean result

        currentCase.aiDecision = aiDecision;

        aiSuggestionBox.classList.remove('bg-slate-700/50', 'border-slate-600', 'text-slate-300');
        
        if (aiDecision) { 
            aiSuggestionText.textContent = 'AI: DISEASE PRESENT';
            aiSuggestionBox.classList.add('bg-red-900/20', 'border-red-700', 'text-red-300');
        } else { 
            aiSuggestionText.textContent = 'AI: NOT PRESENT';
            aiSuggestionBox.classList.add('bg-emerald-900/20', 'border-emerald-700', 'text-emerald-300');
        }
        aiDelayText.textContent = ''; 

        presentBtn.disabled = notPresentBtn.disabled = false;
    }, randomDelay); 
}

function endReview() {
    reviewSection.classList.add('hidden');
    reportSection.classList.remove('hidden');

    if (appHeader) appHeader.classList.remove('hidden');

    let correctCount = 0;
    let totalCasesReviewed = reviewResults.length;
    
    if (totalCasesReviewed > 0) {
        reviewResults.forEach(result => {
            if (result['User Decision'] === result['Ground Truth']) {
                correctCount++;
            }
        });
        const accuracy = ((correctCount / totalCasesReviewed) * 100).toFixed(1);

        if (reportReviewedCount) reportReviewedCount.textContent = totalCasesReviewed;
        if (reportTotalTime) reportTotalTime.textContent = totalTime.toFixed(1) + 's';
        if (reportUserAccuracy) reportUserAccuracy.textContent = accuracy + '%';
        if (reportAiEnabled) reportAiEnabled.textContent = isAiEnabled ? 'Yes' : 'No';
        if (reportGithubUsername) reportGithubUsername.textContent = githubUsername;
        
        const now = new Date();
        const timestamp = now.toISOString().replace(/T|:/g, '-').slice(0, -5);
        if (reportUploadPath) reportUploadPath.textContent = `results/review_data_${githubUsername}_${timestamp}.csv`;

        if (finalStatsSummary) finalStatsSummary.textContent = `You correctly identified ${correctCount} out of ${totalCasesReviewed} cases (${accuracy}% accuracy).`;
        
    } else {
        if (reportReviewedCount) reportReviewedCount.textContent = '0';
        if (reportTotalTime) reportTotalTime.textContent = '0.0s';
        if (reportUserAccuracy) reportUserAccuracy.textContent = '0.0%';
        if (reportAiEnabled) reportAiEnabled.textContent = isAiEnabled ? 'Yes' : 'No';
        if (finalStatsSummary) finalStatsSummary.textContent = "No cases were reviewed in this session. Please check your configuration and try again.";
        if (uploadBtn) uploadBtn.disabled = true;
    }
}

function generateCSV(data) {
    if (data.length === 0) return '';
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(obj => Object.values(obj).map(v => `"${v}"`).join(',')).join('\n');
    return `${headers}\n${rows}`;
}

function showStatusMessage(message, type) {
    if (!statusMessage) return;

    statusMessage.textContent = message;
    statusMessage.className = 'text-sm text-center font-semibold mt-2';

    if (type === 'success') {
        statusMessage.classList.add('text-green-400');
    } else if (type === 'error') {
        statusMessage.classList.add('text-red-400');
    } else if (type === 'info') {
        statusMessage.classList.add('text-yellow-400');
    } else if (type === 'clear') {
        statusMessage.textContent = '';
    }
}

function setLockdownTrial(trialNumber) {
    lockdownTrial = trialNumber;

    // 1. Force AI on
    aiEnabledCheckbox.checked = true;
    aiEnabledCheckbox.disabled = true;
    aiControlsContainer.classList.remove('hidden');

    // 2. Force sample size
    sampleSizeInput.value = 50;
    sampleSizeInput.disabled = true;

    // 3. Disable trial buttons, enable reset
    lockdownTrial1Btn.disabled = true;
    lockdownTrial2Btn.disabled = true;
    lockdownTrial3Btn.disabled = true;
    lockdownResetBtn.disabled = false;

    // 4. Set AI accuracy based on trial
    let accuracy = 0;
    if (trialNumber === 1) {
        accuracy = 60;
    } else if (trialNumber === 2) {
        accuracy = 75;
    } else if (trialNumber === 3) {
        accuracy = 90;
    }

    aiAccuracyInput.value = accuracy;
    aiAccuracyInput.min = accuracy;
    aiAccuracyInput.max = accuracy;
    aiAccuracyInput.disabled = true;
    accuracyValueSpan.textContent = accuracy;

    showStatusMessage(`Lockdown Mode: Trial ${trialNumber} selected. Settings locked.`, 'info');
}

function resetLockdown() {
    lockdownTrial = null;

    aiEnabledCheckbox.disabled = false;

    // 2. Enable and reset sample size
    sampleSizeInput.value = 10; // Reset to default
    sampleSizeInput.disabled = false;

    // 3. Enable trial buttons, disable reset
    lockdownTrial1Btn.disabled = false;
    lockdownTrial2Btn.disabled = false;
    lockdownTrial3Btn.disabled = false;
    lockdownResetBtn.disabled = true;

    // 4. Enable and reset AI slider
    aiAccuracyInput.value = 50; // Reset to default
    aiAccuracyInput.min = 0;
    aiAccuracyInput.max = 100;
    aiAccuracyInput.disabled = false;
    accuracyValueSpan.textContent = 50;

    showStatusMessage('Lockdown Mode reset. All settings unlocked.', 'info');
}
