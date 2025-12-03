# Build an AI Image Editor from Scratch

> Step-by-step tutorial to build a browser-based AI image editor using Google Gemini

**Time Required:** 2-3 hours
**Difficulty:** Intermediate
**Prerequisites:** Basic TypeScript, HTML/CSS, Node.js

---

## What You'll Build

A web application that:
- Accepts image uploads
- Edits images using natural language ("remove the car", "make sky blue")
- Supports masked editing (paint area to edit)
- Analyzes scene elements
- Composites logos/objects onto images

## Step 1: Project Setup (10 minutes)

### 1.1 Create Project Structure

```bash
mkdir ai-image-editor
cd ai-image-editor

# Create directories
mkdir -p src/orchestrator web/public docs

# Initialize npm
npm init -y
```

### 1.2 Install Dependencies

```bash
# Core dependencies
npm install express multer sharp @google/generative-ai

# TypeScript & dev tools
npm install -D typescript tsx @types/node @types/express @types/multer
```

### 1.3 Configure TypeScript

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": ".",
    "declaration": true
  },
  "include": ["src/**/*", "web/**/*"],
  "exclude": ["node_modules", "dist", "web/public"]
}
```

### 1.4 Update package.json

Add to `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "NODE_ENV=production node dist/web/server.js",
    "dev": "tsx web/server.ts"
  }
}
```

---

## Step 2: Build the Gemini Editor (30 minutes)

### 2.1 Create src/orchestrator/gemini-editor.ts

This is the core AI integration:

```typescript
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

export interface GeminiEditResult {
  success: boolean;
  outputBase64?: string;
  outputDataUrl?: string;
  error?: string;
}

export class GeminiEditor {
  private model: GenerativeModel;
  private maxRetries: number = 3;

  constructor(apiKey: string) {
    const genAI = new GoogleGenerativeAI(apiKey);

    // CRITICAL: responseModalities enables image output
    this.model = genAI.getGenerativeModel({
      model: 'gemini-3-pro-image-preview',
      generationConfig: {
        // @ts-ignore
        responseModalities: ['image', 'text'],
        temperature: 1,
        maxOutputTokens: 8192,
      },
    });
  }

  /**
   * Edit an image using natural language
   */
  async editImage(imageSource: string, instruction: string): Promise<GeminiEditResult> {
    try {
      const imageData = await this.prepareImageData(imageSource);

      const result = await this.withRetry(async () => {
        return this.model.generateContent({
          contents: [{
            role: 'user',
            parts: [
              {
                text: `Edit this image: ${instruction}

IMPORTANT: Output the edited image. Maintain same resolution.`,
              },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: imageData,
                },
              },
            ],
          }],
        });
      });

