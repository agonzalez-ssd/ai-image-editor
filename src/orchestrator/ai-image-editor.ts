/**
 * AI Image Editor - Cloud Orchestrator
 *
 * Zero-installation image editing powered by:
 * - Google Gemini (vision + reasoning) - Director layer
 * - Replicate (specialized models) - Navigator + Workers layers
 *
 * Architecture:
 *   Director (Gemini) → understands intent, plans operations
 *   Navigator (DINO + SAM) → finds and segments objects
 *   Workers (LaMa, IC-Light, etc.) → executes edits
 *
 * Usage:
 *   const editor = new AIImageEditor();
 *   const result = await editor.edit(imageUrl, "remove the person on the left");
 */

import { fileURLToPath } from 'url';
import { ReplicateClient, createReplicateClient } from './replicate-client.js';
import {
  GeminiDirector,
  createGeminiDirector,
  type EditPlan,
  type EditOperation,
  type SceneAnalysis,
} from './gemini-director.js';
import { GeminiEditor, createGeminiEditor } from './gemini-editor.js';

// ============ Types ============

export interface EditResult {
  success: boolean;
  outputUrl: string;
  operations: EditOperation[];
  processingTimeMs: number;
  sceneAnalysis?: SceneAnalysis;
  editPlan?: EditPlan;
}

export interface AIImageEditorConfig {
  replicateToken?: string;
  geminiApiKey?: string;
  verbose?: boolean;
  useGeminiNative?: boolean; // Use Gemini native image editing (default: true)
}

// ============ Main Class ============

export class AIImageEditor {
  private replicate: ReplicateClient;
  private director: GeminiDirector;
  private geminiEditor: GeminiEditor;
  private verbose: boolean;
  private useGeminiNative: boolean;

  constructor(config: AIImageEditorConfig = {}) {
    this.replicate = createReplicateClient(config.replicateToken);
    this.director = createGeminiDirector(config.geminiApiKey);
    this.geminiEditor = createGeminiEditor(config.geminiApiKey);
    this.verbose = config.verbose ?? true;
    this.useGeminiNative = config.useGeminiNative ?? true; // Default to Gemini native
  }

  /**
   * Main entry point - edit an image with natural language
   * Uses Gemini native image editing by default for better quality
   */
  async edit(imageUrl: string, instruction: string): Promise<EditResult> {
    const startTime = Date.now();

    this.log(`\n🎨 AI Image Editor - ${this.useGeminiNative ? 'Gemini Native' : 'Replicate Pipeline'}`);
    this.log(`📝 Instruction: "${instruction}"`);
    this.log(`🖼️  Image: ${imageUrl}\n`);

    // Use Gemini Native editing (default)
    if (this.useGeminiNative) {
      return this.editWithGeminiNative(imageUrl, instruction, startTime);
    }

    // Fallback to Replicate pipeline
    return this.editWithReplicatePipeline(imageUrl, instruction, startTime);
  }

  /**
   * Edit using Gemini's native image editing capabilities
   * Best for: color changes, style modifications, localized edits
   */
  private async editWithGeminiNative(imageUrl: string, instruction: string, startTime: number): Promise<EditResult> {
    this.log('━━━ GEMINI NATIVE IMAGE EDITING ━━━');
    this.log('  Using Gemini 2.0 Flash with image generation...\n');

    const result = await this.geminiEditor.editImage(imageUrl, instruction);

    if (!result.success) {
      this.log(`  ✗ Gemini edit failed: ${result.error}`);
      if (result.textResponse) {
        this.log(`  Response: ${result.textResponse.slice(0, 200)}...`);
      }

      // Fallback to Replicate pipeline if Gemini fails
      this.log('\n  → Falling back to Replicate pipeline...\n');
      return this.editWithReplicatePipeline(imageUrl, instruction, startTime);
    }

    this.log(`  ✓ Edit complete!`);

    const processingTimeMs = Date.now() - startTime;

    return {
      success: true,
      outputUrl: result.outputDataUrl!,
      operations: [{ type: 'style', parameters: { instruction } }],
      processingTimeMs,
    };
  }

