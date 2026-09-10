# Deploy GridWatch with GitHub Pages

GridWatch is a static site, so GitHub Pages is enough for the current resident-facing prototype. No Node server is required at runtime.

## First deployment

1. Create a new GitHub repository, for example `iloilo-gridwatch`.
2. Copy the contents of this folder to the repository root and commit them to `main`.
3. On GitHub, open **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **GitHub Actions**.
5. Push to `main` (or open **Actions** and manually run `Deploy GridWatch to GitHub Pages`).
6. The workflow validates the static package, stages only deployable files, and publishes the Pages artifact.

All app paths are relative (`./...`), so the site works at a repository URL such as `https://USERNAME.github.io/iloilo-gridwatch/` without hard-coding the repository name.

## Local test

Do not open `index.html` only with `file://` when testing deployment behavior. Serve the repo over HTTP:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080/`.

Run the repository checks with:

```bash
npm test
```

## Current map status

The repository deliberately includes fail-closed geography placeholders. PSA identity and MORE Power feeder lookup are deployable, but the map remains disabled until all of these are replaced with a validated build:

- `data/geography-manifest.json` with `status: "VALIDATED"`
- `data/iloilo-city-barangays.geojson` with exactly 180 PSA-matched Polygon/MultiPolygon features
- `data/iloilo-city-boundary.geojson` with exactly one validated city boundary
- `data/geography-bundle.js` containing the same validated local geography for robust/offline fallback

After replacing them, run:

```bash
npm run test:geography
```

Do not change the application to accept `PENDING_BUILD` geography just to enable the map.

## PWA/offline behavior

GitHub Pages serves the app over HTTPS, allowing the included service worker and web app manifest to work. The service worker caches only same-origin GridWatch shell/data files. MapLibre and the NAMRIA basemap remain network enhancements; validated local administrative geography is the trusted map layer.