      // Extract image from response
      const parts = result.response.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        // @ts-ignore
        if (part.inlineData?.data) {
          // @ts-ignore
          const base64 = part.inlineData.data;
          return {
            success: true,
            outputBase64: base64,
            outputDataUrl: `data:image/png;base64,${base64}`,
          };
        }
      }

      return { success: false, error: 'No image in response' };

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Edit only the masked region
   */
  async editWithMask(
    sourceImage: string,
    mask: string,
    instruction: string
  ): Promise<GeminiEditResult> {
    try {
      const sourceData = await this.prepareImageData(sourceImage);
      const maskData = await this.prepareImageData(mask);

      const result = await this.withRetry(async () => {
        return this.model.generateContent({
          contents: [{
            role: 'user',
            parts: [
              {
                text: `First image: original. Second image: mask.
WHITE areas = edit, BLACK areas = keep unchanged.

Task: ${instruction}

CRITICAL:
1. ONLY modify WHITE regions
2. Keep BLACK regions EXACTLY as original
3. Same dimensions
4. Seamless blend

Output the edited image.`,
              },
              { inlineData: { mimeType: 'image/png', data: sourceData } },
              { inlineData: { mimeType: 'image/png', data: maskData } },
            ],
          }],
        });
      });

      const parts = result.response.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        // @ts-ignore
        if (part.inlineData?.data) {
          // @ts-ignore
          const base64 = part.inlineData.data;
          return {
            success: true,
            outputBase64: base64,
            outputDataUrl: `data:image/png;base64,${base64}`,
          };
        }
      }

      return { success: false, error: 'No image in response' };

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate mask for object at click point
   */
  async segmentAtPoint(
    sourceImage: string,
    point: { x: number; y: number }
  ): Promise<{ success: boolean; maskUrl?: string; error?: string }> {
    try {
      const sourceData = await this.prepareImageData(sourceImage);

      const result = await this.withRetry(async () => {
        return this.model.generateContent({
          contents: [{
            role: 'user',
            parts: [
              {
                text: `Click at (${point.x}%, ${point.y}%) of this image.

Create a BLACK AND WHITE MASK:
- Object at click point = WHITE
- Everything else = BLACK

Output ONLY the mask image.`,
              },
              { inlineData: { mimeType: 'image/png', data: sourceData } },
            ],
          }],
        });
      });

      const parts = result.response.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        // @ts-ignore
        if (part.inlineData?.data) {
          // @ts-ignore
          return {
            success: true,
            maskUrl: `data:image/png;base64,${part.inlineData.data}`,
          };
        }
      }

      return { success: false, error: 'Could not generate mask' };

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ============ Helper Methods ============

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;

        const isRetryable =
          error.message?.includes('500') ||
          error.message?.includes('503');

        if (!isRetryable || attempt === this.maxRetries) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`Retry ${attempt}/${this.maxRetries} in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    throw lastError;
  }

  private async prepareImageData(source: string): Promise<string> {
    // Handle data URL
    if (source.startsWith('data:')) {
      const match = source.match(/^data:[^;]+;base64,(.+)$/);
      if (match) return match[1];
      throw new Error('Invalid data URL');
    }

    // Handle URL
    if (source.startsWith('http')) {
      const response = await fetch(source);
      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer).toString('base64');
    }

    // Assume already base64
    return source;
  }
}
```

---

## Step 3: Build the Scene Analyzer (15 minutes)

### 3.1 Create src/orchestrator/gemini-director.ts

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface SceneElement {
  label: string;
  position: string;
}

export interface SceneAnalysis {
  elements: SceneElement[];
  style: string;
  lighting: string;
  mood: string;
}

export class GeminiDirector {
  private model;

  constructor(apiKey: string) {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  }

  async analyzeScene(imageSource: string): Promise<SceneAnalysis> {
    const imageData = await this.prepareImageData(imageSource);

    const result = await this.model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            text: `Analyze this image. Return JSON only:

{
  "elements": [
    {"label": "object name", "position": "top-left/center/etc"}
  ],
  "style": "photo/illustration/etc",
  "lighting": "description",
  "mood": "description"
}

Be specific with labels (e.g., "red car" not just "car").`,
          },
          { inlineData: { mimeType: 'image/png', data: imageData } },
        ],
      }],
    });

    const text = result.response.text();

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { elements: [], style: 'unknown', lighting: 'unknown', mood: 'unknown' };
    }

    return JSON.parse(jsonMatch[0]);
  }

  private async prepareImageData(source: string): Promise<string> {
    if (source.startsWith('data:')) {
      const match = source.match(/^data:[^;]+;base64,(.+)$/);
      if (match) return match[1];
    }
    return source;
  }
}
```

---

## Step 4: Build the Server (30 minutes)

### 4.1 Create web/server.ts

```typescript
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { GeminiEditor } from '../src/orchestrator/gemini-editor.js';
import { GeminiDirector } from '../src/orchestrator/gemini-director.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Setup
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.use(express.json({ limit: '100mb' }));

// Static files
const publicPath = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, '../../web/public')
  : path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Initialize AI
const apiKey = process.env.GOOGLE_AI_API_KEY;
if (!apiKey) {
  console.error('GOOGLE_AI_API_KEY required');
  process.exit(1);
}

const editor = new GeminiEditor(apiKey);
const director = new GeminiDirector(apiKey);

// Store uploaded images in memory
const uploadedImages = new Map<string, string>();

// ============ API Routes ============

