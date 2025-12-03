# AI Image Editor - Development Journal

> Complete documentation of the development process, decisions, and lessons learned

**Project Duration:** November 2024
**Developer:** Alvaro Gonzalez
**AI Assistant:** Claude (Anthropic)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Development Timeline](#2-development-timeline)
3. [Architecture Evolution](#3-architecture-evolution)
4. [Core Components Deep Dive](#4-core-components-deep-dive)
5. [Feature Implementation Details](#5-feature-implementation-details)
6. [Problems & Solutions](#6-problems--solutions)
7. [Deployment Guide](#7-deployment-guide)
8. [Lessons Learned](#8-lessons-learned)
9. [Future Improvements](#9-future-improvements)
10. [Complete Code Reference](#10-complete-code-reference)

---

## 1. Project Overview

### Goal
Build a browser-based AI image editor that allows users to edit images using natural language instructions, without requiring local GPU or complex setup.

### Final Tech Stack
| Component | Technology | Why |
|-----------|------------|-----|
| Frontend | Vanilla HTML/CSS/JS | Simple, no build step, easy to modify |
| Backend | Node.js + Express + TypeScript | Type safety, modern JS features |
| AI | Google Gemini (gemini-3-pro-image-preview) | Native image generation, free tier |
| Image Processing | Sharp | Fast, native Node.js bindings |

### Key Features Delivered
- Natural language image editing
- Masked editing (paint area to edit)
- Click-to-select objects
- Scene analysis with element detection
- Element compositing (add logos/objects)
- Undo/redo system
- Zoom controls
- High-quality output

---

## 2. Development Timeline

### Phase 1: Initial Architecture (Replicate-based)
**Goal:** Use multiple specialized AI models via Replicate API

```
Original Architecture:
┌─────────────────┐
│  Gemini Flash   │ ← Scene analysis, planning
│  (Director)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Replicate     │ ← Multiple models:
│   (Workers)     │   - Grounding DINO (detection)
└─────────────────┘   - SAM 2 (segmentation)
                      - LaMa (inpainting)
                      - REMBG (bg removal)
                      - Real-ESRGAN (upscale)
```

**Problem:** Complex, expensive, multiple API calls per edit

### Phase 2: Gemini-Only Architecture
**Decision:** Switch to Gemini's native image generation

```
Final Architecture:
┌─────────────────────────────────────┐
│     Google Gemini                    │
│  (gemini-3-pro-image-preview)       │
├─────────────────────────────────────┤
│  • Image editing (responseModalities)│
│  • Segmentation (mask generation)    │
│  • Scene analysis                    │
└─────────────────────────────────────┘
```

**Benefits:**
- Single API, single billing
- Simpler code
- Lower latency
- Free tier available

### Phase 3: Web Interface
**Goal:** Create intuitive browser UI

Features added:
1. Drag-and-drop image upload
2. URL-based image loading
3. Mask painting tools
4. Scene element chips (clickable)
5. Element compositing system

### Phase 4: Polish & Deployment
**Goal:** Production-ready application

Added:
- Undo/redo system
- Retry logic for API errors
- Quality improvements
- Deployment configuration

---

## 3. Architecture Evolution

### Backend Architecture

```
web/server.ts
├── Express app setup
├── Multer for file uploads
├── API Endpoints:
│   ├── POST /api/upload      → Store image, return ID
│   ├── POST /api/analyze     → Scene analysis
│   ├── POST /api/edit        → Execute edit
│   ├── POST /api/segment-point → Click-to-select
│   └── POST /api/segment-label → Label-based select
└── Static file serving (index.html)

src/orchestrator/
├── gemini-editor.ts    → Image editing operations
└── gemini-director.ts  → Scene analysis
```

### Frontend Architecture

```
web/public/index.html (Single File Application)
├── CSS Styles (~400 lines)
│   ├── Dark theme
│   ├── Responsive layout
│   └── Component styles
├── HTML Structure
│   ├── Upload section
│   ├── Preview with canvas overlay
│   ├── Mask tools
│   ├── Scene elements panel
│   └── Edit controls
└── JavaScript (~800 lines)
    ├── State management
    ├── Canvas drawing
    ├── Element compositing
    ├── History system
    └── API calls
```

### Data Flow

```
User Action → Frontend Handler → API Call → Gemini → Response → Update UI

Example (Edit Image):
1. User types "remove the car"
2. Frontend calls POST /api/edit
3. Server calls geminiEditor.editImage()
4. Gemini processes and returns new image
5. Server sends base64 to frontend
6. Frontend displays result
```

---

## 4. Core Components Deep Dive

### 4.1 Gemini Editor (gemini-editor.ts)

**Purpose:** Handle all image editing operations with Gemini

**Key Configuration:**
```typescript
this.model = this.genAI.getGenerativeModel({
  model: 'gemini-3-pro-image-preview',
  generationConfig: {
    responseModalities: ['image', 'text'], // CRITICAL: enables image output
    temperature: 1,
    maxOutputTokens: 8192,
  },
});
```

**Main Methods:**

| Method | Purpose | Input | Output |
|--------|---------|-------|--------|
| `editImage()` | Basic editing | image + instruction | edited image |
| `editWithMask()` | Masked editing | image + mask + instruction | edited image |
| `editWithMaskAndReferences()` | Edit with elements | image + mask + instruction + refs | edited image |
| `segmentAtPoint()` | Click selection | image + coordinates | mask |
| `segmentByLabel()` | Label selection | image + label | mask |

**Retry Logic Implementation:**
```typescript
private async withRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      const isRetryable =
        error.message?.includes('500') ||
        error.message?.includes('503');

      if (!isRetryable || attempt === this.maxRetries) throw error;

      const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

### 4.2 Gemini Director (gemini-director.ts)

**Purpose:** Analyze scenes and identify elements

**Key Method - analyzeScene():**
```typescript
async analyzeScene(imageSource: string): Promise<SceneAnalysis> {
  const prompt = `Analyze this image and identify:
1. All distinct objects/elements (with position: top-left, center, etc.)
2. The overall style (photo, illustration, etc.)
3. Lighting conditions
4. Mood/atmosphere

Return JSON: {
  "elements": [{"label": "...", "position": "..."}],
  "style": "...",
  "lighting": "...",
  "mood": "..."
}`;
  // ... API call
}
```

### 4.3 Server Endpoints (web/server.ts)

**Upload Endpoint:**
```typescript
app.post('/api/upload', upload.single('image'), async (req, res) => {
  const base64 = req.file.buffer.toString('base64');
  const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

  const imageId = `img_${Date.now()}`;
  uploadedImages.set(imageId, dataUrl);

  res.json({ success: true, imageId, dataUrl });
});
```

**Edit Endpoint with Compositing:**
```typescript
app.post('/api/edit', async (req, res) => {
  const { imageId, instruction, maskDataUrl, referenceElements } = req.body;

  let result;
  if (maskDataUrl && referenceElements?.length > 0) {
    result = await editor.editWithMaskAndReferences(
      sourceImage, maskDataUrl, instruction, referenceElements
    );
  } else if (maskDataUrl) {
    result = await editor.editWithMask(sourceImage, maskDataUrl, instruction);
  } else {
    result = await editor.editImage(sourceImage, instruction);
  }

  // Composite if mask provided (Sharp-based pixel blending)
  if (maskDataUrl && result.outputDataUrl) {
    const composited = await compositeMaskedEdit(
      sourceImage, result.outputDataUrl, maskDataUrl
    );
    result.outputDataUrl = composited;
  }

  res.json(result);
});
```

### 4.4 Frontend State Management

**Global State Variables:**
```javascript
// Image state
let currentImageId = null;
let originalImageDataUrl = null;

// Mask state
let maskCanvas, maskCtx;
let isDrawing = false;
let currentTool = 'paint';

// Element compositing
let placedElements = [];
let nextElementId = 1;

// History
let historyStack = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

// Zoom
let zoomLevel = 1;
```

---

## 5. Feature Implementation Details

### 5.1 Mask Painting System

**Canvas Setup:**
```javascript
function setupMaskCanvas() {
  const img = document.getElementById('previewImage');
  const rect = img.getBoundingClientRect();

  maskCanvas.width = rect.width;
  maskCanvas.height = rect.height;
  maskCanvas.style.width = rect.width + 'px';
  maskCanvas.style.height = rect.height + 'px';

  maskCtx.fillStyle = 'black';
  maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
}
```

**Drawing Logic:**
```javascript
function draw(e) {
  if (!isDrawing) return;

  const rect = maskCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / zoomLevel;
  const y = (e.clientY - rect.top) / zoomLevel;

  maskCtx.beginPath();
  maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
  maskCtx.fillStyle = currentTool === 'paint' ? 'white' : 'black';
  maskCtx.fill();
}
```

### 5.2 Undo/Redo System

**History Entry Structure:**
```javascript
{
  action: 'place' | 'move' | 'resize' | 'delete' | 'init',
  data: [...placedElements], // Snapshot of all elements
  timestamp: Date.now()
}
```

**Save to History:**
```javascript
function saveToHistory(action, data) {
  // Truncate future history if we're not at the end
  if (historyIndex < historyStack.length - 1) {
    historyStack = historyStack.slice(0, historyIndex + 1);
  }

  historyStack.push({
    action,
    data: JSON.parse(JSON.stringify(data)), // Deep clone
    timestamp: Date.now()
  });

  if (historyStack.length > MAX_HISTORY) {
    historyStack.shift();
  } else {
    historyIndex++;
  }

  updateUndoRedoButtons();
}
```

**Restore State:**
```javascript
function restorePlacedElementsState(state) {
  // Remove current DOM elements
  document.querySelectorAll('.placed-element').forEach(el => el.remove());
  placedElements = [];

  // Recreate from state
  for (const elState of state) {
    const sourceEl = document.querySelector(`[data-source-id="${elState.sourceId}"]`);
    if (sourceEl) {
      const imgSrc = sourceEl.querySelector('img')?.src;
      recreateElement(elState, imgSrc);
    }
  }
}
```

### 5.3 Element Compositing (Flatten)

**The Challenge:** Elements are positioned in screen coordinates, but need to be drawn at natural image coordinates.

**Solution:**
```javascript
async function flattenElements() {
  const canvas = document.createElement('canvas');
  const img = document.getElementById('previewImage');

  // Use natural (full) resolution
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  // Draw base image
  ctx.drawImage(img, 0, 0);

  // Calculate scale factors
  const imgRect = img.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  const imageOffsetX = imgRect.left - previewRect.left;
  const imageOffsetY = imgRect.top - previewRect.top;
  const scaleX = img.naturalWidth / imgRect.width;
  const scaleY = img.naturalHeight / imgRect.height;

  // Draw each element
  for (const placedEl of placedElements) {
    const domEl = document.getElementById(placedEl.id);
    const elLeft = parseFloat(domEl.style.left);
    const elTop = parseFloat(domEl.style.top);

    // Convert screen position to natural position
    const relativeX = elLeft - imageOffsetX;
    const relativeY = elTop - imageOffsetY;
    const naturalX = relativeX * scaleX;
    const naturalY = relativeY * scaleY;
    const naturalWidth = domEl.offsetWidth * scaleX;
    const naturalHeight = domEl.offsetHeight * scaleY;

    ctx.drawImage(elImg, naturalX, naturalY, naturalWidth, naturalHeight);
  }

  return canvas.toDataURL('image/png', 1.0);
}
```

### 5.4 Click-to-Select

**Frontend:**
```javascript
async function handleClickSelect(e) {
  const img = document.getElementById('previewImage');
  const rect = img.getBoundingClientRect();

  // Calculate click position as percentage
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;

  const response = await fetch('/api/segment-point', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageId: currentImageId, x, y })
  });

  const data = await response.json();
  if (data.maskUrl) {
    applyMaskToCanvas(data.maskUrl);
  }
}
```

**Backend:**
```typescript
app.post('/api/segment-point', async (req, res) => {
  const { imageId, x, y } = req.body;
  const sourceImage = uploadedImages.get(imageId);

  const result = await editor.segmentAtPoint(sourceImage, { x, y });
  res.json(result);
});
```

---

## 6. Problems & Solutions

### Problem 1: Gemini Returns Text Instead of Image

**Symptom:** API returns text explanation instead of edited image

**Root Cause:** Missing `responseModalities` configuration

**Solution:**
```typescript
generationConfig: {
  responseModalities: ['image', 'text'], // Must include 'image'
}
```

### Problem 2: 500 Internal Server Error from Gemini

**Symptom:** `[500 Internal Server Error] An internal error has occurred`

**Root Cause:** Transient Google server issues

**Solution:** Implement retry with exponential backoff
```typescript
private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error.message?.includes('500') && attempt < 3) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
        continue;
      }
      throw error;
    }
  }
}
```

### Problem 3: Element Size Changes on Flatten

**Symptom:** Logos/objects appear different size after flattening

**Root Cause:** Scale calculation didn't account for image offset within container

**Wrong Approach:**
```javascript
const scaleX = img.naturalWidth / (imgRect.width / zoomLevel);
```

**Correct Approach:**
```javascript
const imgRect = img.getBoundingClientRect();
const previewRect = preview.getBoundingClientRect();
const imageOffsetX = imgRect.left - previewRect.left;
const scaleX = img.naturalWidth / imgRect.width;

// Position relative to image, not container
const relativeX = elementLeft - imageOffsetX;
const naturalX = relativeX * scaleX;
```

### Problem 4: Mask Not Aligned with Edit

**Symptom:** Edited region doesn't match painted mask

**Root Cause:** Mask canvas size didn't match displayed image size

**Solution:**
```javascript
function setupMaskCanvas() {
  const rect = img.getBoundingClientRect();
  maskCanvas.width = rect.width;
  maskCanvas.height = rect.height;
  // Canvas internal size matches display size
}
```

### Problem 5: Scene Elements Not Clickable

**Symptom:** Clicking element chips does nothing

**Root Cause:** Event listeners not attached after dynamic rendering

**Solution:**
```javascript
function displayElements(elements) {
  container.innerHTML = elements.map(el =>
    `<span class="element-chip" data-label="${el.label}">${el.label}</span>`
  ).join('');

  // Attach listeners AFTER rendering
  container.querySelectorAll('.element-chip').forEach(chip => {
    chip.addEventListener('click', () => selectElement(chip.dataset.label));
  });
}
```

### Problem 6: Production Static Files Not Found

**Symptom:** 404 for index.html in production

**Root Cause:** Different directory structure in dist/

**Solution:**
```typescript
const publicPath = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, '../../web/public')  // From dist/web/
  : path.join(__dirname, 'public');            // From web/
