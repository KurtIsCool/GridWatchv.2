# GridWatch Cloudflare ingestion architecture

Verified on 2026-09-10 against current Cloudflare documentation. Runtime soft limits remain configuration values because platform quotas can change.

## Data flow

```text
NGCP configured official URL (HTTP, every 30 minutes)
                         MORE Power accessible source (operator-triggered only)
                                          or manual local image
                  |                                   |
                  v                                   v
             source collector -> source_items + source_revisions
                  |                    |
                  |                    +-> private R2 raw evidence when bound
                  v
          INGESTION_QUEUE (source ID and revision only)
                  |
                  v
        deterministic parser, or Workers AI image extraction when needed
                  |
                  v
             strict candidate JSON
                  |
                  v
     canonical normalization from project PSA and feeder data
                  |
                  v
          deterministic validateCandidate()
             |                    |
          VALIDATED          REVIEW_REQUIRED / REJECTED
             |                    |
     publishCandidate()        review_queue
             |
             v
        published D1 event -> read-only public API -> resident/ops pages
```

Collectors cannot publish. The queue consumer cannot skip validation. Workers AI produces only an extraction candidate and is forbidden from assigning PSGC codes or stable feeder IDs. Only `publishCandidate()` writes a public event, and it rejects any validation state other than `VALIDATED`.

## Bindings and schedules

`cloudflare/wrangler.jsonc` declares:

- `DB`: D1 database.
- `RAW_SOURCES`: private Standard-class R2 bucket.
- `INGESTION_QUEUE`: Queue producer and consumer.
- `AI`: Workers AI binding.
- `BROWSER`: Browser Rendering binding reserved for an approved accessible MORE Power source adapter.
- Cron `*/30 * * * *`: NGCP only. No MORE Power browser cron is enabled.

`cloudflare/wrangler.local.jsonc` deliberately omits the remote-only AI binding and unused browser binding. `npm run cf:dev` uses this profile, so local API, D1, R2, Queue, and cron development does not start OAuth or require Cloudflare credentials. AI behavior is covered with mock extraction tests and fails closed as `AI_NOT_CONNECTED` locally.

`NGCP_SOURCE_URL` is intentionally blank. GridWatch does not invent an official endpoint. Until an official stable URL is selected, NGCP runs record `NOT_CONNECTED`.

The MORE Power browser adapter is replaceable and operator-triggered. It does not log in, bypass CAPTCHA, evade bot protection, or assume captions contain advisory details. Without an approved accessible source selector it returns `REVIEW_REQUIRED`, leaving the manual image workflow available.

## D1 schema

- `source_items`: current source identity, provenance, content hash, raw key, processing state, and current revision.
- `source_revisions`: immutable content revisions for one source item.
- `candidate_events`: parser/AI output plus validation outcome; never public by itself.
- `events`: publication-gated logical events and explicit lifecycle state.
- `event_targets`: original label, exact PSA identity, and preserved coverage.
- `event_feeders`: original label plus deterministic feeder ID.
- `review_queue`: unresolved or rejected candidates retained for operator review.
- `ingestion_runs`: source-check history and failure state.
- `usage_daily`: browser seconds/runs, AI calls/units, and estimated Queue operations.
- `operational_events`: budget and other ingestion health signals.

Foreign keys, uniqueness constraints, and indexes make retries idempotent. One source revision/parser version creates at most one candidate, and one source revision creates at most one published event.

## Canonical identity

`tools/build-cloudflare-data.mjs` converts the existing `data/psa-iloilo-city-barangays.json` and `data/feeder-mapping.json` files into Worker modules. The build fails unless city PSGC is `0631000000` and the PSA registry contains exactly 180 barangays.

Automatic barangay matching accepts exact normalized PSA names plus aliases already marked `EXPLICIT_ALIAS` in the canonical feeder dataset. It never creates a second hand-maintained alias list. Ambiguous or unknown labels remain unresolved. Feeder resolution accepts canonical feeder labels only.

## Source and evidence storage

Meaningful new source bodies are SHA-256 hashed. An unchanged hash is not archived or enqueued again. R2 keys are deterministic:

```text
sources/<publisher>/<year>/<month>/<source-id>/<content-hash-prefix>-<filename>
```

R2 is not publicly exposed. Small text sources retain an inline D1 fallback when R2 is absent; image sources remain review-required if raw bytes cannot be loaded. The local image tool archives to ignored `.gridwatch-local/raw/` storage and never publishes.

## Image extraction and AI safety

The default `VISION_MODEL` is `@cf/meta/llama-3.2-11b-vision-instruct`, which Cloudflare currently documents as vision-capable and compatible with JSON Mode. It is configurable so a current compatible model can replace it without code changes.

