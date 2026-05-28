/**
 * Gemini Image Editor - Native AI Image Editing
 *
 * Uses Google's Gemini models for direct image editing via @google/genai SDK.
 * Uses gemini-2.5-flash-image for native image output.
 */

import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';

// ============ Types ============

export interface GeminiEditResult {
  success: boolean;
  outputBase64?: string;
  outputDataUrl?: string;
  mimeType?: string;
  error?: string;
  textResponse?: string;
}

export interface GeminiEditorConfig {
  apiKey: string;
  model?: string;
  quality?: 'standard' | 'highest';
  maxRetries?: number;
}

// ============ Gemini Editor Class ============

export class GeminiEditor {
  private ai: GoogleGenAI;
  modelName: string;
  private quality: 'standard' | 'highest';
  private maxRetries: number;

  constructor(config: GeminiEditorConfig) {
    if (!config.apiKey) {
      throw new Error(
        'Gemini API key required. Set GOOGLE_AI_API_KEY environment variable ' +
        'or pass apiKey to constructor. Get one at: https://aistudio.google.com/apikey'
      );
    }

    // gemini-2.5-flash-image is the current stable model for image output.
    // Upgrade path: gemini-3.1-flash-image-preview supports 4K + 14 reference images (preview as of Feb 2026).
    this.modelName = config.model || 'gemini-2.5-flash-image';
    this.quality = config.quality || 'highest';
    this.maxRetries = config.maxRetries ?? 3;
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
  }

  // Cap images at 1536px max dimension before sending to Gemini (prevents OOM on free tier)
  private async resizeIfNeeded(buffer: Buffer): Promise<Buffer> {
    const meta = await sharp(buffer).metadata();
    const maxDim = 1536;
    if ((meta.width || 0) > maxDim || (meta.height || 0) > maxDim) {
      return sharp(buffer).resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    }
    return buffer;
  }

  private async prepareImage(source: string): Promise<{ data: string; mimeType: string }> {
    if (Buffer.isBuffer(source)) {
      return { data: (source as Buffer).toString('base64'), mimeType: 'image/jpeg' };
    }
    let buffer: Buffer;
    let mimeType: string;

    if (Buffer.isBuffer(source)) {
      buffer = source as Buffer;
      mimeType = 'image/jpeg';
    } else if (source.startsWith('data:')) {
      const match = source.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error('Invalid data URL format');
      mimeType = match[1];
      buffer = Buffer.from(match[2], 'base64');
    } else if (source.startsWith('http://') || source.startsWith('https://')) {
      const response = await fetch(source);
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      mimeType = contentType.split(';')[0].trim();
      buffer = Buffer.from(await response.arrayBuffer());
    } else if (source.startsWith('/') || source.startsWith('.')) {
      const fs = await import('fs/promises');
      buffer = await fs.readFile(source);
      const ext = source.split('.').pop()?.toLowerCase();
      mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : 'image/png';
    } else {
      return { data: source, mimeType: 'image/jpeg' };
    }

    buffer = await this.resizeIfNeeded(buffer);
    return { data: buffer.toString('base64'), mimeType: 'image/jpeg' };
  }