app.use(express.static(publicPath));
```

---

## 7. Deployment Guide

### Prerequisites
- Node.js 18+
- Google AI API key
- GitHub account
- Render account

### Step 1: Prepare for Production

**package.json scripts:**
```json
{
  "scripts": {
    "build": "tsc",
    "start": "NODE_ENV=production node dist/web/server.js",
    "web": "tsx web/server.ts"
  }
}
```

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "."
  },
  "include": ["src/**/*", "web/**/*"],
  "exclude": ["node_modules", "dist", "web/public"]
}
```

### Step 2: Create GitHub Repository

```bash
cd ai-image-editor
git init
git add .
git commit -m "Initial commit"
gh repo create ai-image-editor --public --push
```

### Step 3: Deploy to Render

1. Go to render.com
2. New → Web Service
3. Connect GitHub repo
4. Configure:
   - Build: `npm install && npm run build`
   - Start: `npm start`
   - Environment: `GOOGLE_AI_API_KEY=your_key`
5. Deploy

### Step 4: Verify Deployment

1. Wait for build (~2-3 minutes)
2. Open provided URL
3. Test image upload
4. Test edit operation

---

## 8. Lessons Learned

### Technical Lessons

1. **Start Simple:** Gemini-only was simpler and more maintainable than multi-model architecture

