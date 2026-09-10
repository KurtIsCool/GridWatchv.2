# GridWatch — Iloilo City

GridWatch is a resident-facing power interruption and feeder-context prototype for Iloilo City, Philippines.

## Resident flow

- **NOW** — select a PSA-recognized Iloilo City barangay and see the current answer, evidence, and published MORE Power feeder relationships.
- **NEXT** — scheduled interruption view.
- **CITY GRID** — grid context and feeder coverage directory.
- **`/ops.html`** — read-only Cloudflare ingestion, source, review, and budget health; it remains useful in a clear `NOT CONNECTED` state without an API.

## Data rules

- Place identity is PSA PSGC: City of Iloilo `0631000000`, exactly 180 barangays.
- Feeder relationships are many-to-many.
- `WHOLE` and `PORTION` feeder coverage remain distinct.
- A feeder-wide advisory does **not** automatically confirm every associated barangay as interrupted.
- Outside-Iloilo City feeder records remain context only.
- Unresolved feeder/barangay aliases fail closed.
- Unvalidated map geography fails closed rather than falling back to invented shapes.

## Deploy

This repository is GitHub Pages ready. See [`DEPLOYMENT.md`](./DEPLOYMENT.md).

```bash
npm test
```

## Cloudflare ingestion foundation

The optional Worker backend lives in `cloudflare/`. It adds D1, private R2 evidence storage, Queue processing, Workers AI extraction, a 30-minute NGCP cron adapter, a replaceable operator-triggered MORE Power adapter, public read-only APIs, and a local manual-image review workflow. The static resident app remains fully functional when none of those bindings exist.

```bash
npm run cf:migrate:local
npm run cf:test
npm run cf:dev
```

In another terminal, serve the static app on the allowed local origin:

```bash
python -m http.server 8080
```

See `docs/cloudflare-architecture.md` and `docs/cloudflare-setup.md`. No deployment or Cloudflare account resource is created by these commands.

Push to `main`, enable **Settings → Pages → Source: GitHub Actions**, and the included workflow publishes the static site.

## Current release status

**v2.8.3 deployment package**

PSA barangay identity and the MORE Power feeder dataset are available in the resident app. Local polygon geography is intentionally `PENDING_BUILD`, so the map remains disabled until the exact 180-feature geography and independent city boundary pass `npm run test:geography`.

## Important files

- `index.html` — resident app
- `data/feeder-mapping.json` — structured MORE Power feeder coverage
- `data/psa-iloilo-city-barangays.json` — frozen 180-barangay identity registry used by this build
- `data/geography-manifest.json` — geography validation state
- `manifest.webmanifest`, `sw.js` — PWA/offline shell
- `.github/workflows/pages.yml` — GitHub Pages deployment
- `tests/` — repository and strict geography integrity checks
