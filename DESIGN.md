# GridWatch Design System

## 1. Direction

GridWatch is a civic, technical resident utility. Preserve its black, white, graphite, and electric-blue identity; prioritize area, current answer, evidence, next interruption, then optional detail. It must not drift into a generic SaaS dashboard.

## 2. Color

- Paper: `--paper` (`#f5f6f7` light, `#090a0c` dark)
- Surface: `--surface`, `--surface-2`
- Text: `--ink`, `--muted`
- Borders: `--line`, `--line-soft`
- Action/focus: `--utility`, `--utility-soft`, `--focus`
- Status: `--danger` confirmed, `--warning` scheduled, `--risk` grid risk, `--community` community, `--ok` restored evidence, `--map-normal` unknown

Color never carries status alone: every status also has a text label, evidence description, and map legend entry.

## 3. Typography

- UI: `--font-ui`, system-first sans serif.
- Technical metadata: `--font-mono`.
- Resident body copy is 16px by default; critical explanatory text should not be below 12px.
- Large status text uses the existing responsive `clamp()` scale and compact uppercase treatment.

## 4. Spacing and layout

- Base rhythm: 4px.
- Desktop: answer column of 350–450px beside the map.
- Mobile breakpoint: 900px; compact breakpoint: 520px.
- Full-height surfaces use `100dvh`.
- Depth strategy: borders and tonal shifts; no decorative glass or card shadows.

## 5. Components

### Primary navigation
- Three persistent resident views: NOW, NEXT, CITY GRID.
- Active state uses text plus underline; keyboard focus remains visible.

### Area picker
- Canonical datalist search and explicit Save action.
- Invalid/outside-city values fail closed with a status message.

### Evidence rails
- Official is solid, grid/upstream is dashed, community is dotted.
- Content must refresh in the same render transaction as the selected area.

### Status readout
- Shows canonical barangay, current claim, evidence, PSGC, feeder context, and next action.
- `RESTORED` is reserved for explicit restoration evidence; elapsed schedules use a neutral window-ended state.

### Map
- 2D default; validated city-only geometry; partial coverage uses hatching.
- Missing or inconsistent trusted geography fails closed.

### Buttons and disclosures
- Minimum 44px touch target where practical.
- Every icon-only responsive state keeps an explicit accessible name.
- States: default, hover, focus-visible, active, disabled.

## 6. Motion and interaction

- `--motion: 150ms` for meaningful state feedback.
- Animate only opacity/transform where possible.
- Respect `prefers-reduced-motion`.

## 7. Accessibility and accepted debt

- Semantic controls, skip link, visible focus, live status messages, and keyboard operation are required.
- Current monolithic HTML/CSS/JS architecture is accepted temporarily; data and decision logic must move toward generated modules before broader UI expansion.
