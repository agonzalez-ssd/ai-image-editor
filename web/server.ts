/**
 * Web Server for AI Image Editor
 * Provides a visual interface for editing images
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { createGeminiDirector } from '../src/orchestrator/gemini-director.js';
import { createGeminiEditor } from '../src/orchestrator/gemini-editor.js';

// ============ Image Utilities ============

/**
 * Convert a data URL or base64 string to a Buffer
 */
async function imageToBuffer(source: string): Promise<Buffer> {
  if (source.startsWith('data:')) {
    const base64 = source.split(',')[1];
    return Buffer.from(base64, 'base64');
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await fetch(source);
    return Buffer.from(await response.arrayBuffer());
  }
  return Buffer.from(source, 'base64');
}

/**
 * Composite edited image onto original using mask
 * Only pixels where mask is white will be replaced
 */
async function compositeMaskedEdit(
  originalSource: string,
  editedSource: string,
  maskSource: string
): Promise<string> {
  // Convert all sources to buffers
  const originalBuffer = await imageToBuffer(originalSource);
  const editedBuffer = await imageToBuffer(editedSource);
  const maskBuffer = await imageToBuffer(maskSource);

  // Get original dimensions
  const originalMeta = await sharp(originalBuffer).metadata();
  const origWidth = originalMeta.width!;
  const origHeight = originalMeta.height!;

  console.log(`  Compositing: original ${origWidth}x${origHeight}`);

  // Resize edited image to match original dimensions
  const editedResized = await sharp(editedBuffer)
    .resize(origWidth, origHeight, { fit: 'fill' })
    .raw()
    .toBuffer();

  // Resize mask to match original dimensions and ensure it's grayscale
  const maskResized = await sharp(maskBuffer)
    .resize(origWidth, origHeight, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();

  // Get original as raw pixels
  const originalRaw = await sharp(originalBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer();

  // Get edited as raw pixels with alpha
  const editedMeta = await sharp(editedBuffer).metadata();
  const editedChannels = editedMeta.channels || 3;

  // Create output buffer (RGBA)
  const output = Buffer.alloc(origWidth * origHeight * 4);

  // Composite pixel by pixel
  for (let i = 0; i < origWidth * origHeight; i++) {
    const maskValue = maskResized[i]; // 0-255, white = 255
    const blend = maskValue / 255; // 0-1

    // Get original pixel (RGBA)
    const origR = originalRaw[i * 4];
    const origG = originalRaw[i * 4 + 1];
    const origB = originalRaw[i * 4 + 2];
    const origA = originalRaw[i * 4 + 3];

    // Get edited pixel (may be RGB or RGBA)
    let editR, editG, editB;
    if (editedChannels === 4) {
      editR = editedResized[i * 4];
      editG = editedResized[i * 4 + 1];
      editB = editedResized[i * 4 + 2];
    } else {
      editR = editedResized[i * 3];
      editG = editedResized[i * 3 + 1];
      editB = editedResized[i * 3 + 2];
    }

    // Blend based on mask
    output[i * 4] = Math.round(origR * (1 - blend) + editR * blend);
    output[i * 4 + 1] = Math.round(origG * (1 - blend) + editG * blend);
    output[i * 4 + 2] = Math.round(origB * (1 - blend) + editB * blend);
    output[i * 4 + 3] = origA;
  }

  // Convert back to PNG
  const resultBuffer = await sharp(output, {
    raw: { width: origWidth, height: origHeight, channels: 4 }
  }).png().toBuffer();

  return `data:image/png;base64,${resultBuffer.toString('base64')}`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Increase body size limit for large images + masks
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Handle static files - works in both dev (web/) and prod (dist/web/)
const publicPath = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, '../../web/public')
  : path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Store uploaded images temporarily as base64
const uploadedImages: Map<string, string> = new Map();

// Upload endpoint
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const id = `upload_${Date.now()}`;
  const base64 = req.file.buffer.toString('base64');
  const mimeType = req.file.mimetype;
  const dataUrl = `data:${mimeType};base64,${base64}`;

  uploadedImages.set(id, dataUrl);

  // Clean up after 1 hour
  setTimeout(() => uploadedImages.delete(id), 3600000);

  res.json({ id, preview: dataUrl });
});

// Analyze endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageSource } = req.body;
    const source = uploadedImages.get(imageSource) || imageSource;

    const director = createGeminiDirector();
    const scene = await director.analyzeScene(source);

    res.json({ success: true, scene });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Plan edit endpoint