2. **responseModalities is Critical:** Without `['image', 'text']`, Gemini won't generate images

3. **Coordinate Systems Matter:** Screen coordinates ≠ canvas coordinates ≠ natural image coordinates

4. **Retry Logic is Essential:** Cloud APIs have transient failures; always implement retries

5. **State Snapshots for Undo:** Deep clone state, don't store references

### Process Lessons

1. **Iterate Quickly:** Get basic version working, then add features

2. **Test Each Feature:** Don't build everything then test; test incrementally

3. **Document As You Go:** Writing this journal while building helped identify issues

4. **User Feedback is Gold:** Real usage reveals issues you never considered

### Architecture Lessons

1. **Single File Frontend Works:** For moderate complexity, one HTML file is fine

2. **TypeScript Pays Off:** Type errors caught during development, not production

3. **Keep API Simple:** REST endpoints with JSON are easy to debug

---

## 9. Future Improvements

### Short Term
- [ ] Add loading skeletons
- [ ] Improve error messages
- [ ] Add image history (previous edits)
- [ ] Support more image formats

### Medium Term
- [ ] Batch operations
- [ ] Preset filters/effects
- [ ] Keyboard shortcuts for tools
- [ ] Mobile-responsive design

### Long Term
- [ ] User accounts & saved projects
- [ ] Collaboration features
- [ ] Plugin system
- [ ] Local model option (Ollama)