  private async generateWithRetry(contents: any[]): Promise<GeminiEditResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.modelName,
          contents,
          config: {
            responseModalities: ['IMAGE', 'TEXT'],
            temperature: 1,
          },
        });

        const parts = response.candidates?.[0]?.content?.parts || [];
        console.log(`  Response: ${parts.length} parts, types: ${parts.map((p: any) => p.inlineData ? 'image' : p.text ? 'text' : 'unknown').join(',')}`);

        for (const part of parts) {
          // @google/genai SDK may expose inlineData directly or nested
          const inlineData = (part as any).inlineData ?? (part as any).inline_data;
          if (inlineData?.data) {
            const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png';
            const base64 = inlineData.data;
            console.log(`  ✓ Got image (${mimeType}, ${Math.round(base64.length / 1024)}KB)`);
            return {
              success: true,
              outputBase64: base64,
              outputDataUrl: `data:${mimeType};base64,${base64}`,
              mimeType,
            };
          }
        }

        const textPart = parts.find((p: any) => p.text);
        if (textPart) {
          console.log(`  Text-only response: ${(textPart as any).text?.substring(0, 200)}`);
          return {
            success: false,
            error: 'Model returned text instead of image. Try a simpler instruction.',
            textResponse: (textPart as any).text,
          };
        }

        console.log(`  No image or text in response. Candidates: ${response.candidates?.length}`);
        return { success: false, error: 'No image in response' };

      } catch (error: any) {
        lastError = error;
        const isRetryable =
          error.message?.includes('500') ||
          error.message?.includes('503') ||
          error.message?.includes('Internal Server Error') ||
          error.message?.includes('Service Unavailable') ||
          error.message?.includes('overloaded');

        if (!isRetryable || attempt === this.maxRetries) throw error;

        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`  ⚠️ Attempt ${attempt}/${this.maxRetries} failed, retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Edit an image using natural language instructions
   */
  async editImage(imageSource: string, instruction: string): Promise<GeminiEditResult> {
    try {
      const img = await this.prepareImage(imageSource);
      let enhancedInstruction = instruction;
      if (this.quality === 'highest') {
        enhancedInstruction += ' [high quality, detailed, professional, preserve original style]';
      }

      console.log(`\n🎨 Gemini Edit: "${instruction}"`);
      console.log(`  Model: ${this.modelName}`);

      return await this.generateWithRetry([{
        role: 'user',
        parts: [
          {
            text: `Edit this image according to these instructions: ${enhancedInstruction}\n\nIMPORTANT: You MUST output the edited image. Apply the edit directly and return the modified image. Maintain the same resolution and quality as the original image.`,
          },
          { inlineData: { mimeType: img.mimeType, data: img.data } },
        ],
      }]);
    } catch (error: any) {
      console.error(`  ✗ Gemini edit error:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Edit only the masked region of an image
   * The mask should be a black/white image where white = area to edit
   */
  async editWithMask(
    sourceImage: string,
    mask: string,
    instruction: string
  ): Promise<GeminiEditResult> {
    try {
      const src = await this.prepareImage(sourceImage);
      const msk = await this.prepareImage(mask);
      let enhancedInstruction = instruction;
      if (this.quality === 'highest') {
        enhancedInstruction += ' [high quality, detailed, seamless blend, professional]';
      }

      console.log(`\n🎨 Gemini Masked Edit: "${instruction}"`);
      console.log(`  Model: ${this.modelName}`);

      return await this.generateWithRetry([{
        role: 'user',
        parts: [
          {
            text: `I have two images: the first is the original image, the second is a mask.
The mask shows which area to edit - WHITE areas should be edited, BLACK areas should remain UNCHANGED.

Your task: ${enhancedInstruction}

CRITICAL INSTRUCTIONS:
1. ONLY modify the WHITE regions shown in the mask
2. Keep ALL black-masked areas EXACTLY as they appear in the original
3. The output image must have the SAME dimensions as the original
4. Blend the edited region seamlessly with the unchanged areas
5. Maintain the same lighting, color temperature, and style as the original

Output the edited image.`,
          },
          { inlineData: { mimeType: src.mimeType, data: src.data } },
          { inlineData: { mimeType: 'image/png', data: msk.data } },
        ],
      }]);
    } catch (error: any) {
      console.error(`  ✗ Gemini masked edit error:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Edit with reference: Use one image as reference for editing another
   */
  async editWithReference(
    sourceImage: string,
    referenceImage: string,
    instruction: string
  ): Promise<GeminiEditResult> {
    try {
      const src = await this.prepareImage(sourceImage);
      const ref = await this.prepareImage(referenceImage);

      console.log(`\n🎨 Gemini Edit with Reference: "${instruction}"`);

      return await this.generateWithRetry([{
        role: 'user',
        parts: [
          {
            text: `Edit the first image using the second image as a reference.\nInstructions: ${instruction}\n\nOutput the edited version of the first image.`,
          },
          { inlineData: { mimeType: src.mimeType, data: src.data } },
          { inlineData: { mimeType: ref.mimeType, data: ref.data } },
        ],
      }]);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Edit with mask and optional reference elements
   */
  async editWithMaskAndReferences(
    sourceImage: string,
    mask: string,
    instruction: string,
    referenceElements: Array<{ label: string; dataUrl: string }>
  ): Promise<GeminiEditResult> {
    try {
      const src = await this.prepareImage(sourceImage);
      const msk = await this.prepareImage(mask);
      let enhancedInstruction = instruction;
      if (this.quality === 'highest') {
        enhancedInstruction += ' [high quality, detailed, seamless blend, professional]';
      }

      console.log(`\n🎨 Gemini Masked Edit with ${referenceElements.length} Reference(s): "${instruction}"`);

      const refDescriptions = referenceElements.map((el, i) =>
        `Reference ${i + 1} "${el.label}": This is an image you can use when the instruction mentions "${el.label}"`
      ).join('\n');

      const parts: any[] = [
        {
          text: `I have the following images:
1. MAIN IMAGE: The image to edit
2. MASK: Shows which area to edit - WHITE areas should be edited, BLACK areas should remain UNCHANGED
${referenceElements.length > 0 ? `\nREFERENCE ELEMENTS (use these when mentioned in the instruction):\n${refDescriptions}\n` : ''}
Your task: ${enhancedInstruction}

CRITICAL INSTRUCTIONS:
1. ONLY modify the WHITE regions shown in the mask
2. Keep ALL black-masked areas EXACTLY as they appear in the original
3. The output image must have the SAME dimensions as the original
4. Blend the edited region seamlessly with the unchanged areas
5. Maintain the same lighting, color temperature, and style as the original
${referenceElements.length > 0 ? '6. When the instruction mentions any reference element by name, incorporate that element into the edit' : ''}

Output the edited image.`,
        },
        { inlineData: { mimeType: src.mimeType, data: src.data } },
        { inlineData: { mimeType: 'image/png', data: msk.data } },
      ];

      for (const ref of referenceElements) {
        const refImg = await this.prepareImage(ref.dataUrl);
        parts.push({ inlineData: { mimeType: refImg.mimeType, data: refImg.data } });
      }

      return await this.generateWithRetry([{ role: 'user', parts }]);
    } catch (error: any) {
      console.error(`  ✗ Gemini masked edit with references error:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Edit image with reference elements (no mask)
   */
  async editWithReferences(
    sourceImage: string,
    instruction: string,
    referenceElements: Array<{ label: string; dataUrl: string }>
  ): Promise<GeminiEditResult> {
    try {
      const src = await this.prepareImage(sourceImage);
      let enhancedInstruction = instruction;
      if (this.quality === 'highest') {
        enhancedInstruction += ' [high quality, detailed, professional, preserve original style]';
      }

      console.log(`\n🎨 Gemini Edit with ${referenceElements.length} Reference(s): "${instruction}"`);

      const refDescriptions = referenceElements.map((el, i) =>
        `Reference ${i + 1} "${el.label}": Use this when the instruction mentions "${el.label}"`
      ).join('\n');

      const parts: any[] = [
        {
          text: `Edit this image according to these instructions: ${enhancedInstruction}
${referenceElements.length > 0 ? `\nREFERENCE ELEMENTS (use these when mentioned in the instruction):\n${refDescriptions}\n\nThe first image below is the MAIN IMAGE to edit. The following images are REFERENCE ELEMENTS.` : ''}
IMPORTANT: You MUST output the edited image. Apply the edit directly and return the modified image.
Maintain the same resolution and quality as the original image.`,
        },
        { inlineData: { mimeType: src.mimeType, data: src.data } },
      ];

      for (const ref of referenceElements) {
        const refImg = await this.prepareImage(ref.dataUrl);
        parts.push({ inlineData: { mimeType: refImg.mimeType, data: refImg.data } });
      }

      return await this.generateWithRetry([{ role: 'user', parts }]);
    } catch (error: any) {
      console.error(`  ✗ Gemini edit with references error:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // ============ Segmentation Methods ============

  async segmentAtPoint(
    sourceImage: string,
    point: { x: number; y: number }
  ): Promise<{ success: boolean; maskUrl?: string; error?: string }> {
    try {
      const img = await this.prepareImage(sourceImage);
      console.log(`\n🎯 Segmenting at point (${point.x}, ${point.y})`);

      const result = await this.generateWithRetry([{
        role: 'user',
        parts: [
          {
            text: `I'm clicking on a specific point in this image at coordinates (${point.x}, ${point.y}).

Create a BLACK AND WHITE MASK image where:
- The object/element that exists at or near the clicked point should be WHITE
- Everything else should be BLACK

The mask should precisely outline the boundaries of the clicked object.
Output ONLY the mask image (black and white, no color).`,
          },
          { inlineData: { mimeType: img.mimeType, data: img.data } },
        ],
      }]);

      if (result.success && result.outputDataUrl) {
        return { success: true, maskUrl: result.outputDataUrl };
      }
      return { success: false, error: result.error || 'Could not generate segmentation mask' };
    } catch (error: any) {
      console.error(`  ✗ Segmentation error:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async segmentByLabel(
    sourceImage: string,
    label: string
  ): Promise<{ success: boolean; maskUrl?: string; error?: string }> {
    try {
      const img = await this.prepareImage(sourceImage);
      console.log(`\n🏷️ Segmenting by label: "${label}"`);

      const result = await this.generateWithRetry([{
        role: 'user',
        parts: [
          {
            text: `Find the "${label}" in this image and create a BLACK AND WHITE MASK where:
- The "${label}" should be WHITE
- Everything else should be BLACK

The mask should precisely outline the boundaries of the "${label}".
Output ONLY the mask image (black and white, no color).`,
          },
          { inlineData: { mimeType: img.mimeType, data: img.data } },
        ],
      }]);

      if (result.success && result.outputDataUrl) {
        return { success: true, maskUrl: result.outputDataUrl };
      }
      return { success: false, error: result.error || `Could not generate mask for "${label}"` };
    } catch (error: any) {
      console.error(`  ✗ Segmentation error:`, error.message);
      return { success: false, error: error.message };
    }
  }

}

// ============ Factory Function ============

export function createGeminiEditor(apiKey?: string): GeminiEditor {
  const key = apiKey || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error(
      'Gemini API key required. Set GOOGLE_AI_API_KEY environment variable ' +
      'or pass apiKey to createGeminiEditor(). Get one at: https://aistudio.google.com/apikey'
    );
  }

  return new GeminiEditor({ apiKey: key });
}
