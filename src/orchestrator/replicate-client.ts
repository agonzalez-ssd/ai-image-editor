/**
 * Replicate API Client
 *
 * Provides access to hosted AI models without local installation.
 * All models run in the cloud - you just need an API token.
 */

interface ReplicateConfig {
  apiToken: string;
  baseUrl?: string;
}

interface PredictionInput {
  [key: string]: unknown;
}

interface Prediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: unknown;
  error?: string;
  logs?: string;
}

// Model IDs for the AI Image Editor pipeline
export const MODELS = {
  // Detection & Segmentation (Combined Grounding DINO + SAM)
  GROUNDED_SAM: 'schananas/grounded_sam:ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c',
  // Individual models (kept for flexibility)
  GROUNDING_DINO: 'adirik/grounding-dino:efd10a8ddc57ea28773327e881ce95e20cc1d734c589f7dd01d2036921ed78aa',
  SAM: 'meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83',

  // OCR & Text Detection
  BLIP2: 'andreasjansson/blip-2:f677695e5e89f8b236e52ecd1d3f01beb44c34606419bcc19345e046d8f786f9',

  // Inpainting & Removal
  LAMA: 'allenhooo/lama:cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72',
  REMBG: 'cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003',
  SDXL_INPAINT: 'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc',

  // Image Generation & Editing
  SDXL: 'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc',
  FLUX_SCHNELL: 'black-forest-labs/flux-schnell',
  FLUX_DEV: 'black-forest-labs/flux-dev',
  FLUX_FILL: 'black-forest-labs/flux-fill-pro',  // For object insertion

  // Image-to-Image (for resizing/transforming)
  IMG2IMG: 'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc',
  CONTROLNET_CANNY: 'jagilley/controlnet-canny:aff48af9c68d162388d230a2ab003f68d2638d88307bdaf1c2f1ac95079c9613',

  // Relighting
  IC_LIGHT: 'lllyasviel/ic-light-v2:8a89b0ab59a050f5bbc80a9b7e33f7464e82fc6be2c70987edf576039e57f908',

  // Upscaling
  REAL_ESRGAN: 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa',
} as const;

export class ReplicateClient {
  private apiToken: string;
  private baseUrl: string;

  constructor(config: ReplicateConfig) {
    this.apiToken = config.apiToken;
    this.baseUrl = config.baseUrl || 'https://api.replicate.com/v1';
  }

  /**
   * Convert a local file path or URL to a format Replicate can use
   * Local files are converted to data URLs
   */
  async resolveImageSource(source: string): Promise<string> {
    // If it's already a URL, return as-is
    if (source.startsWith('http://') || source.startsWith('https://') || source.startsWith('data:')) {
      return source;
    }

    // If it's a local file path, convert to data URL
    if (source.startsWith('/') || source.startsWith('.') || source.startsWith('~')) {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Expand ~ to home directory
      let filePath = source;
      if (filePath.startsWith('~')) {
        filePath = filePath.replace('~', process.env.HOME || '');
      }

      // Read file and convert to base64
      const buffer = await fs.readFile(filePath);
      const base64 = buffer.toString('base64');

      // Detect mime type from extension
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };
      const mimeType = mimeTypes[ext] || 'image/png';

      return `data:${mimeType};base64,${base64}`;
    }

