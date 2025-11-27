/**
 * Gemini Image Editor - Native AI Image Editing (Nano Banana Pro)
 *
 * Uses Google's Gemini models for direct image editing.
 * This is an alternative to the Replicate pipeline for targeted edits
 * like color changes, style modifications, and localized edits.
 *
 * Uses Gemini 2.0 Flash Experimental with Nano Banana Pro image generation.
 * Features: 4K resolution, accurate text rendering, high-fidelity images.
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

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
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private modelName: string;
  private quality: 'standard' | 'highest';
  private maxRetries: number;

  constructor(config: GeminiEditorConfig) {
    if (!config.apiKey) {
      throw new Error(
        'Gemini API key required. Set GOOGLE_AI_API_KEY environment variable ' +
        'or pass apiKey to constructor. Get one at: https://aistudio.google.com/apikey'
      );
    }

    // Use gemini-3-pro-image-preview for Nano Banana Pro native image generation
    // Available models: gemini-3-pro-image-preview (Pro), gemini-2.5-flash-image (stable)
    this.modelName = config.model || 'gemini-3-pro-image-preview';
    this.quality = config.quality || 'highest';
    this.maxRetries = config.maxRetries ?? 3;
    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        // @ts-ignore - responseModalities is available in newer API versions
        responseModalities: ['image', 'text'],
        temperature: 1, // Higher temperature for creative image generation
        maxOutputTokens: 8192,
      },
    });
  }

  /**
   * Edit an image using natural language instructions
   * This is Gemini's native image editing (Nano Banana Pro) - perfect for color changes, style mods, etc.
   */
  async editImage(imageSource: string, instruction: string): Promise<GeminiEditResult> {
    try {
      const imageData = await this.prepareImageData(imageSource);

      console.log(`\n🎨 Nano Banana Edit: "${instruction}"`);
      console.log(`  Model: ${this.modelName}`);
      console.log(`  Quality: ${this.quality}`);

      // Build enhanced prompt with quality hints
      let enhancedInstruction = instruction;
      if (this.quality === 'highest') {
        enhancedInstruction += ' [high quality, detailed, professional, preserve original style]';
      }

      const result = await this.withRetry(
        () => this.model.generateContent({
          contents: [{
            role: 'user',
            parts: [
              {
                text: `Edit this image according to these instructions: ${enhancedInstruction}

IMPORTANT: You MUST output the edited image. Apply the edit directly and return the modified image.
Maintain the same resolution and quality as the original image.`,
              },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: imageData,
                },
              },
            ],
          }],
        }),
        'Gemini Edit'
      );

      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts || [];

      console.log(`  Response parts: ${parts.length}`);

      // Look for image in response
      for (const part of parts) {
        // @ts-ignore - inlineData may contain image response
        if (part.inlineData?.data) {
          // @ts-ignore
          const mimeType = part.inlineData.mimeType || 'image/png';
          // @ts-ignore
          const base64 = part.inlineData.data;

          console.log(`  ✓ Got image response (${mimeType})`);

          return {
            success: true,
            outputBase64: base64,
            outputDataUrl: `data:${mimeType};base64,${base64}`,
            mimeType,
          };
        }
      }

      // If no image, check for text response (might be an error or explanation)
      const textPart = parts.find((p: any) => p.text);
      if (textPart) {
        // @ts-ignore
        console.log(`  Text response: ${textPart.text?.substring(0, 200)}`);
        return {
          success: false,
          error: 'Model returned text instead of image. May need different model or prompt.',
          // @ts-ignore
          textResponse: textPart.text,
        };
      }

      return {
        success: false,
        error: 'No image in response',
      };
    } catch (error: any) {
      console.error(`  ✗ Gemini edit error:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate an image from text description using Nano Banana Pro
   */
  async generateImage(prompt: string): Promise<GeminiEditResult> {
    try {
      // Build enhanced prompt with quality hints
      let enhancedPrompt = prompt;
      if (this.quality === 'highest') {
        enhancedPrompt += ' [high quality, detailed, professional, 4K resolution]';
      }

      console.log(`\n🎨 Nano Banana Generate: "${prompt}"`);
      console.log(`  Quality: ${this.quality}`);

      const result = await this.model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            {
              text: `Generate an image: ${enhancedPrompt}

Output the generated image.`,
            },
          ],
        }],
      });

      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        // @ts-ignore
        if (part.inlineData?.data) {
          // @ts-ignore
          const mimeType = part.inlineData.mimeType || 'image/png';
          // @ts-ignore
          const base64 = part.inlineData.data;

          return {
            success: true,
            outputBase64: base64,
            outputDataUrl: `data:${mimeType};base64,${base64}`,
            mimeType,
          };
        }
      }

      return {
        success: false,
        error: 'No image generated',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Edit only the masked region of an image using Nano Banana Pro
   * The mask should be a black/white image where white = area to edit
   */
  async editWithMask(
    sourceImage: string,
    mask: string,
    instruction: string
  ): Promise<GeminiEditResult> {
    try {
      const sourceData = await this.prepareImageData(sourceImage);
      const maskData = await this.prepareImageData(mask);

      console.log(`\n🎨 Nano Banana Masked Edit: "${instruction}"`);
      console.log(`  Model: ${this.modelName}`);
      console.log(`  Quality: ${this.quality}`);

      // Build enhanced instruction with quality hints
      let enhancedInstruction = instruction;
      if (this.quality === 'highest') {
        enhancedInstruction += ' [high quality, detailed, seamless blend, professional]';
      }

      const result = await this.withRetry(
        () => this.model.generateContent({
          contents: [{
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
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: sourceData,
                },
              },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: maskData,
                },
              },
            ],
          }],
        }),
        'Gemini Masked Edit'
      );

      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts || [];

      console.log(`  Response parts: ${parts.length}`);

      for (const part of parts) {
        // @ts-ignore
        if (part.inlineData?.data) {
          // @ts-ignore
          const mimeType = part.inlineData.mimeType || 'image/png';
          // @ts-ignore
          const base64 = part.inlineData.data;

          console.log(`  ✓ Got masked edit response (${mimeType})`);

          return {
            success: true,
            outputBase64: base64,
            outputDataUrl: `data:${mimeType};base64,${base64}`,
            mimeType,
          };
        }
      }

      // If no image, check for text response
      const textPart = parts.find((p: any) => p.text);
      if (textPart) {
        // @ts-ignore
        console.log(`  Text response: ${textPart.text?.substring(0, 200)}`);
        return {
          success: false,
          error: 'Model returned text instead of image.',
          // @ts-ignore
          textResponse: textPart.text,
        };
      }

      return {
        success: false,
        error: 'No image in response',
      };
    } catch (error: any) {
      console.error(`  ✗ Gemini masked edit error:`, error.message);
      return {
        success: false,
        error: error.message,
      };
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
      const sourceData = await this.prepareImageData(sourceImage);
      const refData = await this.prepareImageData(referenceImage);

      console.log(`\n🎨 Gemini Edit with Reference: "${instruction}"`);

      const result = await this.model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            {
              text: `Edit the first image using the second image as a reference.
Instructions: ${instruction}

Output the edited version of the first image.`,
            },
            {
              inlineData: {
                mimeType: 'image/png',
                data: sourceData,
              },
            },
            {
              inlineData: {
                mimeType: 'image/png',
                data: refData,
              },
            },
          ],
        }],
      });

      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        // @ts-ignore
        if (part.inlineData?.data) {
          // @ts-ignore
          const mimeType = part.inlineData.mimeType || 'image/png';
          // @ts-ignore
          const base64 = part.inlineData.data;

          return {
            success: true,
            outputBase64: base64,
            outputDataUrl: `data:${mimeType};base64,${base64}`,
            mimeType,
          };
        }
      }

      return {
        success: false,
        error: 'No image in response',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Edit with mask and optional reference elements
   * Combines masked editing with reference images that the user can mention in prompts
   * e.g., "Add the logo to the sign" where "logo" is a reference element
   */
  async editWithMaskAndReferences(
    sourceImage: string,
    mask: string,
    instruction: string,
    referenceElements: Array<{ label: string; dataUrl: string }>
  ): Promise<GeminiEditResult> {
    try {
      const sourceData = await this.prepareImageData(sourceImage);
      const maskData = await this.prepareImageData(mask);

      console.log(`\n🎨 Nano Banana Masked Edit with ${referenceElements.length} Reference(s): "${instruction}"`);
      console.log(`  Model: ${this.modelName}`);
      console.log(`  References: ${referenceElements.map(r => r.label).join(', ')}`);

      // Build enhanced instruction with quality hints
      let enhancedInstruction = instruction;
      if (this.quality === 'highest') {
        enhancedInstruction += ' [high quality, detailed, seamless blend, professional]';
      }

      // Build reference element descriptions for the prompt
      const refDescriptions = referenceElements.map((el, i) =>
        `Reference ${i + 1} "${el.label}": This is an image you can use when the instruction mentions "${el.label}"`
      ).join('\n');

      // Build content parts array
      const parts: any[] = [
        {
          text: `I have the following images:
1. MAIN IMAGE: The image to edit
2. MASK: Shows which area to edit - WHITE areas should be edited, BLACK areas should remain UNCHANGED

${referenceElements.length > 0 ? `REFERENCE ELEMENTS (use these when mentioned in the instruction):
${refDescriptions}

` : ''}Your task: ${enhancedInstruction}

CRITICAL INSTRUCTIONS:
1. ONLY modify the WHITE regions shown in the mask
2. Keep ALL black-masked areas EXACTLY as they appear in the original
3. The output image must have the SAME dimensions as the original
4. Blend the edited region seamlessly with the unchanged areas
5. Maintain the same lighting, color temperature, and style as the original
${referenceElements.length > 0 ? '6. When the instruction mentions any reference element by name, incorporate that element into the edit' : ''}

Output the edited image.`,
        },
        {
          inlineData: {
            mimeType: 'image/png',
            data: sourceData,
          },
        },
        {
          inlineData: {
            mimeType: 'image/png',
            data: maskData,
          },
        },
      ];

      // Add reference element images
      for (const ref of referenceElements) {
        const refData = await this.prepareImageData(ref.dataUrl);
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: refData,
          },
        });
      }

      const result = await this.withRetry(
        () => this.model.generateContent({
          contents: [{
            role: 'user',
            parts,
          }],
        }),
        'Gemini Masked Edit with References'
      );

      const response = result.response;
      const responseParts = response.candidates?.[0]?.content?.parts || [];

      console.log(`  Response parts: ${responseParts.length}`);

      for (const part of responseParts) {
        // @ts-ignore
        if (part.inlineData?.data) {
          // @ts-ignore
          const mimeType = part.inlineData.mimeType || 'image/png';
          // @ts-ignore
          const base64 = part.inlineData.data;

          console.log(`  ✓ Got masked edit with references response (${mimeType})`);

          return {
            success: true,
            outputBase64: base64,
            outputDataUrl: `data:${mimeType};base64,${base64}`,
            mimeType,
          };
        }
      }

      // If no image, check for text response
      const textPart = responseParts.find((p: any) => p.text);
      if (textPart) {
        // @ts-ignore
        console.log(`  Text response: ${textPart.text?.substring(0, 200)}`);
        return {
          success: false,
          error: 'Model returned text instead of image.',
          // @ts-ignore
          textResponse: textPart.text,
        };
      }

      return {
        success: false,
        error: 'No image in response',
      };
    } catch (error: any) {
      console.error(`  ✗ Gemini masked edit with references error:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Edit image with reference elements (no mask)
   * The AI uses reference elements mentioned in the prompt to guide the edit
   */
  async editWithReferences(
    sourceImage: string,
    instruction: string,
    referenceElements: Array<{ label: string; dataUrl: string }>
  ): Promise<GeminiEditResult> {
    try {
      const sourceData = await this.prepareImageData(sourceImage);

      console.log(`\n🎨 Nano Banana Edit with ${referenceElements.length} Reference(s): "${instruction}"`);
      console.log(`  Model: ${this.modelName}`);
      console.log(`  References: ${referenceElements.map(r => r.label).join(', ')}`);

      // Build enhanced instruction with quality hints
      let enhancedInstruction = instruction;
      if (this.quality === 'highest') {
        enhancedInstruction += ' [high quality, detailed, professional, preserve original style]';
      }

      // Build reference element descriptions for the prompt
      const refDescriptions = referenceElements.map((el, i) =>
        `Reference ${i + 1} "${el.label}": Use this when the instruction mentions "${el.label}"`
      ).join('\n');

      // Build content parts array
      const parts: any[] = [
        {
          text: `Edit this image according to these instructions: ${enhancedInstruction}

${referenceElements.length > 0 ? `REFERENCE ELEMENTS (use these when mentioned in the instruction):
${refDescriptions}

The first image below is the MAIN IMAGE to edit. The following images are REFERENCE ELEMENTS that you should incorporate when they are mentioned in the instruction.
` : ''}
IMPORTANT: You MUST output the edited image. Apply the edit directly and return the modified image.
Maintain the same resolution and quality as the original image.`,
        },
        {
          inlineData: {
            mimeType: 'image/png',
            data: sourceData,
          },
        },
      ];

      // Add reference element images
      for (const ref of referenceElements) {
        const refData = await this.prepareImageData(ref.dataUrl);
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: refData,
          },
        });
      }

      const result = await this.withRetry(
        () => this.model.generateContent({
          contents: [{
            role: 'user',
            parts,
          }],
        }),
        'Gemini Edit with References'
      );

      const response = result.response;
      const responseParts = response.candidates?.[0]?.content?.parts || [];

      console.log(`  Response parts: ${responseParts.length}`);

      for (const part of responseParts) {
        // @ts-ignore
        if (part.inlineData?.data) {
          // @ts-ignore
          const mimeType = part.inlineData.mimeType || 'image/png';
          // @ts-ignore
          const base64 = part.inlineData.data;

          console.log(`  ✓ Got edit with references response (${mimeType})`);

          return {
            success: true,
            outputBase64: base64,
            outputDataUrl: `data:${mimeType};base64,${base64}`,
            mimeType,
          };
        }
      }

      // If no image, check for text response
      const textPart = responseParts.find((p: any) => p.text);
      if (textPart) {
        // @ts-ignore
        console.log(`  Text response: ${textPart.text?.substring(0, 200)}`);
        return {
          success: false,
          error: 'Model returned text instead of image.',
          // @ts-ignore
          textResponse: textPart.text,
        };
      }

      return {
        success: false,
        error: 'No image in response',
      };
    } catch (error: any) {
      console.error(`  ✗ Gemini edit with references error:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ============ Segmentation Methods ============

  /**
   * Segment an object at a specific point (click select)
   * Uses Gemini to identify and create a mask for the object at the clicked location
   */
  async segmentAtPoint(
    sourceImage: string,
    point: { x: number; y: number }
  ): Promise<{ success: boolean; maskUrl?: string; error?: string }> {
    try {
      const sourceData = await this.prepareImageData(sourceImage);

      console.log(`\n🎯 Segmenting at point (${point.x}, ${point.y})`);

      const result = await this.model.generateContent({
        contents: [{
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
            {
              inlineData: {
                mimeType: 'image/png',
                data: sourceData,
              },
            },
          ],
        }],
      });

      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        // @ts-ignore
        if (part.inlineData?.data) {
          // @ts-ignore
          const mimeType = part.inlineData.mimeType || 'image/png';
          // @ts-ignore
          const base64 = part.inlineData.data;

          console.log(`  ✓ Got segmentation mask`);

          return {
            success: true,
            maskUrl: `data:${mimeType};base64,${base64}`,
          };
        }
      }

      return {
        success: false,
        error: 'Could not generate segmentation mask',
      };
    } catch (error: any) {
      console.error(`  ✗ Segmentation error:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Segment an object by its label (from scene analysis)
   * Uses Gemini to identify and create a mask for the labeled object
   */
  async segmentByLabel(
    sourceImage: string,
    label: string
  ): Promise<{ success: boolean; maskUrl?: string; error?: string }> {
    try {
      const sourceData = await this.prepareImageData(sourceImage);

      console.log(`\n🏷️ Segmenting by label: "${label}"`);

      const result = await this.model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            {
              text: `Find the "${label}" in this image and create a BLACK AND WHITE MASK where:
- The "${label}" should be WHITE
- Everything else should be BLACK

The mask should precisely outline the boundaries of the "${label}".
Output ONLY the mask image (black and white, no color).`,
            },
            {
              inlineData: {
                mimeType: 'image/png',
                data: sourceData,
              },
            },
          ],
        }],
      });

      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        // @ts-ignore
        if (part.inlineData?.data) {
          // @ts-ignore
          const mimeType = part.inlineData.mimeType || 'image/png';
          // @ts-ignore
          const base64 = part.inlineData.data;

          console.log(`  ✓ Got segmentation mask for "${label}"`);

          return {
            success: true,
            maskUrl: `data:${mimeType};base64,${base64}`,
          };
        }
      }

      return {
        success: false,
        error: `Could not generate mask for "${label}"`,
      };
    } catch (error: any) {
      console.error(`  ✗ Segmentation error:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ============ Helper Methods ============

  /**
   * Retry wrapper with exponential backoff for handling transient API errors
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        const isRetryable =
          error.message?.includes('500') ||
          error.message?.includes('503') ||
          error.message?.includes('Internal Server Error') ||
          error.message?.includes('Service Unavailable') ||
          error.message?.includes('overloaded');

        if (!isRetryable || attempt === this.maxRetries) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s...
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`  ⚠️ ${operationName} failed (attempt ${attempt}/${this.maxRetries}), retrying in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  private async prepareImageData(source: string): Promise<string> {
    // If it's a Buffer, convert to base64
    if (Buffer.isBuffer(source)) {
      return source.toString('base64');
    }

    // If it's a data URL, extract the base64 part
    if (source.startsWith('data:')) {
      const base64Match = source.match(/^data:[^;]+;base64,(.+)$/);
      if (base64Match) {
        return base64Match[1];
      }
      throw new Error('Invalid data URL format');
    }

    // If it's a URL, fetch and convert to base64
    if (source.startsWith('http://') || source.startsWith('https://')) {
      const response = await fetch(source);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer).toString('base64');
    }

    // If it's a file path, read it
    if (source.startsWith('/') || source.startsWith('.')) {
      const fs = await import('fs/promises');
      const buffer = await fs.readFile(source);
      return buffer.toString('base64');
    }

    // Assume it's already base64
    return source;
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