// Upload image
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image' });
    }

    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    const imageId = `img_${Date.now()}`;
    uploadedImages.set(imageId, dataUrl);

    res.json({ success: true, imageId, dataUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Analyze scene
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageId } = req.body;
    const imageData = uploadedImages.get(imageId);

    if (!imageData) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const analysis = await director.analyzeScene(imageData);
    res.json(analysis);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Edit image
app.post('/api/edit', async (req, res) => {
  try {
    const { imageId, instruction, maskDataUrl } = req.body;
    const sourceImage = uploadedImages.get(imageId);

    if (!sourceImage) {
      return res.status(404).json({ error: 'Image not found' });
    }

    let result;

    if (maskDataUrl) {
      result = await editor.editWithMask(sourceImage, maskDataUrl, instruction);

      // Composite edited region onto original
      if (result.success && result.outputDataUrl) {
        result.outputDataUrl = await compositeMaskedEdit(
          sourceImage,
          result.outputDataUrl,
          maskDataUrl
        );
      }
    } else {
      result = await editor.editImage(sourceImage, instruction);
    }

    // Store result for further editing
    if (result.success && result.outputDataUrl) {
      uploadedImages.set(imageId, result.outputDataUrl);
    }

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Click-to-select segmentation
app.post('/api/segment-point', async (req, res) => {
  try {
    const { imageId, x, y } = req.body;
    const sourceImage = uploadedImages.get(imageId);

    if (!sourceImage) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const result = await editor.segmentAtPoint(sourceImage, { x, y });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============ Helper Functions ============

async function compositeMaskedEdit(
  originalDataUrl: string,
  editedDataUrl: string,
  maskDataUrl: string
): Promise<string> {
  const toBuffer = async (dataUrl: string) => {
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
    return Buffer.from(base64, 'base64');
  };

  const [originalBuf, editedBuf, maskBuf] = await Promise.all([
    toBuffer(originalDataUrl),
    toBuffer(editedDataUrl),
    toBuffer(maskDataUrl)
  ]);

  const { width, height } = await sharp(originalBuf).metadata();

  const [originalRaw, editedRaw, maskRaw] = await Promise.all([
    sharp(originalBuf).resize(width, height).raw().toBuffer(),
    sharp(editedBuf).resize(width, height).raw().toBuffer(),
    sharp(maskBuf).resize(width, height).grayscale().raw().toBuffer()
  ]);

  // Blend pixels based on mask
  const result = Buffer.alloc(originalRaw.length);

  for (let i = 0; i < width! * height!; i++) {
    const maskValue = maskRaw[i] / 255;
    const offset = i * 3;

    for (let c = 0; c < 3; c++) {
      result[offset + c] = Math.round(
        originalRaw[offset + c] * (1 - maskValue) +
        editedRaw[offset + c] * maskValue
      );
    }
  }

  const resultBuffer = await sharp(result, {
    raw: { width: width!, height: height!, channels: 3 }
  }).png().toBuffer();

  return `data:image/png;base64,${resultBuffer.toString('base64')}`;
}

// ============ Start Server ============

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
```

---

## Step 5: Build the Frontend (45 minutes)

### 5.1 Create web/public/index.html

This is a single-file application with HTML, CSS, and JavaScript:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Image Editor</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
      display: grid;
      grid-template-columns: 1fr 350px;
      gap: 20px;
    }

    .panel {
      background: #16213e;
      border-radius: 12px;
      padding: 20px;
    }

    h1 { font-size: 1.5rem; margin-bottom: 20px; }
    h2 { font-size: 1rem; margin-bottom: 15px; color: #888; }

    /* Upload Zone */
    .upload-zone {
      border: 2px dashed #444;
      border-radius: 12px;
      padding: 40px;
      text-align: center;
      cursor: pointer;
      transition: border-color 0.3s;
    }
    .upload-zone:hover { border-color: #667eea; }
    .upload-zone.dragover { border-color: #667eea; background: rgba(102, 126, 234, 0.1); }

    /* Preview */
    .preview-container {
      position: relative;
      margin-top: 20px;
      display: none;
    }
    .preview-container.active { display: block; }

    #previewImage {
      max-width: 100%;
      border-radius: 8px;
    }

    #maskCanvas {
      position: absolute;
      top: 0;
      left: 0;
      opacity: 0.5;
      pointer-events: none;
    }
    #maskCanvas.active { pointer-events: auto; }

    /* Tools */
    .tools {
      display: flex;
      gap: 10px;
      margin: 15px 0;
      flex-wrap: wrap;
    }

    .tool-btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      background: #2a2a4a;
      color: #eee;
      cursor: pointer;
      transition: background 0.3s;
    }
    .tool-btn:hover { background: #3a3a5a; }
    .tool-btn.active { background: #667eea; }

    /* Scene Elements */
    .element-chip {
      display: inline-block;
      padding: 6px 12px;
      background: #2a2a4a;
      border-radius: 20px;
      margin: 4px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .element-chip:hover { background: #667eea; }

    /* Edit Input */
    .edit-input {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 8px;
      background: #2a2a4a;
      color: #eee;
      font-size: 1rem;
      margin-bottom: 15px;
    }

    .apply-btn {
      width: 100%;
      padding: 15px;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
      font-size: 1rem;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .apply-btn:hover { transform: scale(1.02); }
    .apply-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Error */
    .error {
      background: rgba(255, 0, 0, 0.2);
      border: 1px solid #f00;
      padding: 15px;
      border-radius: 8px;
      margin-top: 15px;
    }

    /* Loading */
    .loading {
      display: none;
      text-align: center;
      padding: 20px;
    }
    .loading.active { display: block; }

    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Left Panel: Image -->
    <div class="panel">
      <h1>AI Image Editor</h1>

      <div class="upload-zone" id="uploadZone">
        <p>Drop image here or click to upload</p>
        <p style="color: #666; font-size: 0.85rem; margin-top: 10px">PNG, JPG up to 50MB</p>
        <input type="file" id="fileInput" accept="image/*" hidden>
      </div>

      <div class="tools" id="maskTools" style="display: none;">
        <button class="tool-btn active" id="paintBtn" onclick="setTool('paint')">Paint</button>
        <button class="tool-btn" id="eraseBtn" onclick="setTool('erase')">Erase</button>
        <button class="tool-btn" onclick="clearMask()">Clear</button>
        <label style="display: flex; align-items: center; gap: 8px;">
          Size: <input type="range" id="brushSize" min="5" max="100" value="30">
        </label>
      </div>

      <div class="preview-container" id="previewContainer">
        <img id="previewImage" src="" alt="Preview">
        <canvas id="maskCanvas"></canvas>
      </div>

      <div class="loading" id="loading">
        Processing...
      </div>
    </div>

    <!-- Right Panel: Controls -->
    <div class="panel">
      <h2>Scene Elements</h2>
      <div id="sceneElements">
        <p style="color: #666">Upload an image to analyze</p>
      </div>

      <h2 style="margin-top: 30px">Edit Instruction</h2>
      <textarea
        class="edit-input"
        id="editInput"
        rows="3"
        placeholder="Describe the edit (e.g., 'remove the car')"
      ></textarea>

      <button class="apply-btn" id="applyBtn" onclick="applyEdit()" disabled>
        Apply Edit
      </button>

      <div id="errorContainer"></div>
    </div>
  </div>

  <script>
    // ============ State ============
    let currentImageId = null;
    let maskCanvas, maskCtx;
    let isDrawing = false;
    let currentTool = 'paint';
    let brushSize = 30;

    // ============ Setup ============
    document.addEventListener('DOMContentLoaded', () => {
      maskCanvas = document.getElementById('maskCanvas');
      maskCtx = maskCanvas.getContext('2d');

      // File input
      const uploadZone = document.getElementById('uploadZone');
      const fileInput = document.getElementById('fileInput');

      uploadZone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', handleFile);

      // Drag and drop
      uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
      });
      uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
      });
      uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) {
          handleFileUpload(e.dataTransfer.files[0]);
        }
      });

      // Mask drawing
      maskCanvas.addEventListener('mousedown', startDraw);
      maskCanvas.addEventListener('mousemove', draw);
      maskCanvas.addEventListener('mouseup', stopDraw);
      maskCanvas.addEventListener('mouseleave', stopDraw);

      // Brush size
      document.getElementById('brushSize').addEventListener('input', (e) => {
        brushSize = e.target.value;
      });
    });

    // ============ File Handling ============
    function handleFile(e) {
      if (e.target.files[0]) {
        handleFileUpload(e.target.files[0]);
      }
    }

    async function handleFileUpload(file) {
      const formData = new FormData();
      formData.append('image', file);

      showLoading(true);

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();

        if (data.success) {
          currentImageId = data.imageId;
          showPreview(data.dataUrl);
          analyzeScene();
        } else {
          showError(data.error);
        }
      } catch (error) {
        showError(error.message);
      }

      showLoading(false);
    }

    // ============ Preview ============
    function showPreview(dataUrl) {
      const img = document.getElementById('previewImage');
      const container = document.getElementById('previewContainer');

      img.onload = () => {
        setupMaskCanvas();
        document.getElementById('maskTools').style.display = 'flex';
        document.getElementById('applyBtn').disabled = false;
      };

      img.src = dataUrl;
      container.classList.add('active');
    }

    function setupMaskCanvas() {
      const img = document.getElementById('previewImage');
      const rect = img.getBoundingClientRect();

      maskCanvas.width = rect.width;
      maskCanvas.height = rect.height;
      maskCanvas.style.width = rect.width + 'px';
      maskCanvas.style.height = rect.height + 'px';

      clearMask();
      maskCanvas.classList.add('active');
    }

    // ============ Mask Drawing ============
    function setTool(tool) {
      currentTool = tool;
      document.getElementById('paintBtn').classList.toggle('active', tool === 'paint');
      document.getElementById('eraseBtn').classList.toggle('active', tool === 'erase');
    }

    function clearMask() {
      maskCtx.fillStyle = 'black';
      maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    }

    function startDraw(e) {
      isDrawing = true;
      draw(e);
    }

    function draw(e) {
      if (!isDrawing) return;

      const rect = maskCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      maskCtx.beginPath();
      maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      maskCtx.fillStyle = currentTool === 'paint' ? 'white' : 'black';
      maskCtx.fill();
    }

    function stopDraw() {
      isDrawing = false;
    }

    // ============ Scene Analysis ============
    async function analyzeScene() {
      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId: currentImageId })
        });

        const data = await response.json();

        if (data.elements) {
          displayElements(data);
        }
      } catch (error) {
        console.error('Analysis error:', error);
      }
    }

    function displayElements(analysis) {
      const container = document.getElementById('sceneElements');

      if (!analysis.elements?.length) {
        container.innerHTML = '<p style="color: #666">No elements detected</p>';
        return;
      }

      container.innerHTML = analysis.elements.map(el =>
        `<span class="element-chip" data-label="${el.label}">${el.label} (${el.position})</span>`
      ).join('');

      container.innerHTML += `<p style="margin-top: 15px; color: #666; font-size: 0.85rem">
        Style: ${analysis.style} | Lighting: ${analysis.lighting}
      </p>`;

      // Click to add to instruction
      container.querySelectorAll('.element-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const input = document.getElementById('editInput');
          input.value += (input.value ? ' ' : '') + chip.dataset.label;
          input.focus();
        });
      });
    }

    // ============ Apply Edit ============
    async function applyEdit() {
      const instruction = document.getElementById('editInput').value.trim();

      if (!instruction) {
        showError('Please enter an edit instruction');
        return;
      }

      showLoading(true);
      document.getElementById('applyBtn').disabled = true;

      try {
        // Check if mask has any white pixels
        const maskData = maskCanvas.toDataURL('image/png');
        const hasMask = await checkMaskHasContent();

        const response = await fetch('/api/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageId: currentImageId,
            instruction,
            maskDataUrl: hasMask ? maskData : null
          })
        });

        const data = await response.json();

        if (data.success && data.outputDataUrl) {
          showPreview(data.outputDataUrl);
          clearMask();
          showError(null);
        } else {
          showError(data.error || 'Edit failed');
        }
      } catch (error) {
        showError(error.message);
      }

      showLoading(false);
      document.getElementById('applyBtn').disabled = false;
    }

    async function checkMaskHasContent() {
      const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      const data = imageData.data;

      // Check if any pixel is not black
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 10) return true; // R channel > 10 means not black
      }

      return false;
    }

    // ============ UI Helpers ============
    function showLoading(show) {
      document.getElementById('loading').classList.toggle('active', show);
    }

    function showError(message) {
      const container = document.getElementById('errorContainer');
      if (message) {
        container.innerHTML = `<div class="error">${message}</div>`;
      } else {
        container.innerHTML = '';
      }
    }
  </script>
</body>
</html>
```

---

## Step 6: Test Locally (5 minutes)

### 6.1 Set API Key

```bash
export GOOGLE_AI_API_KEY=your_key_here
```

### 6.2 Run Development Server

```bash
npm run dev
```

### 6.3 Test

1. Open http://localhost:3000
2. Upload an image
3. Type "make the sky more blue"
4. Click Apply Edit

---

## Step 7: Deploy to Production (15 minutes)

### 7.1 Create .gitignore

```
node_modules/
dist/
.env
```

### 7.2 Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create my-ai-editor --public --push
```

### 7.3 Deploy to Render

1. Go to render.com
2. New → Web Service
3. Connect GitHub repo
4. Configure:
   - Build: `npm install && npm run build`
   - Start: `npm start`
   - Add env var: `GOOGLE_AI_API_KEY`
5. Deploy

---

## Troubleshooting

### "No image in response"
- Ensure `responseModalities: ['image', 'text']` is set

### "500 Internal Server Error"
- Gemini server issue - retry logic handles this

### Mask not aligned
- Ensure maskCanvas size matches image display size

### Elements move after flatten
- Use relative positioning from image bounds, not container

---

## Next Steps

1. Add undo/redo (see full implementation)
2. Add zoom controls
3. Add element compositing
4. Add keyboard shortcuts
5. Improve mobile support

---

*Happy building!*
