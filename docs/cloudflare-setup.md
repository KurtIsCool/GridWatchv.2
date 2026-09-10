# Cloudflare setup for GridWatch

These are human-run steps for a later integration. Nothing in the current implementation creates remote resources or deploys the Worker.

## 1. Prepare a free account

1. Sign in to a Cloudflare account that will remain on the Workers Free plan.
2. In Billing, confirm that Workers is not on a paid plan and that no automatic paid upgrade is enabled.
3. Install the locked project dependencies with `npm ci`.
4. Authenticate Wrangler interactively:

   ```bash
   npx wrangler login
   ```

Do not commit browser sessions, API tokens, account IDs, private keys, or `.dev.vars`.

## 2. Create remote resources

Run these only when you are ready to create the free-tier resources:

```bash
npx wrangler d1 create gridwatch-db
npx wrangler r2 bucket create gridwatch-raw-sources
npx wrangler queues create gridwatch-ingestion
npx wrangler queues create gridwatch-ingestion-dlq
```

Copy the D1 `database_id` returned by Cloudflare into the `DB` entry in `cloudflare/wrangler.jsonc`. The committed all-zero ID is a local placeholder. Confirm the R2 and Queue names match the configuration.

Workers AI uses the `AI` binding and does not require a separate database-like resource. Confirm Workers AI is available on the account. Before first use of the default Meta vision model, review and accept the model license using Cloudflare's documented first-request flow: [Llama 3.2 vision tutorial](https://developers.cloudflare.com/workers-ai/guides/tutorials/llama-vision-tutorial/).

Browser Rendering uses the `BROWSER` binding. Confirm the free plan includes Browser Rendering, review its current usage page, and do not enable an automated MORE Power run until an accessible source URL and compliant selector have been reviewed. GridWatch never requires Facebook credentials and must not bypass login, CAPTCHA, or bot protection.

## 3. Configure variables

Set non-secret production variables in `cloudflare/wrangler.jsonc` or the Worker dashboard:

- `GRIDWATCH_ENV=production`
- `ALLOWED_ORIGIN=https://YOUR-STATIC-GRIDWATCH-ORIGIN`
- `PUBLIC_API_BASE=https://YOUR-WORKER-OR-CUSTOM-DOMAIN`
- `NGCP_SOURCE_URL`: a verified official NGCP endpoint selected by a human.
- `MORE_SOURCE_URL`: an approved official public URL, if a browser adapter is later connected.
- `VISION_MODEL`: a current Cloudflare vision model that supports the required structured output.
- `BROWSER_DAILY_SOFT_LIMIT`
- `AI_DAILY_SOFT_LIMIT`
- `AI_ESTIMATED_UNITS_PER_CALL`
- `QUEUE_DAILY_SOFT_LIMIT`

Keep the conservative defaults until real measured usage justifies a lower or still-free adjustment. Never set a limit above a current free allowance without rechecking official pricing and limits.

No production secret is currently required for the public read-only API. `OPERATOR_DEV_TOKEN` is only for any future development-only operator endpoint and should not be added unless such an endpoint is implemented. If added later, store it with `npx wrangler secret put OPERATOR_DEV_TOKEN`; never put its value in a file.

## 4. Validate locally

```bash
npm run build:cf-data
npm run cf:migrate:local
npm run cf:test
npm run cf:dev
```

`cf:dev` uses `cloudflare/wrangler.local.jsonc`, which omits remote-only AI/Browser bindings and requires no Cloudflare login. The full `cloudflare/wrangler.jsonc` remains the future production binding source of truth.

In another terminal:

```bash
curl http://localhost:8787/api/health
curl "http://localhost:8787/api/status?barangay_psgc=0631000025"
curl http://localhost:8787/api/feeders
```

Serve the static app separately:

```bash
python -m http.server 8080
```

Open `http://localhost:8080/` and `http://localhost:8080/ops.html`. With the checked-in blank API configuration, both pages must remain usable and show the live service as not connected.

To test the pages against the local Worker, regenerate runtime configuration and keep it out of a release commit unless intended:

```powershell
$env:GRIDWATCH_API_BASE_URL="http://localhost:8787"
npm run build:config
```

## 5. Apply the remote D1 migration later

Review `cloudflare/migrations/0001_initial.sql`, verify the selected account/database, then run only with explicit approval:

```bash
npx wrangler d1 migrations apply gridwatch-db --remote --config cloudflare/wrangler.jsonc
```

The local migration command never touches remote D1.

## 6. First deployment later

Before deploying:

1. Recheck all current Cloudflare free-tier limits.
2. Confirm the account is on Workers Free.
3. Confirm binding IDs/names and `ALLOWED_ORIGIN`.
4. Confirm `NGCP_SOURCE_URL` is official and stable.
5. Confirm MORE browser automation remains disabled unless explicitly approved.
6. Run `npm test` and a Wrangler dry run.
7. Review the Worker preview and API evidence responses.

Only after explicit approval:

```bash
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

Cron configuration deploys with the Worker. Verify the 30-minute NGCP trigger in the dashboard. There is deliberately no MORE Power browser cron.

## 7. Connect the static resident app later

Generate the static runtime API URL:

```powershell
$env:GRIDWATCH_API_BASE_URL="https://YOUR-WORKER-OR-CUSTOM-DOMAIN"
npm run build:config
```

Run `npm test`, publish the static site through its existing GitHub Pages workflow, and verify that API failure still leaves the bundled dataset, 180 PSA barangays, feeder context, NOW/NEXT/CITY GRID, and offline shell working.

## External work still required

- Cloudflare account confirmation on the Free plan.
- D1 database and real binding ID.
- Standard R2 bucket.
- Ingestion Queue and dead-letter Queue.
- Workers AI availability and default model license acceptance.
- Browser Rendering availability if the MORE adapter is connected.
- Human selection of an official NGCP source URL.
- Human review/approval of any MORE Power public-source browser selector.
- Production Worker URL or custom domain.
- Exact static-site origin for restrictive CORS.
- Remote D1 migration and first deployment, both intentionally not performed.
