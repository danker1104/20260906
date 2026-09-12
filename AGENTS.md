# MangaFind Agent Instructions

## Project Context

MangaFind is a Korean-language, mobile-first PWA that identifies Japanese manga from 1-3 uploaded screenshots. The product combines image clues, web search, Korean title/publication lookup, and a final judgment step.

Primary documents:

- `기획서.md`: original product concept and scope
- `PRD.md`: product requirements, user flows, acceptance criteria, and V1/V2 boundaries
- `아키텍처.md`: logical architecture, component boundaries, data lifetime, and failure propagation
- `TRD.md`: technical contracts, schemas, security, deployment, observability, and test requirements
- `DESIGN.md`: UI/UX, responsive behavior, PWA screens, component states, and accessibility requirements
- `docs/figma-workflow.md`: Figma MCP workflow and design handoff procedure

## Document Authority

When documents conflict, use this precedence:

1. `TRD.md` for implementation contracts and technical constraints
2. `PRD.md` for user-visible behavior and product scope
3. `아키텍처.md` for component boundaries and runtime flow
4. `DESIGN.md` for visual and interaction details
5. `기획서.md` for original intent, unless overridden by the documents above

If a requested change conflicts with a higher-priority document, identify the conflict before editing. Keep all affected documents synchronized when a public behavior or API contract changes.

## Technology Baseline

- TypeScript with strict mode
- Node.js LTS
- Next.js App Router and React
- Tailwind CSS
- Gemini API with `gemini-2.5-pro` and `gemini-2.5-flash`
- Gemini `google_search` tool for Japanese and Korean information searches
- JSON Schema or Zod validation at external boundaries
- Docker and Azure Container Apps
- Azure API Management for global rate limiting
- Azure Key Vault with Container Apps Managed Identity for secrets
- TypeScript unit, integration, contract, and Playwright E2E tests

Do not introduce Python, a separate OCR runtime, a separate search server, a database, or a queue/worker system in V1 unless the user explicitly changes the scope and the documents are updated first.

## Core Pipeline

The request pipeline is synchronous and must preserve this order:

```text
Image validation
→ ① Gemini 2.5 Pro image analysis
→ ② Gemini 2.5 Flash + Google Search Japanese candidate search
→ ③ Gemini 2.5 Flash + Google Search Korean information search
→ ④ Gemini 2.5 Pro final judgment
→ Response schema validation
→ UI result
```

Pipeline rules:

- ① extracts Japanese text and visual clues; it does not identify the final work.
- ② returns ranked Japanese candidates, maximum three, with evidence.
- ③ receives the fixed ranks from ② and returns Korean title/publication information per candidate in one Flash + Search step.
- ③ may return `PARTIAL`, `INSUFFICIENT`, `FAILED`, or `TIMEOUT` per candidate.
- If ② has candidates, ④ must still run when ③ fails, times out, or returns insufficient information.
- When ③ fails and ④ succeeds, the top-level status is `PARTIAL_SUCCESS`; missing Korean fields are `UNKNOWN` and `koreanTitle` is `null`.
- If ④ fails, times out, or fails schema validation, return `FAILED` with an empty candidate list. Never expose raw intermediate model output.
- ④ does not receive the original image and does not perform new web searches.
- Preserve candidate ranks across ②, ③, and ④.

## API and Type Boundaries

- Public endpoint: `POST /api/identify` with `multipart/form-data` field `images`.
- Accept 1-3 images: JPG/JPEG, PNG, or WebP.
- Per-file limit: 10MB.
- Maximum width/height: 8192px.
- Maximum pixels per image: 64MP.
- Validate on the server using actual MIME/magic bytes and safe decoding; client validation is only for UX.
- Treat all model and search responses as untrusted `unknown` data.
- Validate every external response against a schema before internal use.
- Do not pass raw Gemini responses between stages.
- Keep `evidence` as 1-5 values from the documented `EvidenceCode` enum.
- Use structured errors with a safe public message and `requestId`; never expose stack traces, prompts, provider error bodies, or secrets.

Title and publication states:

