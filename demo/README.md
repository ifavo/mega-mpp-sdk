# MegaETH Demo

The demo ships two runtimes around the same React + Vite client:

- `demo/server`: local Express server for fast local development
- `demo/worker`: full-stack Cloudflare Worker that serves static assets and the demo API from one origin

## Install

```bash
pnpm demo:install
```

## Run

```bash
pnpm build
pnpm demo:server
pnpm demo:app
```

## Cloudflare Worker

Build the frontend once, then run the Worker locally:

```bash
pnpm demo:worker:build
pnpm demo:worker:dev
```

The Worker keeps replay-sensitive payment state in a Durable Object. It defaults to MegaETH testnet and testnet USDC, but it still starts without secrets so `/api/v1/health` and `/api/v1/config` can explain what you need to configure before the paid routes can succeed.

Both demo runtimes accept `MEGAETH_SUBMISSION_MODE=auto|sync|realtime|sendAndWait` and default to `realtime` so the demo showcases MegaETH mini-block receipts by default.

## Routes

- `GET /api/v1/health`
- `GET /api/v1/config`
- `GET /api/v1/charge/basic`
- `GET /api/v1/charge/splits`

The UI consumes those endpoints and uses `mega-mpp-sdk/client` to satisfy any `402 Payment Required` challenge.
