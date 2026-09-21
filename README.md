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

Risk Engine and Social Intelligence are intentionally not connected in this first integration block.