---

## 10. Complete Code Reference

### File: web/server.ts (Key Sections)

```typescript
// Composite edited region onto original image
async function compositeMaskedEdit(
  originalDataUrl: string,
  editedDataUrl: string,
  maskDataUrl: string
): Promise<string> {
  const [originalBuf, editedBuf, maskBuf] = await Promise.all([
    dataUrlToBuffer(originalDataUrl),
    dataUrlToBuffer(editedDataUrl),
    dataUrlToBuffer(maskDataUrl)
  ]);

  const original = sharp(originalBuf);
  const edited = sharp(editedBuf);
  const mask = sharp(maskBuf);

  const { width, height } = await original.metadata();

  // Resize edited and mask to match original
  const [editedResized, maskResized] = await Promise.all([
    edited.resize(width, height).raw().toBuffer(),
    mask.resize(width, height).grayscale().raw().toBuffer()
  ]);

  const originalRaw = await original.raw().toBuffer();

  // Blend pixels based on mask
  const result = Buffer.alloc(originalRaw.length);
  for (let i = 0; i < width * height; i++) {
    const maskValue = maskResized[i] / 255; // 0-1
    const pixelOffset = i * 3;

    for (let c = 0; c < 3; c++) {
      result[pixelOffset + c] = Math.round(
        originalRaw[pixelOffset + c] * (1 - maskValue) +
        editedResized[pixelOffset + c] * maskValue
      );
    }
  }

  const resultBuffer = await sharp(result, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();

  return `data:image/png;base64,${resultBuffer.toString('base64')}`;
}
```