- Title: `OFFICIAL`, `COMMON`, `TRANSLATED`, `UNKNOWN`
- Publication: `CONFIRMED`, `NOT_FOUND`, `UNKNOWN`
- `TRANSLATED` must be labeled as AI/reference translation in the UI.
- `UNKNOWN` must be displayed as Korean title/publication information being unconfirmed.
- Never present an AI translation as an official or common title.
- Do not show search source URLs or source lists in the V1 UI; use internal evidence only.

## Reliability, Security, and Privacy

- Overall request timeout: 60 seconds.
- Stage timeout: 12 seconds for each external model stage.
- Server automatic retries: none. A failed or timed-out stage is recorded and the user may submit a new request.
- Global rate limit: APIM, IP-based, 3 requests/minute and 30 requests/day; return HTTP 429 with `Retry-After`.
- Store Gemini API keys in Azure Key Vault and inject them through Managed Identity. Never put keys in source, Docker images, `.env.example`, browser bundles, logs, or chat messages.
- Keep image buffers only inside the request context and release them in a `finally` cleanup path for success, failure, timeout, and exceptions.
- Do not persist original images, search history, or raw search content in V1.
- Remove EXIF/IPTC/XMP metadata before model transfer.
- Do not log image bodies, raw search content, full URL lists, prompts, API keys, or personal data.
- Use request IDs for structured logs and metrics.
- Measure stage latency, model/token usage where available, Search usage, outcome status, and request cost without sensitive payloads.

## UI and Design Rules

- Upload is the primary action on mobile and the first useful action on the website.
- Mobile: 0-767px; Tablet: 768-1023px; Desktop: 1024px and above.
- Keep upload, preview, analysis, result, partial success, insufficient clues, invalid image, timeout, and failed states explicit.
- Analysis UI must mirror the real pipeline: image clues, Japanese search, Korean search, final result.
- Never show invented progress percentages or completed stages that have not completed.
- Use `HIGH`, `MEDIUM`, and `LOW` as ordinal judgment levels, never numeric probabilities.
- Show `PARTIAL_SUCCESS` clearly: Japanese result may be shown, while Korean title/publication fields say `확인 불충분`.
- Keep optional fields such as cover, genre, publisher, serialization, and status hidden unless confirmed.
- Preserve layout for missing images and null fields; never render broken empty cards.
- Keep results in the current browser session only in V1. Do not encode results in URLs. On direct reload/re-entry, route the user back to search home.
- Respect safe areas on standalone PWA screens.
- Use semantic HTML, visible `:focus-visible` states, labels for controls, `aria-label` for icon-only buttons, and `aria-live="polite"` for async status updates.
- Do not rely on color alone for status. Honor `prefers-reduced-motion`.
- Use `button` for actions and links for navigation. Keep primary touch targets large enough for mobile use.
- Use image dimensions/aspect ratios to prevent layout shift and handle long Japanese/Korean text with wrapping or truncation.

## Code Organization

Prefer this structure:

```text
MangaFind/
├─ azure.yaml                         AZD service definition
├─ Dockerfile                          Production container image
├─ package.json                        Dependencies and scripts
├─ next.config.*                       Next.js configuration
├─ src/
│  ├─ app/                             Pages and Route Handlers
│  │  ├─ page.tsx                      Website/PWA search home
│  │  ├─ layout.tsx                    Shared HTML, metadata, and providers
│  │  ├─ globals.css                   Global styles and design tokens
│  │  └─ api/
│  │     ├─ health/route.ts            Container health probe
│  │     └─ identify/route.ts           POST /api/identify entry point
│  ├─ components/                      Shared React UI components
│  │  ├─ upload/                       Upload, preview, and validation UI
│  │  ├─ analysis/                     Pipeline progress UI
│  │  └─ results/                      Candidate and status result UI
│  └─ lib/
│     ├─ domain/                       Shared types and status mapping
│     ├─ pipeline/                     ①→②→③→④ orchestration
│     ├─ ai/                           Gemini adapters and prompts
│     ├─ validation/                   Image, environment, and response validation
│     └─ observability/                Request IDs, logs, and metrics
├─ tests/                              Unit, integration, and contract tests
├─ e2e/                                Browser user-flow tests
├─ infra/                              Azure resources and permissions
└─ .azure/                             AZD deployment plan and environment state
```