The system prompt requires visible-only extraction, original spelling, null uncertainty, exact `WHOLE`/`PORTION` preservation, no district-to-barangay conversion, no inferred restoration, and structured JSON only. The parser rejects unknown fields and prevents AI-created identity fields by allowing only `source_label` on areas and feeders.

Cloudflare notes that JSON Mode does not guarantee schema compliance. GridWatch therefore parses and validates the response again before normalization. AI output has no path to `events` other than deterministic normalization, validation, and the publication gate.

## Trust rules enforced

- `GRID_NOTICE` maps only to `GRID_RISK`, never `CONFIRMED`.
- A feeder association without an explicit event target returns resident status `UNKNOWN` and `FEEDER_ASSOCIATION_ONLY` context.
- `PORTION`, `WHOLE`, and `UNKNOWN` remain distinct.
- An elapsed schedule is filtered out; it does not become `RESTORED`.
- Only an explicit restoration document maps to `RESTORED`.
- Unknown barangays/feeders, uncertain coverage, missing source provenance, and unresolved dates/times fail closed.
- `DRAFT`, `REVIEW_REQUIRED`, and `REJECTED` candidates are excluded from all public event queries.

## Public API contract

- `GET /api/health`: API/binding state, source checks, review/failure counts, budgets, and latest validated evidence.
- `GET /api/status?barangay_psgc=...`: explicit evidence for one PSA barangay, feeder context only, or `UNKNOWN` with `NO_MATCHING_VALIDATED_EVENT`.
- `GET /api/outages`: published, validated events only.
- `GET /api/outages/:id`: one published, validated event plus explicit targets/feeders.
- `GET /api/feeders`: canonical feeder directory and source provenance.
- `GET /api/feeders/:id`: one canonical feeder record.

No endpoint claims power is available. A missing event means only that GridWatch has no matching validated event.

## Resident and ops behavior

`src/gridwatch-api.js` reads `data/runtime-config.js`, validates response shape/provenance, rejects stale or future-dated responses, and times out safely. The resident page tries the configured API for the selected barangay, but continues with bundled validated data and labels the live service unavailable when the API fails. Only explicit barangay evidence can replace the current readout.

`ops.html` is read-only. It shows live/degraded/not-connected state, binding health, last source checks, review pressure, failures, budgets, and latest source/event without exposing secrets or adding admin controls.

CORS echoes only the configured `ALLOWED_ORIGIN` (plus explicit localhost origins outside production). It never emits `Access-Control-Allow-Origin: *`.

## Zero-cost safeguards

Current official free allowances checked on 2026-09-10:

| Service | Current documented free allowance | GridWatch default soft limit |
|---|---:|---:|
| Workers | 100,000 requests/day; 10 ms CPU per HTTP/Cron invocation; 5 Cron Triggers | Platform-enforced; one 30-minute cron |
| D1 | 5 million rows read/day, 100,000 rows written/day, 5 GB/account, 500 MB/database | Indexed access and bounded health queries |
| R2 Standard | 10 GB-month, 1 million Class A and 10 million Class B operations/month | Archive only changed source material |
| Queues | 10,000 operations/day; typical message lifecycle is write/read/delete | 7,000 estimated operations/day |
| Workers AI | 10,000 Neurons/day | 8,000 internal estimated units/day; 500 reserved per call |
| Browser Rendering | 10 minutes/day, 3 concurrent browsers | 480 seconds/day; no automatic MORE cron |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), and [Browser Rendering pricing announcement](https://developers.cloudflare.com/changelog/post/2025-07-28-br-pricing/).

These values are documentation, not runtime truth. Environment variables control the guards. Reaching a guard records `BUDGET_LIMIT_REACHED`, stops the expensive operation, leaves the last validated dataset available, and makes health `DEGRADED`. GridWatch never upgrades a plan or enables paid usage.

## Local development

```bash
npm ci
npm run cf:migrate:local
npm run cf:test
npm run cf:dev
```

Then request `http://localhost:8787/api/health`. Workers AI is deliberately not required for local tests. Manual image review uses a mock or human-reviewed extraction:

```bash
npm run ingest:image -- cloudflare/fixtures/more-scheduled-advisory.svg --extraction cloudflare/fixtures/more-scheduled-image-extraction.json --source-url https://morepower.com.ph/power-advisories/ --published-at 2026-09-10T08:00:00+08:00
```

The tool reports source text, resolved barangays/feeders, coverage, unresolved labels, and validation status, then writes an ignored local review artifact with `published: false`.
