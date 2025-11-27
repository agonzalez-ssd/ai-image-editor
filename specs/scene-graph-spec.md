# Scene Graph Specification

## Overview

The Scene Graph is the core data structure that enables element-level control over image editing. It provides a structured representation of all detected elements, their properties, spatial relationships, and edit history.

## Schema Definition

### Root Object

```typescript
interface SceneGraph {
  scene_id: string;           // UUID v4
  version: string;            // Semantic version (e.g., "1.0.0")
  created_at: string;         // ISO 8601 timestamp
  updated_at: string;         // ISO 8601 timestamp

  // Source image information
  source: {
    url?: string;             // Original image URL (if remote)
    path?: string;            // Local file path
    dimensions: {
      width: number;
      height: number;
    };
    format: string;           // "png", "jpg", "webp"
    hash: string;             // SHA-256 of original image
  };

  // Detected elements
  elements: Element[];

  // Global scene attributes
  global_attributes: GlobalAttributes;

  // Edit history
  edit_history: EditOperation[];

  // Metadata
  metadata: Record<string, unknown>;
}
```

### Element Object

```typescript
interface Element {
  id: string;                 // Unique element ID (e.g., "el_001")
  label: string;              // Object class label (e.g., "person", "car")

  // Spatial information
  bbox: BoundingBox;
  mask: Mask;
  centroid: Point;

  // Detection confidence
  confidence: number;         // 0.0 - 1.0

  // Depth ordering (0 = background, higher = foreground)
  depth_layer: number;

  // Relationships to other elements
  relationships: Relationship[];

  // Element-specific attributes
  attributes: ElementAttributes;

  // Whether element is selected for editing
  selected: boolean;

  // Lock status (prevents accidental edits)
  locked: boolean;
}

interface BoundingBox {
  x1: number;                 // Top-left X (pixels)
  y1: number;                 // Top-left Y (pixels)
  x2: number;                 // Bottom-right X (pixels)
  y2: number;                 // Bottom-right Y (pixels)
}

interface Mask {
  type: "rle" | "base64" | "polygon";
  data: string;               // Encoded mask data
  dimensions: {
    width: number;
    height: number;
  };
}

interface Point {
  x: number;
  y: number;
}

interface Relationship {
  type: "contains" | "contained_by" | "overlaps" | "adjacent" | "above" | "below" | "left_of" | "right_of";
  target_id: string;          // ID of related element
  confidence: number;
}
```

### Element Attributes

```typescript
interface ElementAttributes {
  // Visual properties
  lighting?: {
    direction: [number, number, number];  // Normalized 3D vector
    intensity: number;                     // 0.0 - 1.0
    type: "ambient" | "directional" | "point" | "spot";
    color?: string;                        // Hex color
  };

  // Style properties
  style?: {
    category: string;         // e.g., "realistic", "cartoon", "sketch"
    texture?: string;         // Texture descriptor
    colors: string[];         // Dominant colors (hex)
  };

  // Pose/orientation (for objects with orientation)
  pose?: {
    rotation: number;         // Degrees
    facing: "front" | "back" | "left" | "right" | "unknown";
  };

  // Custom attributes
  custom: Record<string, unknown>;
}
```

### Global Attributes

```typescript
interface GlobalAttributes {
  // Scene-wide lighting
  lighting: {
    direction: [number, number, number];
    ambient_color: string;
    ambient_intensity: number;
    time_of_day?: "dawn" | "morning" | "noon" | "afternoon" | "evening" | "night";
  };

  // Scene style
  style: {
    category: string;
    mood?: string;
  };

  // Environment
  environment?: {
    type: "indoor" | "outdoor" | "studio" | "unknown";
    weather?: string;
    location?: string;
  };

  // Camera properties (estimated)
  camera?: {
    focal_length?: number;
    depth_of_field?: "shallow" | "medium" | "deep";
    perspective?: "wide" | "normal" | "telephoto";
  };
}
```

### Edit Operations

```typescript
interface EditOperation {
  id: string;                 // Operation ID
  timestamp: string;          // ISO 8601
  type: EditType;
  params: EditParams;

  // For undo/redo
  reversible: boolean;
  inverse_operation?: EditOperation;

  // Result reference
  result_snapshot?: string;   // Reference to result image
}

type EditType =
  | "select"
  | "deselect"
  | "move"
  | "resize"
  | "rotate"
  | "remove"
  | "insert"
  | "relight"
  | "style_transfer"
  | "inpaint"
  | "background_change"
  | "global_adjust";

interface EditParams {
  // Target element(s)
  target_ids?: string[];

  // Operation-specific parameters
  [key: string]: unknown;
}
```

