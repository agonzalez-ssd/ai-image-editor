# AI Image Editor

> Browser-based AI image editing powered by Google Gemini

## Features

- **Natural Language Editing** - "Remove the person", "Make the sky more blue"
- **Masked Editing** - Paint areas to edit, AI modifies only those regions
- **Scene Analysis** - AI identifies all objects in your image
- **Element Compositing** - Add logos/objects with drag, resize, undo/redo
- **Quick Actions** - One-click remove background, upscale, analyze

## Quick Start (5 Minutes)

### 1. Get API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with Google
3. Click "Create API Key"
4. Copy the key (starts with `AIza...`)

### 2. Install & Run

```bash
# Clone the repo
git clone <your-repo-url>
cd ai-image-editor

# Install dependencies
npm install

# Create .env file with your API key
echo "GOOGLE_AI_API_KEY=your_key_here" > .env

# Start the web interface
npm run web
```

### 3. Open Browser

Navigate to **http://localhost:3000**

## Deployment

### Option 1: Railway (Easiest)

```bash
# Install CLI
npm install -g @railway/cli

# Deploy
railway login
railway init
railway up
railway variables set GOOGLE_AI_API_KEY=your_key_here
```

### Option 2: Render

1. Push to GitHub
2. Go to [render.com](https://render.com)
3. Create "Web Service" → Connect repo
4. Set **Build Command**: `npm install && npm run build`
5. Set **Start Command**: `npm start`
6. Add environment variable: `GOOGLE_AI_API_KEY`

### Option 3: Fly.io

```bash
# Install CLI
brew install flyctl

# Deploy
fly auth login
fly launch
fly secrets set GOOGLE_AI_API_KEY=your_key_here
fly deploy
```

## Usage

| Feature | How to Use |
|---------|------------|
| **Edit Image** | Upload image → Type instruction → Click "Apply Edit" |
| **Masked Edit** | Click "Paint" → Paint area → Enter instruction → Apply |
| **Click Select** | Click "Click Select" → Click object → It gets selected |
| **Add Element** | Drop PNG in "Add Elements" → Drag/resize on image → "Flatten" |
| **Undo/Redo** | Use buttons or Ctrl+Z / Ctrl+Y |

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Backend**: Node.js + Express + TypeScript
- **AI**: Google Gemini (gemini-3-pro-image-preview)
- **Image Processing**: Sharp

## Project Structure

```
ai-image-editor/
├── web/
│   ├── server.ts           # Express API server
│   └── public/
│       └── index.html      # Frontend (single file)
├── src/
│   └── orchestrator/
│       ├── gemini-editor.ts    # Gemini image editing
│       └── gemini-director.ts  # Scene analysis
├── docs/
│   └── IMPLEMENTATION-GUIDE.md # Detailed documentation
├── package.json
└── .env                    # Your API key (not in git)
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/upload` | Upload image for editing |
| `POST /api/analyze` | Analyze scene elements |
| `POST /api/edit` | Execute edit with instruction |
| `POST /api/segment-point` | Generate mask at click point |
| `POST /api/segment-label` | Generate mask for labeled object |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_AI_API_KEY` | Yes | Google AI API key |
| `PORT` | No | Server port (default: 3000) |

## Cost

Google AI API pricing (~$0.001 per edit). Free tier available.

## Documentation

See [docs/IMPLEMENTATION-GUIDE.md](docs/IMPLEMENTATION-GUIDE.md) for:
- Detailed architecture
- Development journey
- Issues & solutions
- Extension guide
- Troubleshooting

## Author

**Alvaro Gonzalez**

---
*Last Updated: November 2024*