`src/app`, `src/components`, and `src/lib` are code responsibility boundaries, not separate AZD services or containers. Website and PWA experiences remain in the same Next.js application.

Keep HTTP orchestration in Route Handlers. Keep prompts, model adapters, business rules, validation, and UI components in their owning modules. Do not put model prompts or candidate-ranking policy directly in a Route Handler.

## Skill Usage

Project-local skills are installed under `.agents/skills/`. Use them when the task matches:

- `gemini-api`: Gemini API, multimodal image input, structured output, Search tools, token/caching/batch decisions. Read `.agents/skills/gemini-api/SKILL.md` before Gemini implementation.
- `vercel-react-best-practices`: React/Next.js components, data fetching, bundle, hydration, or performance work. Read `.agents/skills/vercel-react-best-practices/SKILL.md` before implementation or review.
- `web-design-guidelines`: UI accessibility, responsive behavior, forms, loading, errors, or interaction review. Read `.agents/skills/web-design-guidelines/SKILL.md` before UI review.
- `frontend-design`: new screens, visual direction, typography, color, motion, or design-system work. Read `.agents/skills/frontend-design/SKILL.md` before design implementation.

Also use the built-in skills when applicable:

- `api-and-interface-design` for public API or module contracts
- `security-and-hardening` for uploads, secrets, external APIs, and untrusted model output
- `test-driven-development` for behavior changes and bug fixes
- `observability-and-instrumentation` for logs, metrics, traces, or alerts
- `source-driven-development` for version-sensitive framework or SDK decisions
- `azure-validate` before Azure readiness validation
- `azure-deploy` only for an already-prepared and validated deployment
- `code-review-and-quality` before merge or when reviewing implementation

Do not install or invoke a skill merely because it is listed. Load the relevant skill instructions before using it, and prefer project-local skills for their matching domains.

## Implementation Workflow

1. Read the relevant section of `PRD.md`, `TRD.md`, `아키텍처.md`, and `DESIGN.md` before changing behavior.
2. State one local hypothesis and one focused validation check before the first edit.
3. Make the smallest change that tests the hypothesis.
4. Immediately run focused validation after the first substantive edit.
5. Add or update behavior-focused tests at public seams.
6. Run the narrowest relevant checks first, then the full project checks when the project exists.
7. Keep documentation and schemas synchronized with public behavior changes.
8. Review security, cost, latency, and observability impact before completion.
9. Inspect `git diff`, avoid unrelated changes, and use descriptive atomic commits when commits are requested.

## Validation Expectations

Before considering V1 implementation complete:

- Validate image boundaries and invalid-file behavior.
- Test all pipeline states, especially ③ failure followed by ④ success.
- Test ④ schema failure returns `FAILED` without raw intermediate output.
- Test title/publication state combinations and nullable fields.
- Run the 30-request benchmark: 1, 2, and 3 image cases, including success, insufficient search, and Korean-information partial failure.
- Verify p95 total latency is at most 60 seconds and cost is within the approved budget.
- Verify API keys are absent from browser bundles, Git, Docker images, and logs.
- Verify image buffers and temporary data are released on every exit path.
- Verify APIM rate limits and Key Vault Managed Identity in staging.

## Change Boundaries

Always:

- Preserve V1 scope and the API/status contracts.
- Validate untrusted files and model output at boundaries.
- Keep secrets out of code, documentation values, logs, and chat.
- Keep user-facing labels consistent with `DESIGN.md`.

Ask first:

- Adding authentication, a database, persistent image/result storage, queue/worker processing, or a new search provider.
- Changing the 4-stage Gemini pipeline, model roles, timeout budget, retry policy, rate limits, or public API schema.
- Changing V1 source-display policy or title/publication state semantics.
- Changing Azure APIM, Key Vault, Managed Identity, networking, or deployment scope.

Never:

- Commit API keys, tokens, `.env` files, or personal images.
- Expose raw Gemini/Search output, stack traces, prompts, or secrets to users.
- Treat AI-generated translation as an official/common title.
- Add a retry loop that bypasses the documented timeout/cost policy.
- Persist user images or search history without an explicit scope decision.