  /**
   * Edit using the Replicate-based Director-Navigator-Worker pipeline
   * Best for: object removal (LaMa), background removal, upscaling
   */
  private async editWithReplicatePipeline(imageUrl: string, instruction: string, startTime: number): Promise<EditResult> {
    // === LAYER 1: DIRECTOR ===
    this.log('━━━ LAYER 1: DIRECTOR (Gemini Vision) ━━━');

    // Step 1: Analyze the scene
    this.log('  [1/2] Analyzing scene...');
    const sceneAnalysis = await this.director.analyzeScene(imageUrl);
    this.log(`  ✓ Found ${sceneAnalysis.elements.length} element(s)`);
    for (const el of sceneAnalysis.elements) {
      this.log(`      • ${el.label} (${el.position})`);
    }

    // Step 2: Plan the edit
    this.log('  [2/2] Planning edit...');
    const editPlan = await this.director.planEdit(instruction, sceneAnalysis);
    this.log(`  ✓ Plan: ${editPlan.operations.length} operation(s), ${(editPlan.confidence * 100).toFixed(0)}% confidence`);
    this.log(`    Reasoning: ${editPlan.reasoning}\n`);

    if (editPlan.operations.length === 0) {
      this.log('⚠️  Could not determine operations. Try being more specific.\n');
      return {
        success: false,
        outputUrl: imageUrl,
        operations: [],
        processingTimeMs: Date.now() - startTime,
        sceneAnalysis,
        editPlan,
      };
    }

    // === LAYERS 2 & 3: NAVIGATOR + WORKERS ===
    this.log('━━━ LAYERS 2-3: NAVIGATOR + WORKERS (Replicate) ━━━');

    let currentImageUrl = imageUrl;

    for (let i = 0; i < editPlan.operations.length; i++) {
      const op = editPlan.operations[i];
      this.log(`  [${i + 1}/${editPlan.operations.length}] ${op.type.toUpperCase()}: ${op.target || 'image'}`);

      try {
        currentImageUrl = await this.executeOperation(currentImageUrl, op, sceneAnalysis);
        this.log(`      ✓ Complete → ${currentImageUrl.slice(0, 60)}...`);
      } catch (error) {
        this.log(`      ✗ Failed: ${error}`);
        throw error;
      }
    }

    this.log('');
    const processingTimeMs = Date.now() - startTime;

    return {
      success: true,
      outputUrl: currentImageUrl,
      operations: editPlan.operations,
      processingTimeMs,
      sceneAnalysis,
      editPlan,
    };
  }