### File: src/orchestrator/gemini-editor.ts (Key Method)

```typescript
async editWithMask(
  sourceImage: string,
  mask: string,
  instruction: string
): Promise<GeminiEditResult> {
  const sourceData = await this.prepareImageData(sourceImage);
  const maskData = await this.prepareImageData(mask);

  const result = await this.withRetry(
    () => this.model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            text: `Edit the WHITE regions of the mask: ${instruction}

CRITICAL:
1. ONLY modify WHITE regions
2. Keep BLACK regions UNCHANGED
3. Same dimensions as original
4. Seamless blend`,
          },
          { inlineData: { mimeType: 'image/png', data: sourceData } },
          { inlineData: { mimeType: 'image/png', data: maskData } },
        ],
      }],
    }),
    'Masked Edit'
  );

  // Extract image from response
  const parts = result.response.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        success: true,
        outputBase64: part.inlineData.data,
        outputDataUrl: `data:image/png;base64,${part.inlineData.data}`,
      };
    }
  }

  return { success: false, error: 'No image in response' };
}
```

---

## Appendix: API Quick Reference

### Gemini Model Configuration
```typescript
{
  model: 'gemini-3-pro-image-preview',
  generationConfig: {
    responseModalities: ['image', 'text'],
    temperature: 1,
    maxOutputTokens: 8192
  }
}
```

### API Endpoints
| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | /api/upload | FormData (image) | `{ imageId, dataUrl }` |
| POST | /api/analyze | `{ imageId }` | `{ elements, style, lighting }` |
| POST | /api/edit | `{ imageId, instruction, maskDataUrl?, referenceElements? }` | `{ outputDataUrl }` |
| POST | /api/segment-point | `{ imageId, x, y }` | `{ maskUrl }` |
| POST | /api/segment-label | `{ imageId, label }` | `{ maskUrl }` |

---

*Document Version: 1.0*
*Last Updated: November 2024*
