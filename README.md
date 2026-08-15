# Datalink DICOM

project created through the summer of 2025, consolidated into one repository and made public on 8/15/26

A web platform for running controlled reading studies on AI-assisted radiology.

Datalink was built to answer a specific research question: **does the stated accuracy of an AI assistant change how a radiologist reads a case?** It presents chest radiographs to a participant alongside a simulated AI second opinion whose accuracy is fixed per trial arm, records every decision, and exports the session for analysis.

Developed for a University of Washington study on AI-assisted pneumothorax detection. The platform was deployed and piloted; the full study was not completed after the principal investigator changed institutions.

---

## Why simulate the AI instead of using a real model?

A real detection model makes errors that correlate with case difficulty — it fails on the same subtle cases a human finds hard. That confound makes it impossible to attribute a change in reader behavior to the *accuracy level* rather than to the *difficulty of the cases the model happened to miss*.

Datalink models the assistant as a Bernoulli process at a fixed rate:

```javascript
correct = Math.random() * 100 < aiAccuracy;
```

Errors are independent of case content, so accuracy becomes a clean independent variable.

## Experimental control

Participants are assigned to one of three arms — **60%**, **75%**, or **90%** stated AI accuracy — and the assignment is locked in the interface:

```javascript
aiAccuracyInput.value    = accuracy;
aiAccuracyInput.min      = accuracy;
aiAccuracyInput.max      = accuracy;
aiAccuracyInput.disabled = true;
```

The participant can see the accuracy figure but cannot change it. Setting `min` and `max` to the assigned value in addition to `disabled` means the control cannot be driven out of range by keyboard input or by re-enabling the element in devtools. The operator resets these bounds between sessions.

Per-case, the platform records the participant's read, the AI's verdict, whether the AI was correct, and agreement between the two — exported for analysis at session end.

---

## Architecture

```
frontend/          Vanilla JS single-page app — DICOM rendering, reading UI, trial logic
  index.html
  scripts.js       (~1000 lines: viewer, trial assignment, response capture, export)
  styles.css

backend/           Node + Express proxy
  server.js        GitHub content API, Git LFS resolution, DICOM→PNG conversion, caching
  package.json
```

**Stack:** Node, Express, `dcmjs` for DICOM parsing, `jimp` for image conversion, vanilla JS on the client.

### Using GitHub as the image store

The study had no storage budget. Rather than provision object storage, Datalink reads DICOM files directly from a private GitHub repository over the contents API, which gives versioned, access-controlled medical image storage for free.

Files above GitHub's size limit are stored with **Git LFS**, so the contents API returns a pointer file rather than image bytes. The backend detects these and resolves them through the LFS batch API:

| Endpoint | Purpose |
|---|---|
| `POST /api/get-repos` | List repositories available to the credential |
| `POST /api/get-files` | List DICOM files in a study repository |
| `POST /api/fetch-file` | Fetch a case, resolve LFS pointers, convert DICOM to displayable PNG |
| `POST /api/upload-file` | Write session results back to the study repository |

### Caching

Fetched content is cached to avoid re-converting DICOMs on every read. The cache key includes the requesting credential:

```javascript
const cacheKey = `${url}::${token}`;
```

An earlier version keyed on URL alone. That is a cross-user cache poisoning bug: two participants running concurrent sessions against different study repositories could receive each other's cached responses, since the URL alone does not identify who is authorized to see the content. Including the credential in the key isolates the entries.

---

## Setup

```bash
git clone https://github.com/samarthprasad8/datalink-dicom.git
cd datalink-dicom/backend
npm install
npm start
```

Then open `frontend/index.html` and point it at the running backend.

### Data

Development used chest radiographs from a public Kaggle competition dataset. **The data is not redistributed here** — competition rules require downloading it directly from Kaggle under their terms. Study images are supplied by pointing the platform at your own GitHub repository of DICOM files.

---

## Known limitations

- **Credential handling.** The platform takes a GitHub Personal Access Token with `repo` scope in a browser field and forwards it to the backend, which holds it only for the duration of the request. This was a deliberate tradeoff for a single-operator research tool with no auth infrastructure — it avoids storing credentials server-side entirely, but it means the token transits the browser and the operator must scope and rotate it themselves. A multi-tenant deployment would want a proper OAuth flow and server-side session management.
- **Window/level.** The viewer applies a fixed conversion rather than exposing radiological windowing controls.
- **Single-reader.** No multi-reader or multi-case (MRMC) analysis support; sessions export raw per-case records for external analysis.
- **Randomization** is per-session at the operator's direction rather than automated block randomization.

## License

MIT
