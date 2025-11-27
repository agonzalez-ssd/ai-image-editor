# AI Image Editor - Implementation Guide

> Complete documentation for understanding, setting up, and extending the AI Image Editor.

**Last Updated:** November 2024
**Author:** Alvaro Gonzalez
**Status:** Production Ready (Gemini-only mode)

---

## Table of Contents

1. [Quick Setup (5 Minutes)](#1-quick-setup-5-minutes)
2. [Project Overview](#2-project-overview)
3. [Architecture](#3-architecture)
4. [Development Journey](#4-development-journey)
5. [Issues & Solutions](#5-issues--solutions)
6. [API Reference](#6-api-reference)
7. [Extending the System](#7-extending-the-system)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Quick Setup (5 Minutes)

### Prerequisites

- **Node.js 18+** (check with `node --version`)
- **Google AI API Key** (free tier available)

### Step 1: Get API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with Google account
3. Click "Create API Key"
4. Copy the key (starts with `AIza...`)

### Step 2: Install & Run

```bash
# Clone or navigate to the project
cd ai-image-editor

# Install dependencies
npm install

# Create .env file with your API key
echo "GOOGLE_AI_API_KEY=your_key_here" > .env

# Start the web interface
npm run web
```

### Step 3: Open in Browser

Navigate to **http://localhost:3000**

That's it! You can now:
- Upload images
- Use natural language to edit ("make the sky more blue")
- Paint masks for selective editing
- Add elements (logos, objects) and flatten them onto images

---

## 2. Project Overview

### What This Project Does

A browser-based AI image editor that uses Google's Gemini models for:

| Feature | Description |
|---------|-------------|
| **Natural Language Editing** | "Remove the person" → AI understands and edits |
| **Masked Editing** | Paint areas to edit, AI modifies only those regions |
| **Scene Analysis** | AI identifies all objects in an image |
| **Element Compositing** | Add logos/objects with undo/redo support |
| **Quick Operations** | Remove background, upscale, analyze |

### Technology Stack

```
Frontend:  Vanilla HTML/CSS/JavaScript (no build step)
Backend:   Node.js + Express + TypeScript
AI:        Google Gemini (gemini-3-pro-image-preview)
Image:     Sharp (server-side compositing)
```

### File Structure

```
ai-image-editor/
├── web/
│   ├── server.ts              # Express server (API endpoints)
│   └── public/
│       └── index.html         # Complete frontend (single file)
├── src/
│   └── orchestrator/
│       ├── gemini-editor.ts   # Gemini image editing class
│       ├── gemini-director.ts # Scene analysis & planning
│       ├── replicate-client.ts# (Legacy) Replicate API
│       └── ai-image-editor.ts # (Legacy) CLI orchestrator
├── docs/
│   └── IMPLEMENTATION-GUIDE.md # This file
├── package.json
├── tsconfig.json
└── .env                       # Your API key (not in git)
```

---

## 3. Architecture

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (index.html)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Image Upload │  │ Mask Canvas  │  │ Element Layer│          │
│  │ + Preview    │  │ (paint/select)│ │ (drag/resize)│          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              History System (Undo/Redo)                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼ HTTP POST
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND (server.ts)                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Endpoints:                                                 │  │
│  │  POST /api/upload       → Store image in memory           │  │
│  │  POST /api/analyze      → Scene analysis via Director     │  │
│  │  POST /api/edit         → Execute edit via Editor         │  │
│  │  POST /api/segment-point→ Click-to-select segmentation   │  │
│  │  POST /api/segment-label→ Label-based segmentation       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Sharp Compositing (mask-based pixel blending)             │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼ Google Generative AI SDK
┌─────────────────────────────────────────────────────────────────┐
│                  GOOGLE GEMINI API (Cloud)                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ gemini-3-pro-image-preview (Nano Banana Pro)              │  │
│  │  • Native image generation (responseModalities: 'image')  │  │
│  │  • 4K resolution support                                   │  │
│  │  • Accurate text rendering                                 │  │
│  │  • Multi-image input (source + mask + references)         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ gemini-2.0-flash-exp (Scene Analysis)                     │  │
│  │  • Fast scene understanding                                │  │
│  │  • Object detection & labeling                             │  │
│  │  • Edit planning                                           │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow: Masked Edit

```
1. User paints mask on canvas
2. User enters instruction: "Change color to red"
3. Frontend sends to /api/edit:
   {
     imageSource: "data:image/png;base64,...",
     instruction: "Change color to red",
     mask: "data:image/png;base64,..."  // Black/white mask
   }

4. Server:
   a. Calls GeminiEditor.editWithMask()
   b. Gemini returns fully edited image
   c. Server uses Sharp to composite:
      - Edited pixels where mask is WHITE
      - Original pixels where mask is BLACK
   d. Returns composited result

5. Frontend displays result with download option
```

---

## 4. Development Journey

### Phase 1: Initial Architecture (Replicate Pipeline)

**Goal:** Build a modular AI editing system with specialized tools

**Original Design:**
- **Director (Gemini)** → Analyzes scene, plans edits
- **Navigator (Grounding DINO + SAM)** → Object detection & segmentation
- **Workers (LaMa, IC-Light, REMBG)** → Specialized editing operations

**Challenge:** Replicate models were slow (~30-60s per operation), expensive, and required chaining multiple API calls.

### Phase 2: Gemini Native Image Generation

**Discovery:** Gemini 3 Pro (Nano Banana Pro) supports native image output with `responseModalities: ['image', 'text']`

**Decision:** Pivot to Gemini-only architecture:
- Single API call for most edits
- Faster response (~5-15s)
- Lower cost (~$0.001 per edit)
- Better instruction following

### Phase 3: Hybrid Compositing

**Problem:** Gemini's masked editing doesn't always respect mask boundaries perfectly.

**Solution:** Hybrid approach:
1. Let Gemini do the creative edit (full image)
2. Use Sharp for pixel-perfect compositing
3. Only replace pixels where mask is white

```typescript
// server.ts: compositeMaskedEdit()
for (let i = 0; i < origWidth * origHeight; i++) {
  const maskValue = maskResized[i]; // 0-255
  const blend = maskValue / 255;    // 0-1

  // Blend original and edited based on mask
  output[i * 4] = Math.round(origR * (1 - blend) + editR * blend);
  output[i * 4 + 1] = Math.round(origG * (1 - blend) + editG * blend);
  output[i * 4 + 2] = Math.round(origB * (1 - blend) + editB * blend);
  output[i * 4 + 3] = origA;
}
```

### Phase 4: Element Compositing + History

**Requirements:**
- Add logos/objects to images
- Drag to position, resize with handles
- Undo/redo support
- Flatten to single image

**Implementation:**
- Canvas-based element rendering
- History stack with state snapshots
- Coordinate transformation for accurate flattening

---

## 5. Issues & Solutions

### Issue 1: Gemini Returns Text Instead of Image

**Symptom:** Edit requests return text explanation instead of image

**Root Cause:** Model doesn't always generate images

**Solution:**
1. Use `gemini-3-pro-image-preview` model specifically
2. Set `responseModalities: ['image', 'text']`
3. Include explicit instruction: "You MUST output the edited image"

```typescript
// gemini-editor.ts
this.model = this.genAI.getGenerativeModel({
  model: 'gemini-3-pro-image-preview',
  generationConfig: {
    responseModalities: ['image', 'text'],
    temperature: 1,
  },
});
```

### Issue 2: Mask Not Respected

**Symptom:** Edits affect areas outside the painted mask

**Solution:** Server-side compositing with Sharp

```typescript
// Instead of trusting Gemini's mask handling:
const compositedResult = await compositeMaskedEdit(
  originalImage,
  geminiEditedImage,
  mask
);
```

### Issue 3: Element Size Changes on Flatten

**Symptom:** Elements appear larger/smaller after flattening

**Root Cause:** Scale calculations didn't account for zoom level and image offset within container

**Solution:** Calculate position relative to displayed image bounds:

```javascript
// Get displayed image position
const imgRect = img.getBoundingClientRect();
const previewRect = preview.getBoundingClientRect();
const imageOffsetX = imgRect.left - previewRect.left;

// Element position relative to image
const relativeX = elLeft - imageOffsetX;
const relativeY = elTop - imageOffsetY;

// Scale to natural image coordinates
const naturalX = relativeX * scaleX;
const naturalY = relativeY * scaleY;
```

### Issue 4: TypeScript `@ts-ignore` for Gemini SDK

**Symptom:** TypeScript errors for `responseModalities` and `inlineData`

**Root Cause:** SDK types not updated for image generation features

**Solution:** Use `@ts-ignore` comments for now (temporary until SDK updates)

```typescript
// @ts-ignore - responseModalities is available in newer API versions
responseModalities: ['image', 'text'],
```

### Issue 5: Large Base64 Images in Requests

**Symptom:** Request body too large errors

**Solution:** Configure Express body limits:

```typescript
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
```

---

## 6. API Reference

### POST /api/upload

Upload an image for editing.

```javascript
// Request
const formData = new FormData();
formData.append('image', file);

// Response
{
  "id": "upload_1234567890",
  "preview": "data:image/png;base64,..."
}
```

### POST /api/analyze

Analyze scene elements in an image.

```javascript
// Request
{
  "imageSource": "upload_id" | "data:image/..." | "https://..."
}

// Response
{
  "success": true,
  "scene": {
    "elements": [
      { "label": "person", "position": "left", ... }
    ],
    "lighting": "natural",
    "style": "photograph",
    ...
  }
}
```

### POST /api/edit

Execute an edit operation.

```javascript
// Request
{
  "imageSource": "upload_id" | "data:image/...",
  "instruction": "Make the sky more blue",
  "mask": "data:image/png;base64,..." | null,  // Optional
  "referenceElements": [  // Optional
    { "label": "logo", "dataUrl": "data:image/..." }
  ],
  "quickOperation": "remove-bg" | "upscale" | null  // Optional
}

// Response
{
  "success": true,
  "outputUrl": "data:image/png;base64,...",
  "operations": ["gemini-edit", "mask-composite"]
}
```

### POST /api/segment-point

Generate mask for object at clicked point.

```javascript
// Request
{
  "imageSource": "data:image/...",
  "point": { "x": 150, "y": 200 }
}

// Response
{
  "success": true,
  "maskUrl": "data:image/png;base64,..."
}
```

### POST /api/segment-label

Generate mask for labeled object.

```javascript
// Request
{
  "imageSource": "data:image/...",
  "label": "person"
}

// Response
{
  "success": true,
  "maskUrl": "data:image/png;base64,..."
}
```

---

## 7. Extending the System

### Adding a New Edit Operation

1. **Backend (gemini-editor.ts):** Add method to GeminiEditor class

```typescript
async customEdit(imageSource: string, params: object): Promise<GeminiEditResult> {
  const sourceData = await this.prepareImageData(imageSource);

  const result = await this.model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { text: `Your custom prompt here with ${params}` },
        { inlineData: { mimeType: 'image/png', data: sourceData } }
      ]
    }]
  });

  // Extract image from response...
}
```

2. **Backend (server.ts):** Add endpoint

```typescript
app.post('/api/custom-edit', async (req, res) => {
  const { imageSource, params } = req.body;
  const editor = createGeminiEditor();
  const result = await editor.customEdit(imageSource, params);
  res.json(result);
});
```

3. **Frontend (index.html):** Add button and handler

```javascript
async function customEdit() {
  const response = await fetch('/api/custom-edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageSource: currentImageSource, params: {...} })
  });
  // Handle response...
}
```

### Adding a New Quick Action

1. **Frontend:** Add button in `.quick-actions`

```html
<button class="quick-btn" onclick="quickEdit('my-operation')">
  <div class="icon">🎯</div>
  <div class="label">My Op</div>
</button>
```

2. **Backend:** Handle in `/api/edit` quickOperation switch

```typescript
if (quickOperation === 'my-operation') {
  result = await geminiEditor.editImage(source, 'Your prompt here');
}
```

---

## 8. Troubleshooting

### "Gemini API key required" Error

**Fix:** Create `.env` file in project root:
```bash
echo "GOOGLE_AI_API_KEY=your_key_here" > .env
```

### Server Doesn't Start

**Check:**
1. Node.js 18+ installed: `node --version`
2. Dependencies installed: `npm install`
3. Port 3000 available: `lsof -i :3000`

### Edits Return "No image in response"

**Possible causes:**
1. API key quota exceeded (check Google Cloud Console)
2. Image too complex for single request
3. Prompt triggering safety filters

**Fix:** Try simpler prompt or smaller image

### Elements Not Flattening Correctly

**Check:** Zoom level is 1:1 before flattening (click "1:1" button)

### Large Images Fail to Upload

**Fix:** Image must be < 50MB. Compress before uploading.

---

## Support

- **Issues:** Check console logs (F12 → Console)
- **API Limits:** [Google AI Studio](https://aistudio.google.com/)
- **Project Location:** `03-projects/alvaro/ai-image-editor/`

---

*This guide documents the AI Image Editor as of November 2024. Architecture may evolve as Gemini APIs improve.*
