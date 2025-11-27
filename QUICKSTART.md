# Quick Start - AI Image Editor

Get editing images in 5 minutes. No GPU, no local models, no complex setup.

## Step 1: Get API Keys

### Replicate ($5 free credit)
1. Go to [replicate.com](https://replicate.com)
2. Sign in with GitHub
3. [Get API Token](https://replicate.com/account/api-tokens)
4. Copy token (starts with `r8_`)

### Google AI (Free tier)
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with Google
3. Click "Create API Key"
4. Copy the key

## Step 2: Set Environment Variables

```bash
# Add to ~/.zshrc or ~/.bashrc
export REPLICATE_API_TOKEN="r8_your_token_here"
export GOOGLE_AI_API_KEY="your_gemini_key_here"

# Reload
source ~/.zshrc
```

## Step 3: Install

```bash
cd /Users/alvarogonzalez/Desktop/unified-workspace/03-projects/alvaro/ai-image-editor
npm install
```

## Step 4: Edit Images!

### Natural Language Editing

```bash
# The AI analyzes the image, plans operations, and executes
npm run edit -- "https://images.unsplash.com/photo-1506905925346-21bda4d32df4" "remove background"
```

### Quick Operations

```bash
# Skip AI planning - direct execution
npm run edit -- "https://example.com/photo.jpg" --remove-bg
npm run edit -- "https://example.com/photo.jpg" --upscale
npm run edit -- "https://example.com/photo.jpg" --remove "watermark"
```

## Example Output

```
🎨 AI Image Editor - Cloud Pipeline
📝 Instruction: "remove the person on the left"
🖼️  Image: https://example.com/photo.jpg

━━━ LAYER 1: DIRECTOR (Gemini Vision) ━━━
  [1/2] Analyzing scene...
  ✓ Found 3 element(s)
      • person (left)
      • car (center)
      • building (background)
  [2/2] Planning edit...
  ✓ Plan: 1 operation(s), 92% confidence
    Reasoning: User wants to remove the person from the left side

━━━ LAYERS 2-3: NAVIGATOR + WORKERS (Replicate) ━━━
  [1/1] REMOVE: person
      ✓ Complete → https://replicate.delivery/pbxt/...

══════════════════════════════════════════════════
✅ Edit Complete!
📤 Output: https://replicate.delivery/pbxt/abc123...
⏱️  Time: 8.3s
🔧 Operations: 1
══════════════════════════════════════════════════
```

## What Can It Do?

| Say This | It Does This |
|----------|--------------|
| "remove background" | Extracts subject, transparent background |
| "remove the watermark" | Finds watermark, removes it cleanly |
| "make lighting dramatic" | Applies cinematic relighting |
| "upscale" | 4x resolution increase |
| "replace the sky with sunset" | Detects sky, replaces it |

## Costs

| What | Cost |
|------|------|
| Simple edit (remove bg) | ~$0.001 |
| Complex edit (AI planning + removal) | ~$0.02 |
| $5 Replicate credit | ~250 complex edits |

## Troubleshooting

### "Replicate API token required"
```bash
echo $REPLICATE_API_TOKEN  # Should show your token
```

### "Gemini API key required"
```bash
echo $GOOGLE_AI_API_KEY  # Should show your key
```

### "Could not find X in the image"
The object detection model couldn't locate what you described. Try:
- Being more specific: "red car" instead of "car"
- Using simpler terms: "person" instead of "man in blue shirt"

## Next Steps

- Try different editing commands
- Use `--remove` flag for specific object removal
- Chain operations: first remove background, then upscale