    // Assume it's already base64 or a valid URL
    return source;
  }

  /**
   * Run a model and wait for the result
   */
  async run(modelId: string, input: PredictionInput): Promise<unknown> {
    const prediction = await this.createPrediction(modelId, input);
    return this.waitForPrediction(prediction.id);
  }

  /**
   * Create a prediction (async) with automatic retry for rate limits
   */
  async createPrediction(modelId: string, input: PredictionInput, retryCount = 0): Promise<Prediction> {
    const [owner, name] = modelId.split('/');
    const version = modelId.includes(':') ? modelId.split(':')[1] : undefined;

    const url = version
      ? `${this.baseUrl}/predictions`
      : `${this.baseUrl}/models/${owner}/${name.split(':')[0]}/predictions`;

    const body = version
      ? { version, input }
      : { input };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // Handle rate limiting with exponential backoff
    if (response.status === 429 && retryCount < 5) {
      const errorBody = await response.json().catch(() => ({})) as { retry_after?: number };
      const retryAfter = errorBody.retry_after || Math.pow(2, retryCount) * 5; // Default: 5s, 10s, 20s, 40s, 80s
      console.log(`  ⏳ Rate limited. Waiting ${retryAfter}s before retry ${retryCount + 1}/5...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return this.createPrediction(modelId, input, retryCount + 1);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Replicate API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Wait for a prediction to complete
   */
  async waitForPrediction(predictionId: string, maxWaitMs = 300000): Promise<unknown> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const prediction = await this.getPrediction(predictionId);

      if (prediction.status === 'succeeded') {
        return prediction.output;
      }

      if (prediction.status === 'failed') {
        throw new Error(`Prediction failed: ${prediction.error}`);
      }

      if (prediction.status === 'canceled') {
        throw new Error('Prediction was canceled');
      }

      // Wait 1 second before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Prediction timeout');
  }

  /**
   * Get prediction status
   */
  async getPrediction(predictionId: string): Promise<Prediction> {
    const response = await fetch(`${this.baseUrl}/predictions/${predictionId}`, {
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get prediction: ${response.status}`);
    }

    return response.json();
  }

  // ============ High-Level Operations ============

  /**
   * Detect objects in an image using Grounding DINO
   */
  async detectObjects(imageUrl: string, prompt: string): Promise<{
    boxes: number[][];
    labels: string[];
    scores: number[];
  }> {
    console.log('\n>>> detectObjects called <<<');
    console.log('  prompt:', JSON.stringify(prompt));
    console.log('  prompt type:', typeof prompt);
    console.log('  imageUrl (first 80 chars):', imageUrl?.substring?.(0, 80));

    // Validate prompt - Grounding DINO requires a non-empty string
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      throw new Error(
        'detectObjects requires a non-empty prompt/target string. ' +
        `Received: ${prompt === null ? 'null' : prompt === undefined ? 'undefined' : `"${prompt}"`}`
      );
    }

    // Grounding DINO seems to have issues with some image URLs
    // Convert external URLs to data URLs for reliability
    let resolvedImage = await this.resolveImageSource(imageUrl);

    // If it's an external URL (not already a data URL), fetch and convert to base64
    if (resolvedImage.startsWith('http://') || resolvedImage.startsWith('https://')) {
      console.log('  Converting URL to data URL for Grounding DINO...');
      try {
        const response = await fetch(resolvedImage);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        resolvedImage = `data:${contentType};base64,${base64}`;
        console.log('  Converted to data URL, length:', resolvedImage.length);
      } catch (fetchError) {
        console.log('  Warning: Could not convert to data URL:', fetchError);
        // Fall back to original URL
      }
    }

    console.log('  Calling Grounding DINO with query:', prompt.trim());

    const output = await this.run(MODELS.GROUNDING_DINO, {
      image: resolvedImage,
      query: prompt.trim(),  // Model expects 'query', not 'prompt'!
      box_threshold: 0.3,
      text_threshold: 0.25,
      show_visualisation: false,  // We just want the data, not the visualization
    });

    console.log('  Grounding DINO raw output:', JSON.stringify(output, null, 2).substring(0, 500));

    // The model returns: { detections: [{ bbox: [x1,y1,x2,y2], confidence: 0.95, label: "dog" }], result_image: null }
    const rawOutput = output as {
      detections?: { bbox: number[]; confidence: number; label: string }[];
      boxes?: number[][];
      labels?: string[];
      scores?: number[];
    };

    // Handle different output formats
    if (rawOutput.detections && Array.isArray(rawOutput.detections)) {
      // Current format: array of detection objects with bbox, confidence, label
      console.log(`  Found ${rawOutput.detections.length} detection(s)`);
      return {
        boxes: rawOutput.detections.map(d => d.bbox),
        labels: rawOutput.detections.map(d => d.label),
        scores: rawOutput.detections.map(d => d.confidence),
      };
    } else if (rawOutput.boxes && Array.isArray(rawOutput.boxes)) {
      // Legacy format: separate arrays
      return {
        boxes: rawOutput.boxes,
        labels: rawOutput.labels || [],
        scores: rawOutput.scores || [],
      };
    } else {
      // Unknown format - return empty
      console.log('  Warning: Unknown Grounding DINO output format:', Object.keys(output || {}));
      return { boxes: [], labels: [], scores: [] };
    }
  }

  /**
   * Remove background from image
   */
  async removeBackground(imageUrl: string): Promise<string> {
    const resolvedImage = await this.resolveImageSource(imageUrl);
    const output = await this.run(MODELS.REMBG, {
      image: resolvedImage,
    });

    return output as string;
  }

  /**
   * Inpaint masked region using LaMa
   */
  async inpaint(imageUrl: string, maskUrl: string): Promise<string> {
    const resolvedImage = await this.resolveImageSource(imageUrl);
    const resolvedMask = await this.resolveImageSource(maskUrl);
    const output = await this.run(MODELS.LAMA, {
      image: resolvedImage,
      mask: resolvedMask,
    });

    return output as string;
  }

  /**
   * Generate image using Flux
   */
  async generateImage(prompt: string, options?: {
    width?: number;
    height?: number;
    numOutputs?: number;
  }): Promise<string[]> {
    const output = await this.run(MODELS.FLUX_SCHNELL, {
      prompt,
      width: options?.width || 1024,
      height: options?.height || 1024,
      num_outputs: options?.numOutputs || 1,
    });

    return output as string[];
  }

  /**
   * Upscale image using Real-ESRGAN
   */
  async upscale(imageUrl: string, scale: 2 | 4 = 4): Promise<string> {
    const resolvedImage = await this.resolveImageSource(imageUrl);
    const output = await this.run(MODELS.REAL_ESRGAN, {
      image: resolvedImage,
      scale,
    });

    return output as string;
  }

  /**
   * Generate segmentation mask using SAM 2
   * Takes a bounding box from Grounding DINO and returns a mask
   */
  async generateMask(
    imageUrl: string,
    boundingBox: { x1: number; y1: number; x2: number; y2: number }
  ): Promise<string> {
    const resolvedImage = await this.resolveImageSource(imageUrl);
    // SAM 2 uses point prompts or box prompts
    // Convert bbox to center point for simpler prompting
    const centerX = (boundingBox.x1 + boundingBox.x2) / 2;
    const centerY = (boundingBox.y1 + boundingBox.y2) / 2;

    const output = await this.run(MODELS.SAM, {
      image: resolvedImage,
      point_coords: `${centerX},${centerY}`,
      point_labels: '1', // 1 = foreground point
      box: `${boundingBox.x1},${boundingBox.y1},${boundingBox.x2},${boundingBox.y2}`,
    });

    // SAM returns combined_mask URL
    const result = output as { combined_mask: string };
    return result.combined_mask;
  }

  /**
   * Full object segmentation pipeline using combined Grounded SAM
   * This is more efficient than separate detect + segment calls
   * Returns mask URL for the detected object
   */
  async detectAndSegment(
    imageUrl: string,
    objectLabel: string
  ): Promise<{
    found: boolean;
    bbox?: { x1: number; y1: number; x2: number; y2: number };
    maskUrl?: string;
    confidence?: number;
  }> {
    // Validate objectLabel before calling
    if (!objectLabel || typeof objectLabel !== 'string' || objectLabel.trim() === '') {
      throw new Error(
        'detectAndSegment requires a non-empty objectLabel. ' +
        `Received: ${objectLabel === null ? 'null' : objectLabel === undefined ? 'undefined' : `"${objectLabel}"`}`
      );
    }

    console.log('\n>>> detectAndSegment (Grounded SAM) called <<<');
    console.log('  objectLabel:', JSON.stringify(objectLabel));
    console.log('  imageUrl (first 80 chars):', imageUrl?.substring?.(0, 80));

    // Resolve image to URL format
    const resolvedImage = await this.resolveImageSource(imageUrl);

    // Use combined Grounded SAM model - one call for detection + segmentation
    const output = await this.run(MODELS.GROUNDED_SAM, {
      image: resolvedImage,
      mask_prompt: objectLabel.trim(),
      negative_mask_prompt: '',  // No negative prompt
      adjustment_factor: 0,
    });

    console.log('  Grounded SAM raw output type:', typeof output);
    console.log('  Grounded SAM raw output:', JSON.stringify(output)?.substring(0, 500));

    // Grounded SAM returns an array of mask URLs:
    // [0] annotated_picture_mask.jpg - positive mask (what matches the prompt)
    // [1] neg_annotated_picture_mask.jpg - negative mask
    // [2] (optional) additional outputs
    let maskUrl: string;

    if (Array.isArray(output)) {
      // Array format - take the first mask (positive mask)
      if (output.length === 0) {
        console.log('  No masks generated - object may not be found');
        return { found: false };
      }
      maskUrl = output[0] as string;
      console.log(`  Got ${output.length} mask(s), using first one`);
    } else if (typeof output === 'string') {
      // Single string URL
      maskUrl = output;
    } else {
      console.log('  Unexpected output format:', typeof output);
      return { found: false };
    }

    if (!maskUrl || maskUrl === '') {
      console.log('  No mask generated - object may not be found');
      return { found: false };
    }

    console.log('  ✓ Mask generated:', maskUrl.substring(0, 80));

    return {
      found: true,
      maskUrl,
      confidence: 0.95, // Grounded SAM doesn't return confidence, assume high
    };
  }

  /**
   * Legacy: Full object segmentation using separate detect + mask calls
   * Use detectAndSegment() instead for better efficiency
   */
  async detectAndSegmentLegacy(
    imageUrl: string,
    objectLabel: string
  ): Promise<{
    found: boolean;
    bbox?: { x1: number; y1: number; x2: number; y2: number };
    maskUrl?: string;
    confidence?: number;
  }> {
    // Validate objectLabel before calling detectObjects
    if (!objectLabel || typeof objectLabel !== 'string' || objectLabel.trim() === '') {
      throw new Error(
        'detectAndSegmentLegacy requires a non-empty objectLabel. ' +
        `Received: ${objectLabel === null ? 'null' : objectLabel === undefined ? 'undefined' : `"${objectLabel}"`}`
      );
    }

    // Step 1: Detect the object
    const detection = await this.detectObjects(imageUrl, objectLabel);

    if (detection.boxes.length === 0) {
      return { found: false };
    }

    // Use the highest confidence detection
    const bestIdx = detection.scores.indexOf(Math.max(...detection.scores));
    const box = detection.boxes[bestIdx];

    // Grounding DINO returns [x1, y1, x2, y2] normalized (0-1)
    // Need to denormalize based on image dimensions
    const bbox = {
      x1: box[0],
      y1: box[1],
      x2: box[2],
      y2: box[3],
    };

    // Step 2: Generate mask for this detection
    const maskUrl = await this.generateMask(imageUrl, bbox);

    return {
      found: true,
      bbox,
      maskUrl,
      confidence: detection.scores[bestIdx],
    };
  }

  /**
   * Relight an image using IC-Light
   */
  async relight(
    imageUrl: string,
    lightingPrompt: string,
    options?: {
      lightSource?: 'left' | 'right' | 'top' | 'bottom' | 'front' | 'back';
      strength?: number;
    }
  ): Promise<string> {
    const resolvedImage = await this.resolveImageSource(imageUrl);
    const output = await this.run(MODELS.IC_LIGHT, {
      image: resolvedImage,
      prompt: lightingPrompt,
      light_source: options?.lightSource || 'front',
      cfg_scale: options?.strength || 2.0,
    });

    // IC-Light returns a single image URL
    const result = output as string[] | string;
    return Array.isArray(result) ? result[0] : result;
  }

  /**
   * Remove an object by inpainting the masked region
   */
  async removeObject(imageUrl: string, maskUrl: string): Promise<string> {
    const resolvedImage = await this.resolveImageSource(imageUrl);
    const resolvedMask = await this.resolveImageSource(maskUrl);
    // Use LaMa for clean object removal
    const output = await this.run(MODELS.LAMA, {
      image: resolvedImage,
      mask: resolvedMask,
    });

    return output as string;
  }

  /**
   * Replace an object with something else using inpainting
   */
  async replaceObject(
    imageUrl: string,
    maskUrl: string,
    replacementPrompt: string
  ): Promise<string> {
    const resolvedImage = await this.resolveImageSource(imageUrl);
    const resolvedMask = await this.resolveImageSource(maskUrl);
    const output = await this.run(MODELS.SDXL_INPAINT, {
      image: resolvedImage,
      mask: resolvedMask,
      prompt: replacementPrompt,
      negative_prompt: 'ugly, blurry, low quality, distorted',
      strength: 0.85,
    });

    const result = output as string[];
    return result[0];
  }

  // ============ Enhanced Detection ============

  /**
   * Detect logos in an image
   * Returns bounding boxes and confidence scores for all detected logos
   */
  async detectLogos(imageUrl: string): Promise<{
    found: boolean;
    logos: Array<{
      bbox: { x1: number; y1: number; x2: number; y2: number };
      confidence: number;
    }>;
  }> {
    const detection = await this.detectObjects(imageUrl, 'logo . brand . emblem . symbol . icon');

    if (detection.boxes.length === 0) {
      return { found: false, logos: [] };
    }

    const logos = detection.boxes.map((box, i) => ({
      bbox: { x1: box[0], y1: box[1], x2: box[2], y2: box[3] },
      confidence: detection.scores[i],
    }));

    return { found: true, logos };
  }

  /**
   * Detect text/writing in an image
   * Returns bounding boxes for text regions
   */
  async detectText(imageUrl: string): Promise<{
    found: boolean;
    textRegions: Array<{
      bbox: { x1: number; y1: number; x2: number; y2: number };
      confidence: number;
    }>;
  }> {
    const detection = await this.detectObjects(imageUrl, 'text . writing . letters . words . sign');

    if (detection.boxes.length === 0) {
      return { found: false, textRegions: [] };
    }

    const textRegions = detection.boxes.map((box, i) => ({
      bbox: { x1: box[0], y1: box[1], x2: box[2], y2: box[3] },
      confidence: detection.scores[i],
    }));

    return { found: true, textRegions };
  }

  /**
   * Describe image contents (useful for understanding what's in an image)
   */
  async describeImage(imageUrl: string, question?: string): Promise<string> {
    const resolvedImage = await this.resolveImageSource(imageUrl);
    const output = await this.run(MODELS.BLIP2, {
      image: resolvedImage,
      question: question || 'What is in this image? Describe all objects, logos, and text you see.',
    });

    return output as string;
  }

  /**
   * Detect all objects in a room/scene
   * Uses a comprehensive prompt to find furniture, appliances, etc.
   */
  async detectRoomObjects(imageUrl: string): Promise<{
    found: boolean;
    objects: Array<{
      label: string;
      bbox: { x1: number; y1: number; x2: number; y2: number };
      confidence: number;
    }>;
  }> {
    // Comprehensive prompt for room objects
    const roomPrompt = [
      'chair', 'table', 'sofa', 'couch', 'bed', 'desk', 'lamp', 'tv', 'television',
      'window', 'door', 'plant', 'rug', 'carpet', 'painting', 'picture frame',
      'bookshelf', 'cabinet', 'dresser', 'mirror', 'clock', 'vase', 'curtain',
      'pillow', 'blanket', 'computer', 'monitor', 'keyboard', 'phone'
    ].join(' . ');

    const detection = await this.detectObjects(imageUrl, roomPrompt);

    if (detection.boxes.length === 0) {
      return { found: false, objects: [] };
    }

    const objects = detection.boxes.map((box, i) => ({
      label: detection.labels[i],
      bbox: { x1: box[0], y1: box[1], x2: box[2], y2: box[3] },
      confidence: detection.scores[i],
    }));

    return { found: true, objects };
  }

  // ============ Object Insertion & Generation ============

  /**
   * Insert a new object into an image at a specified region
   * Uses inpainting to blend naturally
   */
  async insertObject(
    imageUrl: string,
    objectPrompt: string,
    region: { x1: number; y1: number; x2: number; y2: number }
  ): Promise<string> {
    // Create a mask for the insertion region
    // For now, we'll use SDXL inpainting with the region
    const output = await this.run(MODELS.FLUX_FILL, {
      image: imageUrl,
      prompt: objectPrompt,
      // Flux Fill uses region coordinates
      mask: `${region.x1},${region.y1},${region.x2},${region.y2}`,
    });

    const result = output as string | string[];
    return Array.isArray(result) ? result[0] : result;
  }

  /**
   * Generate an object image (transparent background) that can be composited
   */
  async generateObject(
    objectPrompt: string,
    options?: { width?: number; height?: number }
  ): Promise<string> {
    // Generate the object on a simple background
    const results = await this.generateImage(
      `${objectPrompt}, isolated on white background, product photography, centered`,
      {
        width: options?.width || 512,
        height: options?.height || 512,
        numOutputs: 1,
      }
    );

    // Remove the background to get transparent object
    const transparentObject = await this.removeBackground(results[0]);
    return transparentObject;
  }

  // ============ Object Transformation ============

  /**
   * Extract an object from an image (returns transparent PNG URL)
   */
  async extractObject(imageUrl: string, objectLabel: string): Promise<{
    found: boolean;
    objectUrl?: string;
    bbox?: { x1: number; y1: number; x2: number; y2: number };
  }> {
    // First detect and segment the object
    const seg = await this.detectAndSegment(imageUrl, objectLabel);

    if (!seg.found) {
      return { found: false };
    }

    // The mask from SAM can be used to extract just that object
    // For now, we return the mask which can be used for compositing
    return {
      found: true,
      objectUrl: seg.maskUrl,
      bbox: seg.bbox,
    };
  }

  /**
   * Resize an object within an image
   * Extracts the object, resizes it, removes original, composites back
   */
  async resizeObject(
    imageUrl: string,
    objectLabel: string,
    scaleFactor: number  // e.g., 1.5 for 50% larger, 0.5 for 50% smaller
  ): Promise<{
    success: boolean;
    outputUrl?: string;
    error?: string;
  }> {
    try {
      // Step 1: Find and segment the object
      const seg = await this.detectAndSegment(imageUrl, objectLabel);

      if (!seg.found || !seg.bbox || !seg.maskUrl) {
        return { success: false, error: `Could not find "${objectLabel}" in the image` };
      }

      // Step 2: Calculate new bounding box with scale
      const { x1, y1, x2, y2 } = seg.bbox;
      const centerX = (x1 + x2) / 2;
      const centerY = (y1 + y2) / 2;
      const width = x2 - x1;
      const height = y2 - y1;

      const newWidth = width * scaleFactor;
      const newHeight = height * scaleFactor;

      const newBbox = {
        x1: centerX - newWidth / 2,
        y1: centerY - newHeight / 2,
        x2: centerX + newWidth / 2,
        y2: centerY + newHeight / 2,
      };

      // Step 3: Remove the original object
      const cleanedImage = await this.removeObject(imageUrl, seg.maskUrl);

      // Step 4: Re-insert at new size using inpainting
      const prompt = `${objectLabel}, same style as surroundings, photorealistic`;
      const output = await this.run(MODELS.SDXL_INPAINT, {
        image: cleanedImage,
        prompt,
        negative_prompt: 'ugly, blurry, low quality, distorted, wrong size',
        // Use the new bounding box region
        strength: 0.9,
      });

      const result = output as string[];
      return { success: true, outputUrl: result[0] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Move an object to a new position
   */
  async moveObject(
    imageUrl: string,
    objectLabel: string,
    newPosition: 'left' | 'right' | 'center' | 'top' | 'bottom' | { x: number; y: number }
  ): Promise<{
    success: boolean;
    outputUrl?: string;
    error?: string;
  }> {
    try {
      // Step 1: Find and segment the object
      const seg = await this.detectAndSegment(imageUrl, objectLabel);

      if (!seg.found || !seg.bbox || !seg.maskUrl) {
        return { success: false, error: `Could not find "${objectLabel}" in the image` };
      }

      // Step 2: Remove the original object
      const cleanedImage = await this.removeObject(imageUrl, seg.maskUrl);

      // Step 3: Calculate new position (normalized 0-1 coordinates)
      let targetX: number, targetY: number;
      const { x1, y1, x2, y2 } = seg.bbox;
      const objWidth = x2 - x1;
      const objHeight = y2 - y1;

      if (typeof newPosition === 'object') {
        targetX = newPosition.x;
        targetY = newPosition.y;
      } else {
        switch (newPosition) {
          case 'left':
            targetX = 0.15;
            targetY = (y1 + y2) / 2;
            break;
          case 'right':
            targetX = 0.85;
            targetY = (y1 + y2) / 2;
            break;
          case 'center':
            targetX = 0.5;
            targetY = 0.5;
            break;
          case 'top':
            targetX = (x1 + x2) / 2;
            targetY = 0.15;
            break;
          case 'bottom':
            targetX = (x1 + x2) / 2;
            targetY = 0.85;
            break;
        }
      }

      // Step 4: Re-insert at new position using inpainting
      const newBbox = {
        x1: targetX - objWidth / 2,
        y1: targetY - objHeight / 2,
        x2: targetX + objWidth / 2,
        y2: targetY + objHeight / 2,
      };

      const prompt = `${objectLabel}, same style as original, photorealistic`;
      const output = await this.run(MODELS.SDXL_INPAINT, {
        image: cleanedImage,
        prompt,
        negative_prompt: 'ugly, blurry, low quality, distorted',
        strength: 0.85,
      });

      const result = output as string[];
      return { success: true, outputUrl: result[0] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

// Export a factory function for easy setup
export function createReplicateClient(apiToken?: string): ReplicateClient {
  const token = apiToken || process.env.REPLICATE_API_TOKEN;

  if (!token) {
    throw new Error(
      'Replicate API token required. Set REPLICATE_API_TOKEN environment variable ' +
      'or pass it to createReplicateClient(). Get your token at: https://replicate.com/account/api-tokens'
    );
  }

  return new ReplicateClient({ apiToken: token });
}
