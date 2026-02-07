/**
 * Gemini Director - Layer 1 of the AI Image Editor
 *
 * The "brain" that:
 * - Analyzes images to understand their content
 * - Plans editing operations based on natural language
 * - Verifies edits were successful
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

// ============ Types ============

export interface SceneElement {
  id: string;
  label: string;
  category: 'person' | 'animal' | 'object' | 'text' | 'logo' | 'vehicle' | 'furniture' | 'plant' | 'food' | 'building' | 'nature' | 'abstract' | 'clothing' | 'accessory' | 'other';
  position: string; // e.g., "top-left", "center", "bottom-right", "foreground-left"
  boundingBox?: {
    x: number; // percentage 0-100 from left
    y: number; // percentage 0-100 from top
    width: number; // percentage 0-100
    height: number; // percentage 0-100
  };
  size: 'tiny' | 'small' | 'medium' | 'large' | 'dominant';
  description: string;
  colors: string[]; // main colors of this element
  material?: string; // wood, metal, fabric, etc.
  state?: string; // broken, new, worn, etc.
  confidence: number;
}

export interface SceneAnalysis {
  elements: SceneElement[];
  people: {
    count: number;
    descriptions: string[];
  };
  text: {
    items: Array<{
      content: string;
      position: string;
      style: string; // handwritten, printed, neon, etc.
    }>;
  };
  logos: {
    items: Array<{
      brand: string;
      position: string;
      size: string;
    }>;
  };
  lighting: {
    type: string; // natural, artificial, mixed
    direction: string; // front, back, side, top, ambient
    quality: string; // soft, harsh, dramatic, flat
    colorTemperature: string; // warm, cool, neutral
  };
  colors: {
    dominant: string[];
    accent: string[];
    palette: string; // warm, cool, neutral, vibrant, muted
  };
  style: string;
  background: {
    type: string; // solid, gradient, pattern, scene, transparent
    description: string;
    complexity: 'simple' | 'moderate' | 'complex';
  };
  composition: {
    type: string; // centered, rule-of-thirds, symmetrical, diagonal, etc.
    focusPoint: string;
    depth: 'flat' | 'shallow' | 'deep';
  };
  mood: string;
  quality: {
    resolution: 'low' | 'medium' | 'high';
    noise: 'none' | 'low' | 'medium' | 'high';
    blur: 'none' | 'slight' | 'moderate' | 'heavy';
    artifacts: string[];
  };
  textVisible: string[];
  suggestedEdits: string[]; // AI suggestions for what could be edited
}

export interface EditOperation {
  type:
    | 'remove'
    | 'replace'
    | 'add'
    | 'relight'
    | 'background'
    | 'upscale'
    | 'style'
    | 'move'
    | 'resize'
    | 'detect'
    | 'describe'
    | 'extract';
  target?: string;
  targetPosition?: string;
  newPosition?: string;
  parameters?: Record<string, unknown>;
}

export interface EditPlan {
  operations: EditOperation[];
  reasoning: string;
  confidence: number;
}

export interface DirectorConfig {
  apiKey: string;
  model?: string;
}

// ============ Prompts ============

const SCENE_ANALYSIS_PROMPT = `You are a professional image analyst for an AI image editing tool. Perform an EXHAUSTIVE analysis of this image, detecting EVERY element that could potentially be edited.

Return a JSON object with this EXACT structure:

{
  "elements": [
    {
      "id": "element_1",
      "label": "specific name (e.g., 'red coffee mug', 'woman in blue dress', 'Nike logo')",
      "category": "person|animal|object|text|logo|vehicle|furniture|plant|food|building|nature|abstract|clothing|accessory|other",
      "position": "e.g., top-left, center, bottom-right, foreground-center, background-left",
      "boundingBox": {
        "x": 25,
        "y": 10,
        "width": 30,
        "height": 40
      },
      "size": "tiny|small|medium|large|dominant",
      "description": "detailed description of the element",
      "colors": ["red", "dark brown"],
      "material": "wood|metal|fabric|plastic|glass|paper|skin|fur|etc",
      "state": "new|worn|broken|clean|dirty|etc",
      "confidence": 0.95
    }
  ],
  "people": {
    "count": 2,
    "descriptions": ["man in suit standing left", "woman sitting at desk"]
  },
  "text": {
    "items": [
      {
        "content": "exact text content",
        "position": "top-center",
        "style": "printed|handwritten|neon|digital|engraved|etc"
      }
    ]
  },
  "logos": {
    "items": [
      {
        "brand": "brand name or 'unknown'",
        "position": "bottom-right",
        "size": "small"
      }
    ]
  },
  "lighting": {
    "type": "natural|artificial|mixed",
    "direction": "front|back|side|top|ambient|multiple",
    "quality": "soft|harsh|dramatic|flat|high-key|low-key",
    "colorTemperature": "warm|cool|neutral|golden|blue"
  },
  "colors": {
    "dominant": ["#hex or color name", "..."],
    "accent": ["accent colors"],
    "palette": "warm|cool|neutral|vibrant|muted|monochrome|complementary"
  },
  "style": "photograph|illustration|3d-render|painting|sketch|collage|screenshot|etc",
  "background": {
    "type": "solid|gradient|pattern|scene|transparent|blurred",
    "description": "detailed background description",
    "complexity": "simple|moderate|complex"
  },
  "composition": {
    "type": "centered|rule-of-thirds|symmetrical|diagonal|leading-lines|framing|etc",
    "focusPoint": "describe what draws the eye",
    "depth": "flat|shallow|deep"
  },
  "mood": "professional|casual|dramatic|peaceful|energetic|mysterious|etc",
  "quality": {
    "resolution": "low|medium|high",
    "noise": "none|low|medium|high",
    "blur": "none|slight|moderate|heavy",
    "artifacts": ["jpeg artifacts", "banding", "pixelation", "etc"]
  },
  "textVisible": ["all", "readable", "text", "in", "image"],
  "suggestedEdits": [
    "Remove background clutter",
    "Enhance lighting",
    "Remove watermark at bottom-right",
    "Color correct the shadows"
  ]
}

IMPORTANT GUIDELINES:
1. Detect ALL visible elements - even small, partially visible, or background elements
2. Include ALL text you can read, even partial text
3. Identify ANY logos or brand marks, even if partially visible
4. Be specific with labels (not "cup" but "white ceramic coffee cup")
5. Estimate bounding boxes as percentages (x, y from top-left; width, height as % of image)
6. Position uses format: "vertical-horizontal" or single word (e.g., "top-left", "center", "foreground-right")
7. Suggest at least 3-5 potential edits based on what you see
8. For people, describe clothing, pose, and any distinguishing features
9. Note any watermarks, timestamps, or UI elements
10. Include shadows, reflections, and other secondary visual elements

Return ONLY valid JSON, no markdown code blocks or explanation.`;

const EDIT_PLANNING_PROMPT = `You are an AI image editing planner. Given a user instruction and scene analysis, create an edit plan.

User instruction: "{instruction}"

Scene analysis:
{sceneAnalysis}

Available operations:
- remove: Remove an element (requires target: "logo", "person", "text", etc.)
- replace: Replace element with something else (requires target + parameters.replacement)
- add: Add new element (requires parameters.element description + parameters.position: left|right|center|top|bottom)
- relight: Change lighting (requires parameters.style: backlit|soft|dramatic|golden_hour|rim_light|etc)
- background: Remove or replace background (parameters.action: remove|replace, parameters.replacement if replace)
- upscale: Increase resolution (parameters.scale: 2|4)
- style: Apply style transfer (parameters.style description)
- move: Move element to new position (requires target + newPosition: left|right|center|top|bottom)
- resize: Scale an element larger/smaller (requires target + parameters.scale: 0.5 for half, 2.0 for double)
- detect: Find specific elements (requires target: "logos"|"text"|"room_objects"|custom object name)
- describe: Get detailed description of image contents
- extract: Extract an element from the image (requires target)

Examples:
- "find all logos" → detect with target: "logos"
- "make the chair bigger" → resize with target: "chair", parameters.scale: 1.5
- "add a plant in the corner" → add with parameters.element: "potted plant", parameters.position: "bottom-right"
- "move the lamp to the left" → move with target: "lamp", newPosition: "left"

Return a JSON object:
{
  "operations": [
    {
      "type": "operation_type",
      "target": "element label (if applicable)",
      "targetPosition": "current position (if applicable)",
      "newPosition": "new position (if move/add operation)",
      "parameters": { }
    }
  ],
  "reasoning": "1-2 sentence explanation",
  "confidence": 0.0-1.0
}

Return ONLY valid JSON, no markdown.`;

const VERIFICATION_PROMPT = `Compare these two images for an AI image editor verification.

Original instruction: "{instruction}"
Expected changes: {expectedChanges}

Analyze if the edit was successful. Return JSON:
{
  "success": true|false,
  "changesDetected": ["list of changes you see"],
  "issues": ["any problems or artifacts"],
  "confidence": 0.0-1.0
}

Return ONLY valid JSON.`;

// ============ Director Class ============

export class GeminiDirector {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private modelName: string;

  constructor(config: DirectorConfig) {
    if (!config.apiKey) {
      throw new Error(
        'Gemini API key required. Set GOOGLE_AI_API_KEY environment variable ' +
        'or pass apiKey to constructor. Get one at: https://aistudio.google.com/apikey'
      );
    }

    this.modelName = config.model || 'gemini-2.5-flash';
    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        // @ts-ignore - responseMimeType forces valid JSON output
        responseMimeType: 'application/json',
      },
    });
  }

  /**
   * Analyze an image to understand its content and structure
   */
  async analyzeScene(imageSource: string | Buffer): Promise<SceneAnalysis> {
    const imageData = await this.prepareImageData(imageSource);

    const result = await this.model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: SCENE_ANALYSIS_PROMPT },
          {
            inlineData: {
              mimeType: 'image/png',
              data: imageData,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 16384,
      },
    });

    const text = result.response.text();
    return this.parseJSON<SceneAnalysis>(text, 'scene analysis');
  }

  /**
   * Create an edit plan from natural language instruction
   */
  async planEdit(instruction: string, sceneAnalysis: SceneAnalysis): Promise<EditPlan> {
    const prompt = EDIT_PLANNING_PROMPT
      .replace('{instruction}', instruction)
      .replace('{sceneAnalysis}', JSON.stringify(sceneAnalysis, null, 2));

    const result = await this.model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    });

    const text = result.response.text();
    return this.parseJSON<EditPlan>(text, 'edit plan');
  }

  /**
   * Verify that an edit was successful by comparing before/after
   */
  async verifyEdit(
    originalImage: string | Buffer,
    editedImage: string | Buffer,
    instruction: string,
    expectedChanges: string[]
  ): Promise<{ success: boolean; confidence: number; issues: string[] }> {
    const originalData = await this.prepareImageData(originalImage);
    const editedData = await this.prepareImageData(editedImage);

    const prompt = VERIFICATION_PROMPT
      .replace('{instruction}', instruction)
      .replace('{expectedChanges}', JSON.stringify(expectedChanges));

    const result = await this.model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { text: 'Original image:' },
          { inlineData: { mimeType: 'image/png', data: originalData } },
          { text: 'Edited image:' },
          { inlineData: { mimeType: 'image/png', data: editedData } },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
      },
    });

    const text = result.response.text();
    const verification = this.parseJSON<{
      success: boolean;
      changesDetected: string[];
      issues: string[];
      confidence: number;
    }>(text, 'verification');

    return {
      success: verification.success,
      confidence: verification.confidence,
      issues: verification.issues,
    };
  }

  /**
   * Generate a natural language description of the edit plan
   */
  describeEditPlan(plan: EditPlan): string {
    const steps = plan.operations.map((op, i) => {
      switch (op.type) {
        case 'remove':
          return `${i + 1}. Remove "${op.target}"`;
        case 'replace':
          return `${i + 1}. Replace "${op.target}" with "${op.parameters?.replacement}"`;
        case 'add':
          return `${i + 1}. Add "${op.parameters?.element}" at ${op.parameters?.position}`;
        case 'move':
          return `${i + 1}. Move "${op.target}" from ${op.targetPosition} to ${op.newPosition}`;
        case 'relight':
          return `${i + 1}. Apply ${op.parameters?.style} lighting`;
        case 'background':
          const action = op.parameters?.action === 'remove' ? 'Remove' : 'Replace';
          return `${i + 1}. ${action} background`;
        case 'upscale':
          return `${i + 1}. Upscale ${op.parameters?.scale}x`;
        case 'style':
          return `${i + 1}. Apply "${op.parameters?.style}" style`;
        case 'resize':
          const scale = op.parameters?.scale as number;
          const direction = scale > 1 ? 'larger' : 'smaller';
          return `${i + 1}. Make "${op.target}" ${direction} (${scale}x)`;
        case 'detect':
          return `${i + 1}. Detect all "${op.target}" in image`;
        case 'describe':
          return `${i + 1}. Describe image contents`;
        case 'extract':
          return `${i + 1}. Extract "${op.target}" from image`;
        default:
          return `${i + 1}. ${op.type}`;
      }
    });

    return `Edit Plan (${(plan.confidence * 100).toFixed(0)}% confidence):\n${steps.join('\n')}\n\nReasoning: ${plan.reasoning}`;
  }

  // ============ Helper Methods ============

  private async prepareImageData(source: string | Buffer): Promise<string> {
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

  private parseJSON<T>(text: string, context: string): T {
    // Clean up common issues with LLM JSON output
    let cleaned = text.trim();

    // Extract JSON from markdown code blocks using regex (handles whitespace variations)
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    } else {
      // Fallback: strip leading/trailing backtick fences manually
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();
    }

    // Try to extract JSON object/array if there's extra text around it
    if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
      const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonMatch) {
        cleaned = jsonMatch[1];
      }
    }

    try {
      return JSON.parse(cleaned) as T;
    } catch (error: any) {
      console.error(`JSON parse error for ${context}:`, error.message);
      console.error(`Response length: ${cleaned.length}, last 100 chars: ...${cleaned.slice(-100)}`);
      throw new Error(
        `Failed to parse ${context} from Gemini response. ` +
        `Parse error: ${error.message}. ` +
        `Response length: ${cleaned.length}`
      );
    }
  }
}

// ============ Factory Function ============

export function createGeminiDirector(apiKey?: string): GeminiDirector {
  const key = apiKey || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error(
      'Gemini API key required. Set GOOGLE_AI_API_KEY environment variable ' +
      'or pass apiKey to createGeminiDirector(). Get one at: https://aistudio.google.com/apikey'
    );
  }

  return new GeminiDirector({ apiKey: key });
}
