# Cloud-First Architecture - Zero Installation

## Philosophy

**No local installations. No GPU setup. Just API keys.**

Everything runs via cloud APIs, orchestrated by the google-gemini-mcp that's already available in your workspace.

## Revised Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                                 │
│              (google-gemini-mcp - Already Available!)           │
│  • generate_text → Intent parsing, workflow planning            │
│  • analyze_image → Scene understanding                          │
│  • generate_image → Direct image generation                     │
│  • agentic_workflow → Multi-step automation                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUD API LAYER                              │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │   Replicate.com  │  │    Fal.ai        │                     │
│  │  ─────────────── │  │  ─────────────── │                     │
│  │  • Grounding DINO│  │  • Fast SDXL     │                     │
│  │  • SAM 2         │  │  • Flux          │                     │
│  │  • IC-Light      │  │  • Real-time     │                     │
│  │  • LaMa          │  │    inference     │                     │
│  │  • SDXL/Flux     │  │                  │                     │
│  └──────────────────┘  └──────────────────┘                     │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │  Remove.bg API   │  │  Clipdrop API    │                     │
│  │  ─────────────── │  │  ─────────────── │                     │
│  │  • Background    │  │  • Object remove │                     │
│  │    removal       │  │  • Relighting    │                     │
│  │  • One-click     │  │  • Cleanup       │                     │
│  └──────────────────┘  └──────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

## API Services Comparison

### Option A: Replicate.com (Recommended)
**Why**: Hosts ALL the models we need under one API

| Model | Replicate Model ID | Cost |
|-------|-------------------|------|
| Grounding DINO | `idea-research/grounding-dino` | ~$0.0005/run |
| SAM 2 | `meta/sam-2` | ~$0.001/run |
| SDXL | `stability-ai/sdxl` | ~$0.003/run |
| Flux | `black-forest-labs/flux-schnell` | ~$0.003/run |
| LaMa Inpainting | `andreasjansson/lama` | ~$0.001/run |
| IC-Light | `lllyasviel/ic-light` | ~$0.005/run |
| Remove Background | `cjwbw/rembg` | ~$0.001/run |

**Total cost per edit**: ~$0.01-0.02

### Option B: Fal.ai
**Why**: Faster inference, simpler API

| Capability | Endpoint |
|------------|----------|
| Image Generation | `fal-ai/flux` |
| Inpainting | `fal-ai/flux-inpainting` |
| Background Removal | `fal-ai/rembg` |

### Option C: Specialized APIs (Simplest)
**Why**: One API call = one complete operation

| Service | What it does | API |
|---------|--------------|-----|
| Remove.bg | Background removal | REST API |
| Clipdrop | Relighting, cleanup, remove objects | REST API |
| Photoroom | Background + editing | REST API |

## Recommended Approach: Hybrid

```
Primary: Google Gemini (via existing MCP)
├── Vision analysis
├── Intent parsing
├── Workflow orchestration
└── Direct image generation

Secondary: Replicate.com (one API key)
├── Grounding DINO (detection)
├── SAM 2 (segmentation)
├── LaMa (inpainting)
└── IC-Light (relighting)

Fallback: Specialized APIs
├── Remove.bg (background)
└── Clipdrop (quick edits)
```

## What You Need

### API Keys Required

| Service | Free Tier | Sign Up |
|---------|-----------|---------|
| Google AI (Gemini) | ✅ Already configured! | - |
| Replicate | $5 free credit | replicate.com |
| Remove.bg | 50 free/month | remove.bg |
| Clipdrop | 100 free/month | clipdrop.co |

### Zero Installation Checklist

- [x] Google Gemini API key (already in MCP config)
- [ ] Replicate API token
- [ ] (Optional) Remove.bg API key
- [ ] (Optional) Clipdrop API key

## Automated Workflow Example

```
User: "Remove the person from this photo and fill the background naturally"

┌──────────────────────────────────────────────────────────────┐
│ Step 1: Gemini analyzes image                                │
│ mcp__google_gemini__analyze_image                            │
│ → Identifies: person at coordinates [x1,y1,x2,y2]            │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 2: SAM 2 creates precise mask (via Replicate)           │
│ POST https://api.replicate.com/v1/predictions                │
│ → Returns: binary mask of person                             │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 3: LaMa inpaints the masked area (via Replicate)        │
│ POST https://api.replicate.com/v1/predictions                │
│ → Returns: image with person removed, background filled      │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 4: Gemini verifies result quality                       │
│ mcp__google_gemini__analyze_image                            │
│ → Confirms: clean removal, natural background                │
└──────────────────────────────────────────────────────────────┘
```

## Implementation: Single TypeScript File

The entire system can be a single orchestrator that:
1. Uses google-gemini-mcp for intelligence
2. Calls Replicate API for specialized models
3. Returns results

No servers to run. No Docker. No GPU setup.

---
*Architecture Version: 2.0.0 (Cloud-First)*
*Created: 2025-11-25*
