# AI Image Editor - Implementation Plan

## MCP Ecosystem Mapping

Analysis of available MCPs in the workspace and how they can accelerate development:

### High-Value MCPs for This Project

| MCP Server | Relevance | Use Case |
|------------|-----------|----------|
| **google-gemini-mcp** | Critical | LLM Director layer - can use Gemini Pro for intent parsing, Scene Graph generation, and workflow orchestration |
| **spec-driven-mcp** | High | Define specifications for Scene Graph schema, API contracts, and workflow definitions |
| **task-executor-mcp** | High | Manage implementation tasks and track progress through phases |
| **project-management-mcp** | High | Goal tracking, roadmap management, progress updates |
| **code-review-mcp** | Medium | Code quality analysis during development |
| **test-generator-mcp** | Medium | Generate unit tests for API endpoints and utility functions |
| **parallelization-mcp** | Medium | Parallel processing of batch image operations |
| **performance-monitor-mcp** | Medium | Monitor API response times and model inference performance |

### Google Gemini MCP - Key Tools for Director Layer

The `google-gemini-mcp` provides essential capabilities:

1. **`generate_text`** - Core LLM reasoning for:
   - Intent classification
   - Edit instruction decomposition
   - Scene Graph generation

2. **`analyze_image`** - Vision capabilities for:
   - Initial scene understanding
   - Quality verification
   - Before/after comparison

3. **`generate_code`** - Code generation for:
   - ComfyUI workflow JSON generation
   - API endpoint scaffolding

4. **`extract_structured_data`** - For:
   - Parsing user instructions into structured edit commands
   - Scene Graph extraction from descriptions

## Implementation Phases

### Phase 1: Foundation & Infrastructure
**Duration: Core Setup**

#### Goals
- Set up ComfyUI in API mode
- Create project structure with proper TypeScript/Python setup
- Establish base API architecture

#### Tasks
1. [ ] Install and configure ComfyUI
2. [ ] Set up Docker environment for reproducibility
3. [ ] Create FastAPI project structure
4. [ ] Implement basic health check endpoints
5. [ ] Set up logging and monitoring

#### Deliverables
- Running ComfyUI instance
- Basic API responding to requests
- Development environment documentation

---

### Phase 2: Navigator Layer (Grounding DINO + SAM 2)
**Duration: Detection & Segmentation**

#### Goals
- Integrate Grounding DINO for object detection
- Integrate SAM 2 for instance segmentation
- Build Scene Graph generation pipeline

#### Tasks
1. [ ] Set up Grounding DINO model
2. [ ] Implement object detection API endpoint
3. [ ] Set up SAM 2 model
4. [ ] Implement segmentation from bounding boxes
5. [ ] Create Scene Graph generation service
6. [ ] Build mask management utilities

#### Key APIs
```python
POST /api/v1/detect
POST /api/v1/segment
POST /api/v1/scene-graph/generate
GET  /api/v1/scene-graph/{scene_id}
```

#### Deliverables
- Working detection pipeline
- Segmentation with mask output
- Scene Graph JSON generation

---

### Phase 3: Worker Modules Integration
**Duration: Editing Capabilities**

#### Goals
- Integrate IC-Light for relighting
- Integrate GLIGEN for object placement
- Integrate LaMa for inpainting
- Create ComfyUI workflow templates

#### Tasks
1. [ ] Create IC-Light ComfyUI workflow
2. [ ] Implement relighting API endpoint
3. [ ] Create GLIGEN placement workflow
4. [ ] Implement object insertion API
5. [ ] Create LaMa inpainting workflow
6. [ ] Implement removal/inpainting API
7. [ ] Build workflow orchestration service

#### Key APIs
```python
POST /api/v1/edit/relight
POST /api/v1/edit/insert
POST /api/v1/edit/remove
POST /api/v1/edit/inpaint
```

#### Deliverables
- Individual worker modules functional
- ComfyUI workflow templates
- Edit operation APIs

---

### Phase 4: Director Layer (LLM Orchestration)
**Duration: Intelligence Layer**

#### Goals
- Implement LLM-based instruction parsing
- Build edit workflow planning
- Create conversational editing interface

#### Tasks
1. [ ] Design prompt templates for edit understanding
2. [ ] Implement instruction-to-Scene-Graph-delta parser
3. [ ] Build workflow planner (selects appropriate workers)
4. [ ] Implement edit history tracking
5. [ ] Create conversation context management
6. [ ] Build iterative refinement loop

#### Using Google Gemini MCP
```typescript
// Example: Using google-gemini for instruction parsing
const editPlan = await mcp__google_gemini__generate_text({
  prompt: `Parse this editing instruction and return a JSON plan:
           User: "${userInstruction}"
           Current Scene Graph: ${JSON.stringify(sceneGraph)}`,
  systemInstruction: DIRECTOR_SYSTEM_PROMPT,
  groundWithSearch: false
});
```

#### Key APIs
```python
POST /api/v1/director/plan
POST /api/v1/director/execute
POST /api/v1/director/refine
GET  /api/v1/director/history
```

#### Deliverables
- Natural language instruction processing
- Automated workflow planning
- Edit history and undo capability

---

### Phase 5: API & Interface
**Duration: User-Facing Layer**

#### Goals
- Complete REST API
- WebSocket for real-time updates
- Basic web interface (optional)

#### Tasks
1. [ ] Finalize API documentation (OpenAPI spec)
2. [ ] Implement authentication/authorization
3. [ ] Add WebSocket for progress streaming
4. [ ] Create rate limiting and quotas
5. [ ] Build basic web UI (React)
6. [ ] Implement image upload/download

#### Deliverables
- Production-ready API
- Interactive documentation
- Basic functional UI

---

## Technical Decisions

### Why ComfyUI as Backend?
1. **Modular workflow system** - Easy to compose complex pipelines
2. **Model hot-swapping** - Switch models without code changes
3. **Active community** - Many custom nodes available
4. **API mode** - Clean HTTP interface for automation

### Why Grounding DINO + SAM 2?
1. **Zero-shot detection** - No training needed for new objects
2. **State-of-art segmentation** - SAM 2 provides best-in-class masks
3. **Complementary** - DINO finds it, SAM segments it

### Model Hosting Strategy
| Component | Hosting | Rationale |
|-----------|---------|-----------|
| Gemini API | Cloud | Low latency, high reliability |
| Grounding DINO | Local/Cloud | Medium model, can run locally |
| SAM 2 | Local | Fast inference needed |
| ComfyUI Workers | Local | GPU-intensive, needs control |

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| GPU memory constraints | High | Model quantization, selective loading |
| API rate limits | Medium | Request queuing, caching |
| Workflow complexity | Medium | Thorough testing, fallback paths |
| Model version conflicts | Low | Docker isolation, pinned versions |

## Success Metrics

1. **Detection Accuracy**: >90% mAP on common objects
2. **Segmentation Quality**: IoU >0.85 on detected objects
3. **Edit Latency**: <10s for simple edits, <30s for complex
4. **User Intent Match**: >80% first-attempt success rate

## Next Steps

1. **Immediate**: Set up development environment with ComfyUI
2. **This Week**: Complete Phase 1 infrastructure
3. **Next Sprint**: Begin Navigator layer implementation

---
*Plan created: 2025-11-25*
*Last updated: 2025-11-25*