## Example Scene Graph

```json
{
  "scene_id": "550e8400-e29b-41d4-a716-446655440000",
  "version": "1.0.0",
  "created_at": "2025-11-25T10:30:00Z",
  "updated_at": "2025-11-25T10:35:00Z",

  "source": {
    "path": "/uploads/original_image.jpg",
    "dimensions": { "width": 1920, "height": 1080 },
    "format": "jpg",
    "hash": "a1b2c3d4e5f6..."
  },

  "elements": [
    {
      "id": "el_001",
      "label": "person",
      "bbox": { "x1": 500, "y1": 200, "x2": 800, "y2": 900 },
      "mask": {
        "type": "rle",
        "data": "eJzs1k...",
        "dimensions": { "width": 300, "height": 700 }
      },
      "centroid": { "x": 650, "y": 550 },
      "confidence": 0.97,
      "depth_layer": 2,
      "relationships": [
        { "type": "above", "target_id": "el_002", "confidence": 0.95 }
      ],
      "attributes": {
        "lighting": {
          "direction": [0.5, -0.8, 0.2],
          "intensity": 0.7,
          "type": "directional"
        },
        "pose": {
          "rotation": 0,
          "facing": "front"
        },
        "custom": {}
      },
      "selected": true,
      "locked": false
    },
    {
      "id": "el_002",
      "label": "chair",
      "bbox": { "x1": 450, "y1": 600, "x2": 700, "y2": 950 },
      "mask": {
        "type": "rle",
        "data": "eJzt2E...",
        "dimensions": { "width": 250, "height": 350 }
      },
      "centroid": { "x": 575, "y": 775 },
      "confidence": 0.92,
      "depth_layer": 1,
      "relationships": [
        { "type": "below", "target_id": "el_001", "confidence": 0.95 }
      ],
      "attributes": {
        "style": {
          "category": "furniture",
          "colors": ["#8B4513", "#D2691E"]
        },
        "custom": {}
      },
      "selected": false,
      "locked": false
    }
  ],

  "global_attributes": {
    "lighting": {
      "direction": [0.5, -0.8, 0.2],
      "ambient_color": "#FFE4C4",
      "ambient_intensity": 0.3,
      "time_of_day": "afternoon"
    },
    "style": {
      "category": "realistic",
      "mood": "warm"
    },
    "environment": {
      "type": "indoor",
      "location": "living room"
    }
  },

  "edit_history": [
    {
      "id": "op_001",
      "timestamp": "2025-11-25T10:32:00Z",
      "type": "select",
      "params": { "target_ids": ["el_001"] },
      "reversible": true
    },
    {
      "id": "op_002",
      "timestamp": "2025-11-25T10:35:00Z",
      "type": "relight",
      "params": {
        "target_ids": ["el_001"],
        "new_direction": [0.8, -0.5, 0.3],
        "intensity": 0.8
      },
      "reversible": true,
      "result_snapshot": "snapshot_002.png"
    }
  ],

  "metadata": {
    "source_application": "ai-image-editor",
    "processing_time_ms": 2500
  }
}
```

## API Operations

### Scene Graph Generation
```http
POST /api/v1/scene-graph/generate
Content-Type: multipart/form-data

image: <binary>
options: {
  "min_confidence": 0.5,
  "detect_relationships": true,
  "estimate_depth": true
}
```

### Scene Graph Update
```http
PATCH /api/v1/scene-graph/{scene_id}
Content-Type: application/json

{
  "operations": [
    {
      "op": "select",
      "element_id": "el_001"
    },
    {
      "op": "update_attribute",
      "element_id": "el_001",
      "path": "attributes.lighting.intensity",
      "value": 0.9
    }
  ]
}
```

### Scene Graph Delta (for Director)
```http
POST /api/v1/scene-graph/{scene_id}/apply-delta
Content-Type: application/json

{
  "delta": {
    "modify": [
      {
        "element_id": "el_001",
        "changes": {
          "attributes.lighting.direction": [0.8, -0.5, 0.3]
        }
      }
    ],
    "remove": [],
    "add": []
  }
}
```

## Validation Rules

1. **Element IDs** must be unique within a scene
2. **Bounding boxes** must be within image dimensions
3. **Confidence scores** must be between 0.0 and 1.0
4. **Depth layers** must be non-negative integers
5. **Masks** must match element bounding box dimensions
6. **Edit history** must be append-only (new operations added at end)

## Serialization

- **Primary format**: JSON
- **Compression**: gzip for storage/transmission
- **Mask encoding**: RLE (Run-Length Encoding) preferred for efficiency

---
*Specification Version: 1.0.0*
*Created: 2025-11-25*