app.post('/api/plan', async (req, res) => {
  try {
    const { imageSource, instruction } = req.body;
    const source = uploadedImages.get(imageSource) || imageSource;

    const director = createGeminiDirector();
    const scene = await director.analyzeScene(source);
    const plan = await director.planEdit(instruction, scene);

    res.json({
      success: true,
      scene,
      plan,
      description: director.describeEditPlan(plan)
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Segment by point endpoint (click select)
app.post('/api/segment-point', async (req, res) => {
  try {
    const { imageSource, point } = req.body;
    const source = uploadedImages.get(imageSource) || imageSource;

    console.log('\n========== SEGMENT POINT REQUEST ==========');
    console.log('Point:', point);

    // Use Gemini to describe and segment the object at the clicked point
    const geminiEditor = createGeminiEditor();
    const result = await geminiEditor.segmentAtPoint(source, point);

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Segmentation failed' });
    }

    res.json({ success: true, maskUrl: result.maskUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Segment by label endpoint (click on scene element)
app.post('/api/segment-label', async (req, res) => {
  try {
    const { imageSource, label } = req.body;
    const source = uploadedImages.get(imageSource) || imageSource;

    console.log('\n========== SEGMENT LABEL REQUEST ==========');
    console.log('Label:', label);

    // Use Gemini to segment the labeled object
    const geminiEditor = createGeminiEditor();
    const result = await geminiEditor.segmentByLabel(source, label);

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Segmentation failed' });
    }

    res.json({ success: true, maskUrl: result.maskUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Edit endpoint - Gemini-only
app.post('/api/edit', async (req, res) => {
  try {
    const { imageSource, instruction, mask, referenceElements, quickOperation } = req.body;
    const source = uploadedImages.get(imageSource) || imageSource;

    // Handle quick operations
    if (quickOperation) {
      console.log('\n========== QUICK OPERATION ==========');
      console.log('Operation:', quickOperation);

      const geminiEditor = createGeminiEditor();
      let result;

      if (quickOperation === 'remove-bg') {
        result = await geminiEditor.editImage(source, 'Remove the background completely, making it transparent. Keep only the main subject/foreground elements.');
      } else if (quickOperation === 'upscale') {
        result = await geminiEditor.editImage(source, 'Enhance and upscale this image to higher quality. Improve details, sharpness, and clarity while maintaining the original content.');
      } else {
        return res.status(400).json({ error: `Unknown quick operation: ${quickOperation}` });
      }

      if (!result.success || !result.outputDataUrl) {
        return res.status(500).json({ error: result.error || 'Operation failed' });
      }

      return res.json({
        success: true,
        outputUrl: result.outputDataUrl,
        operations: [quickOperation]
      });
    }

    console.log('\n========== EDIT REQUEST ==========');
    console.log('Instruction:', instruction);
    console.log('Has Mask:', !!mask);
    console.log('Reference Elements:', referenceElements?.length || 0);
    if (referenceElements?.length > 0) {
      console.log('  Element labels:', referenceElements.map((r: any) => r.label).join(', '));
    }

    const geminiEditor = createGeminiEditor();

    // Masked edit - HYBRID APPROACH:
    // 1. Use Gemini for high-quality generation with good prompt understanding
    // 2. Manually composite only the masked pixels onto the original image
    if (mask) {
      console.log('  Using Gemini + Compositing hybrid approach');
      console.log('  Step 1: Generate edit with Gemini');

      let geminiResult;

      // Use editWithMaskAndReferences if we have reference elements
      if (referenceElements && referenceElements.length > 0) {
        console.log(`  Including ${referenceElements.length} reference element(s) in edit`);
        geminiResult = await geminiEditor.editWithMaskAndReferences(
          source,
          mask,
          instruction,
          referenceElements
        );
      } else {
        geminiResult = await geminiEditor.editWithMask(source, mask, instruction);
      }

      if (!geminiResult.success || !geminiResult.outputDataUrl) {
        console.log('  ✗ Gemini edit failed:', geminiResult.error);
        return res.status(500).json({ error: geminiResult.error || 'Gemini edit failed' });
      }

      console.log('  Step 2: Compositing masked pixels onto original');
      const compositedResult = await compositeMaskedEdit(
        source,
        geminiResult.outputDataUrl,
        mask
      );

      console.log('  ✓ Masked edit complete');

      return res.json({
        success: true,
        outputUrl: compositedResult,
        operations: ['gemini-edit', 'mask-composite'],
        processingTime: 0
      });
    }

    // No mask but has reference elements - use Gemini with references
    if (referenceElements && referenceElements.length > 0) {
      console.log(`  Using Gemini with ${referenceElements.length} reference element(s)`);

      const geminiResult = await geminiEditor.editWithReferences(
        source,
        instruction,
        referenceElements
      );

      if (!geminiResult.success || !geminiResult.outputDataUrl) {
        console.log('  ✗ Gemini edit with references failed:', geminiResult.error);
        return res.status(500).json({ error: geminiResult.error || 'Gemini edit failed' });
      }

      console.log('  ✓ Edit with references complete');

      return res.json({
        success: true,
        outputUrl: geminiResult.outputDataUrl,
        operations: ['gemini-edit-with-refs'],
        processingTime: 0
      });
    }

    // Standard edit (no mask, no references)
    console.log('  Using Gemini standard edit');
    const geminiResult = await geminiEditor.editImage(source, instruction);

    if (!geminiResult.success || !geminiResult.outputDataUrl) {
      console.log('  ✗ Gemini edit failed:', geminiResult.error);
      return res.status(500).json({ error: geminiResult.error || 'Gemini edit failed' });
    }

    console.log('  ✓ Edit complete');

    res.json({
      success: true,
      outputUrl: geminiResult.outputDataUrl,
      operations: ['gemini-edit'],
      processingTime: 0
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║     AI Image Editor - Web Interface              ║
╠══════════════════════════════════════════════════╣
║  Open in browser: http://localhost:${PORT}          ║
╚══════════════════════════════════════════════════╝
  `);
});