  /**
   * Direct Gemini edit - bypasses all planning, just sends to Gemini
   */
  async editDirect(imageUrl: string, instruction: string): Promise<EditResult> {
    const startTime = Date.now();

    this.log(`\n🎨 Direct Gemini Edit`);
    this.log(`📝 Instruction: "${instruction}"\n`);

    const result = await this.geminiEditor.editImage(imageUrl, instruction);

    if (!result.success) {
      return {
        success: false,
        outputUrl: imageUrl,
        operations: [],
        processingTimeMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      outputUrl: result.outputDataUrl!,
      operations: [{ type: 'style', parameters: { instruction } }],
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Quick operations - skip Director, go straight to Workers
   */

  async removeBackground(imageUrl: string): Promise<string> {
    this.log('🔄 Removing background (direct)...');
    const result = await this.replicate.removeBackground(imageUrl);
    this.log(`✓ Done: ${result}`);
    return result;
  }

  async upscale(imageUrl: string, scale: 2 | 4 = 4): Promise<string> {
    this.log(`🔄 Upscaling ${scale}x (direct)...`);
    const result = await this.replicate.upscale(imageUrl, scale);
    this.log(`✓ Done: ${result}`);
    return result;
  }

  async removeObject(imageUrl: string, objectDescription: string): Promise<string> {
    this.log(`🔄 Removing "${objectDescription}" (direct)...`);

    // Navigator: Find and segment the object
    this.log('  → Detecting object...');
    const segmentation = await this.replicate.detectAndSegment(imageUrl, objectDescription);

    if (!segmentation.found) {
      throw new Error(`Could not find "${objectDescription}" in the image`);
    }

    this.log(`  → Found with ${((segmentation.confidence || 0) * 100).toFixed(0)}% confidence`);
    this.log('  → Generating mask...');

    // Worker: Remove using LaMa inpainting
    this.log('  → Inpainting...');
    const result = await this.replicate.removeObject(imageUrl, segmentation.maskUrl!);
    this.log(`✓ Done: ${result}`);
    return result;
  }

  async relight(imageUrl: string, lightingStyle: string): Promise<string> {
    this.log(`🔄 Relighting with "${lightingStyle}"...`);
    const result = await this.replicate.relight(imageUrl, lightingStyle);
    this.log(`✓ Done: ${result}`);
    return result;
  }

  async generate(prompt: string, options?: { width?: number; height?: number }): Promise<string> {
    this.log(`🔄 Generating: "${prompt}"...`);
    const results = await this.replicate.generateImage(prompt, {
      width: options?.width || 1024,
      height: options?.height || 1024,
      numOutputs: 1,
    });
    this.log(`✓ Done: ${results[0]}`);
    return results[0];
  }

  // ============ Detection Operations ============

  async detectLogos(imageUrl: string) {
    this.log('🔍 Detecting logos...');
    const result = await this.replicate.detectLogos(imageUrl);
    this.log(`✓ Found ${result.logos.length} logo(s)`);
    return result;
  }

  async detectText(imageUrl: string) {
    this.log('🔍 Detecting text regions...');
    const result = await this.replicate.detectText(imageUrl);
    this.log(`✓ Found ${result.textRegions.length} text region(s)`);
    return result;
  }

  async detectRoomObjects(imageUrl: string) {
    this.log('🔍 Detecting room objects...');
    const result = await this.replicate.detectRoomObjects(imageUrl);
    this.log(`✓ Found ${result.objects.length} object(s)`);
    return result;
  }

  async describeImage(imageUrl: string, question?: string): Promise<string> {
    this.log('📝 Describing image...');
    const description = await this.replicate.describeImage(imageUrl, question);
    this.log(`✓ Description: ${description}`);
    return description;
  }

  // ============ Transform Operations ============

  async resizeObject(imageUrl: string, objectLabel: string, scale: number) {
    this.log(`🔄 Resizing "${objectLabel}" by ${scale}x...`);
    const result = await this.replicate.resizeObject(imageUrl, objectLabel, scale);
    if (!result.success) {
      throw new Error(result.error || 'Resize failed');
    }
    this.log(`✓ Done: ${result.outputUrl}`);
    return result.outputUrl!;
  }

  async moveObject(imageUrl: string, objectLabel: string, position: 'left' | 'right' | 'center' | 'top' | 'bottom') {
    this.log(`🔄 Moving "${objectLabel}" to ${position}...`);
    const result = await this.replicate.moveObject(imageUrl, objectLabel, position);
    if (!result.success) {
      throw new Error(result.error || 'Move failed');
    }
    this.log(`✓ Done: ${result.outputUrl}`);
    return result.outputUrl!;
  }

  async addObject(imageUrl: string, objectDescription: string, position: string = 'center') {
    this.log(`🔄 Adding "${objectDescription}" at ${position}...`);

    // Calculate region based on position
    let region = { x1: 0.3, y1: 0.3, x2: 0.7, y2: 0.7 };
    switch (position) {
      case 'left': region = { x1: 0.05, y1: 0.3, x2: 0.35, y2: 0.7 }; break;
      case 'right': region = { x1: 0.65, y1: 0.3, x2: 0.95, y2: 0.7 }; break;
      case 'top': region = { x1: 0.3, y1: 0.05, x2: 0.7, y2: 0.35 }; break;
      case 'bottom': region = { x1: 0.3, y1: 0.65, x2: 0.7, y2: 0.95 }; break;
    }

    const result = await this.replicate.insertObject(imageUrl, objectDescription, region);
    this.log(`✓ Done: ${result}`);
    return result;
  }

  async generateObject(objectDescription: string, options?: { width?: number; height?: number }): Promise<string> {
    this.log(`🔄 Generating object: "${objectDescription}"...`);
    const result = await this.replicate.generateObject(objectDescription, options);
    this.log(`✓ Done: ${result}`);
    return result;
  }

  // ============ Internal Methods ============

  private async executeOperation(
    imageUrl: string,
    operation: EditOperation,
    scene: SceneAnalysis
  ): Promise<string> {
    // Debug logging for operation details
    console.log('\n--- EXECUTE OPERATION DEBUG ---');
    console.log('Operation type:', operation.type);
    console.log('Operation target:', operation.target, typeof operation.target);
    console.log('Operation parameters:', JSON.stringify(operation.parameters));
    console.log('Operation newPosition:', operation.newPosition);
    console.log('Operation targetPosition:', operation.targetPosition);
    console.log('-------------------------------\n');

    switch (operation.type) {
      case 'remove': {
        if (!operation.target) {
          throw new Error('Remove operation requires a target');
        }
        // Use Navigator to find and segment, then Worker to remove
        const seg = await this.replicate.detectAndSegment(imageUrl, operation.target);
        if (!seg.found) {
          throw new Error(`Could not find "${operation.target}" in the image`);
        }
        return this.replicate.removeObject(imageUrl, seg.maskUrl!);
      }

      case 'replace': {
        if (!operation.target || !operation.parameters?.replacement) {
          throw new Error('Replace operation requires target and replacement');
        }
        const seg = await this.replicate.detectAndSegment(imageUrl, operation.target);
        if (!seg.found) {
          throw new Error(`Could not find "${operation.target}" in the image`);
        }
        return this.replicate.replaceObject(
          imageUrl,
          seg.maskUrl!,
          operation.parameters.replacement as string
        );
      }

      case 'background': {
        const action = operation.parameters?.action || 'remove';
        if (action === 'remove') {
          return this.replicate.removeBackground(imageUrl);
        } else {
          // Replace background: remove first, then composite
          // For now, just remove - full replacement would need more work
          return this.replicate.removeBackground(imageUrl);
        }
      }

      case 'relight': {
        const style = operation.parameters?.style as string || 'soft natural lighting';
        return this.replicate.relight(imageUrl, style);
      }

      case 'upscale': {
        const scale = (operation.parameters?.scale as 2 | 4) || 4;
        return this.replicate.upscale(imageUrl, scale);
      }

      case 'resize': {
        if (!operation.target) {
          throw new Error('Resize operation requires a target');
        }
        const scaleFactor = (operation.parameters?.scale as number) || 1.5;
        const result = await this.replicate.resizeObject(imageUrl, operation.target, scaleFactor);
        if (!result.success) {
          throw new Error(result.error || 'Resize failed');
        }
        return result.outputUrl!;
      }

      case 'move': {
        if (!operation.target || !operation.newPosition) {
          throw new Error('Move operation requires target and newPosition');
        }
        const position = operation.newPosition as 'left' | 'right' | 'center' | 'top' | 'bottom';
        const result = await this.replicate.moveObject(imageUrl, operation.target, position);
        if (!result.success) {
          throw new Error(result.error || 'Move failed');
        }
        return result.outputUrl!;
      }

      case 'add': {
        const element = operation.parameters?.element as string;
        const position = operation.parameters?.position as string || 'center';
        if (!element) {
          throw new Error('Add operation requires parameters.element');
        }

        // Calculate region based on position
        let region = { x1: 0.3, y1: 0.3, x2: 0.7, y2: 0.7 }; // center default
        switch (position) {
          case 'left':
            region = { x1: 0.05, y1: 0.3, x2: 0.35, y2: 0.7 };
            break;
          case 'right':
            region = { x1: 0.65, y1: 0.3, x2: 0.95, y2: 0.7 };
            break;
          case 'top':
            region = { x1: 0.3, y1: 0.05, x2: 0.7, y2: 0.35 };
            break;
          case 'bottom':
            region = { x1: 0.3, y1: 0.65, x2: 0.7, y2: 0.95 };
            break;
          case 'top-left':
            region = { x1: 0.05, y1: 0.05, x2: 0.35, y2: 0.35 };
            break;
          case 'top-right':
            region = { x1: 0.65, y1: 0.05, x2: 0.95, y2: 0.35 };
            break;
          case 'bottom-left':
            region = { x1: 0.05, y1: 0.65, x2: 0.35, y2: 0.95 };
            break;
          case 'bottom-right':
            region = { x1: 0.65, y1: 0.65, x2: 0.95, y2: 0.95 };
            break;
        }

        return this.replicate.insertObject(imageUrl, element, region);
      }

      case 'detect': {
        // Detection operations return data, not a new image
        // We'll log the results and return the original image
        const target = operation.target || 'objects';

        if (target === 'logos') {
          const result = await this.replicate.detectLogos(imageUrl);
          this.log(`      Found ${result.logos.length} logo(s)`);
          result.logos.forEach((logo, i) => {
            this.log(`        [${i + 1}] confidence: ${(logo.confidence * 100).toFixed(0)}%`);
          });
        } else if (target === 'text') {
          const result = await this.replicate.detectText(imageUrl);
          this.log(`      Found ${result.textRegions.length} text region(s)`);
        } else if (target === 'room_objects') {
          const result = await this.replicate.detectRoomObjects(imageUrl);
          this.log(`      Found ${result.objects.length} object(s):`);
          result.objects.forEach((obj) => {
            this.log(`        • ${obj.label} (${(obj.confidence * 100).toFixed(0)}%)`);
          });
        } else {
          const result = await this.replicate.detectObjects(imageUrl, target);
          this.log(`      Found ${result.boxes.length} "${target}" instance(s)`);
        }

        return imageUrl; // Return original since detect doesn't modify
      }

      case 'describe': {
        const description = await this.replicate.describeImage(imageUrl);
        this.log(`      Description: ${description}`);
        return imageUrl; // Return original since describe doesn't modify
      }

      case 'extract': {
        if (!operation.target) {
          throw new Error('Extract operation requires a target');
        }
        const result = await this.replicate.extractObject(imageUrl, operation.target);
        if (!result.found) {
          throw new Error(`Could not find "${operation.target}" to extract`);
        }
        return result.objectUrl!; // Return the extracted object mask/image
      }

      case 'style':
        throw new Error('Style transfer not yet fully implemented');

      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }
}

// ============ CLI Interface ============

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`
AI Image Editor - Cloud-Powered Natural Language Image Editing

Usage:
  npm run edit -- <image-url> "<instruction>"

Natural Language Examples:
  npm run edit -- <url> "remove the person on the left"
  npm run edit -- <url> "find all logos in this image"
  npm run edit -- <url> "make the chair bigger"
  npm run edit -- <url> "move the lamp to the right"
  npm run edit -- <url> "add a potted plant in the corner"
  npm run edit -- <url> "describe what's in this image"
  npm run edit -- <url> "detect all objects in this room"

Quick Operations (skip AI planning):
  npm run edit -- <url> --remove-bg           Remove background
  npm run edit -- <url> --upscale             Upscale 4x
  npm run edit -- <url> --remove "watermark"  Remove specific object
  npm run edit -- <url> --detect-logos        Find all logos
  npm run edit -- <url> --detect-text         Find text regions
  npm run edit -- <url> --detect-room         Find room objects
  npm run edit -- <url> --describe            Describe image contents
  npm run edit -- <url> --resize "chair" 1.5  Resize object (1.5x)
  npm run edit -- <url> --move "lamp" right   Move object to position
  npm run edit -- <url> --add "plant" bottom  Add object at position

Analysis (Gemini only - no Replicate needed):
  npm run edit -- <url> --analyze             Analyze scene elements
  npm run edit -- <url> --analyze "instruction"  Plan edit without executing

Environment Variables:
  REPLICATE_API_TOKEN - Replicate API token (required)
                        Get one at: https://replicate.com/account/api-tokens

  GOOGLE_AI_API_KEY   - Google AI API key (required for AI planning)
                        Get one at: https://aistudio.google.com/apikey
`);
    process.exit(1);
  }

  const imageUrl = args[0];
  const instruction = args[1];

  try {
    // Analysis-only mode - no Replicate needed, handle before creating editor
    if (instruction === '--analyze') {
      console.log(`\n🎨 AI Image Editor - Scene Analysis Mode`);
      console.log(`🖼️  Image: ${imageUrl}\n`);
      console.log(`━━━ SCENE ANALYSIS (Gemini Vision) ━━━`);

      const director = createGeminiDirector();
      const scene = await director.analyzeScene(imageUrl);

      console.log(`\n  ✓ Found ${scene.elements.length} element(s):`);
      for (const element of scene.elements) {
        console.log(`      • ${element.label} (${element.position}) - ${element.description}`);
      }
      console.log(`\n  📷 Style: ${scene.style}`);
      console.log(`  💡 Lighting: ${scene.lighting}`);
      console.log(`  🎭 Mood: ${scene.mood}`);
      console.log(`  🖼️  Background: ${scene.background}`);
      if (scene.textVisible.length > 0) {
        console.log(`  📝 Text: ${scene.textVisible.join(', ')}`);
      }

      // Show an example edit plan
      if (args[2]) {
        console.log(`\n━━━ EDIT PLAN for: "${args[2]}" ━━━`);
        const plan = await director.planEdit(args[2], scene);
        console.log(`\n${director.describeEditPlan(plan)}`);
      }

      console.log('');
      return;
    }

    // Create editor for operations that need Replicate
    const editor = new AIImageEditor();

    // Quick operation flags
    if (instruction === '--remove-bg') {
      const result = await editor.removeBackground(imageUrl);
      console.log(`\n✅ Output: ${result}`);
      return;
    }

    if (instruction === '--upscale') {
      const result = await editor.upscale(imageUrl);
      console.log(`\n✅ Output: ${result}`);
      return;
    }

    if (instruction === '--remove' && args[2]) {
      const result = await editor.removeObject(imageUrl, args[2]);
      console.log(`\n✅ Output: ${result}`);
      return;
    }

    if (instruction === '--detect-logos') {
      const result = await editor.detectLogos(imageUrl);
      console.log(`\n✅ Found ${result.logos.length} logo(s)`);
      result.logos.forEach((logo, i) => {
        console.log(`  [${i + 1}] confidence: ${(logo.confidence * 100).toFixed(0)}%`);
      });
      return;
    }

    if (instruction === '--detect-text') {
      const result = await editor.detectText(imageUrl);
      console.log(`\n✅ Found ${result.textRegions.length} text region(s)`);
      return;
    }

    if (instruction === '--detect-room') {
      const result = await editor.detectRoomObjects(imageUrl);
      console.log(`\n✅ Found ${result.objects.length} object(s):`);
      result.objects.forEach((obj) => {
        console.log(`  • ${obj.label} (${(obj.confidence * 100).toFixed(0)}%)`);
      });
      return;
    }

    if (instruction === '--describe') {
      const result = await editor.describeImage(imageUrl);
      console.log(`\n✅ Description: ${result}`);
      return;
    }

    if (instruction === '--resize' && args[2] && args[3]) {
      const result = await editor.resizeObject(imageUrl, args[2], parseFloat(args[3]));
      console.log(`\n✅ Output: ${result}`);
      return;
    }

    if (instruction === '--move' && args[2] && args[3]) {
      const position = args[3] as 'left' | 'right' | 'center' | 'top' | 'bottom';
      const result = await editor.moveObject(imageUrl, args[2], position);
      console.log(`\n✅ Output: ${result}`);
      return;
    }

    if (instruction === '--add' && args[2]) {
      const position = args[3] || 'center';
      const result = await editor.addObject(imageUrl, args[2], position);
      console.log(`\n✅ Output: ${result}`);
      return;
    }

    if (instruction === '--relight' && args[2]) {
      const result = await editor.relight(imageUrl, args[2]);
      console.log(`\n✅ Output: ${result}`);
      return;
    }

    // Full AI-powered edit
    const result = await editor.edit(imageUrl, instruction);

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`✅ Edit Complete!`);
    console.log(`📤 Output: ${result.outputUrl}`);
    console.log(`⏱️  Time: ${(result.processingTimeMs / 1000).toFixed(1)}s`);
    console.log(`🔧 Operations: ${result.operations.length}`);
    console.log(`${'═'.repeat(50)}\n`);
  } catch (error) {
    console.error(`\n❌ Error: ${error}`);
    process.exit(1);
  }
}

// Run if called directly (ESM compatible)
const isMainModule = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('ai-image-editor.ts')
);

if (isMainModule) {
  main();
}

export { EditOperation, EditPlan, SceneAnalysis };
