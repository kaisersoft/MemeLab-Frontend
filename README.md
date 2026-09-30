# MemeLab Frontend

This repository contains the **canonical MemeLab HTML5 frontend**.

The backend/core lives in the separate `kaisersoft/MemeLab` repository.

## Architecture

```
MemeLab
  Solana Connector
      ↓
  LiveEngine
      ↓
  IntelligenceEngine
      ↓
  /api/snapshot
      ↓
MemeLab-Frontend
  index.html
  styles.css
  app.js
```

The frontend is intentionally not duplicated into the backend repository.

## Local integration test

1. Start the MemeLab backend from the `MemeLab` repository:

```bash
python api_server.py
```

The API is available at:

```
http://127.0.0.1:8765/api/snapshot
```

2. Serve this repository as a static site from the `MemeLab-Frontend` directory:

```bash
python -m http.server 8000
```

3. Open:

```
http://127.0.0.1:8000/
```

The frontend polls the backend snapshot and renders the existing mockup with live Solana/Intelligence data.

The API endpoint can be overridden before loading the page:

```html
<script>window.MEMELAB_API_URL = "http://127.0.0.1:8765/api";</script>
```

## Local and cloud runtime

The frontend loads `runtime-config.js` before the application scripts. Its
`CONFIGURED_MODE` defaults to `local`; keep that value for local development.
For the VPS frontend deployment, set it to `cloud`. The cloud API base is the
same-origin path `/api`; the VPS web server must separately forward that path
to the backend at `127.0.0.1:8765`.

Local:

- Frontend: `http://127.0.0.1:8000`
- Backend: `http://127.0.0.1:8765`
- API base: `http://127.0.0.1:8765/api`

Cloud:

- Frontend: VPS port 80
- Backend: `127.0.0.1:8765` (not publicly exposed)
- Frontend API base: `/api`

Set `MEMELAB_RUNTIME_MODE=cloud` in the backend environment as well. The
backend intentionally remains bound to `127.0.0.1:8765` in both modes. Add the
frontend origin (for example, `http://138.3.254.224`) to the existing
`MEMELAB_ALLOWED_ORIGINS` environment value on the VPS. This keeps the current
Origin check intact; it is not API authentication.

An explicit `window.MEMELAB_API_URL` set before `runtime-config.js` loads
overrides the selected runtime profile.

Risk Engine and Social Intelligence are intentionally not connected in this first integration block.
