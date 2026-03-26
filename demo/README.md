# MPP Playground

The playground ships two runtimes around the same React + Vite client:

- `demo/server`: local Express server for fast local development
- `demo/worker`: full-stack Cloudflare Worker that serves static assets and the demo API from one origin

## Install

```bash
pnpm demo:install
```

## Run

Once the environment is exported, local startup is two commands:

```bash
pnpm demo:server
pnpm demo:app
```

On MegaETH testnet, use testnet USDC `0x75139a9559c9cd1ad69b7e239c216151d2c81e6f` instead of the default USDm example token.

## Cloudflare Worker

Build the frontend once, then run the Worker locally:

```bash
pnpm demo:worker:build
pnpm demo:worker:dev
```

The Worker keeps replay-sensitive charge and session state in a Durable Object. It defaults to MegaETH testnet and testnet USDC, but it still starts without secrets so `/api/v1/health` and `/api/v1/config` can explain what you need to configure before funded routes can succeed.

Both demo runtimes accept `MEGAETH_SUBMISSION_MODE=auto|sync|realtime|sendAndWait` and default to `realtime` so the playground showcases MegaETH mini-block receipts by default.

## Routes

- `GET /api/v1/health`
- `GET /api/v1/config`
- `GET /api/v1/charge/basic`
- `GET /api/v1/charge/splits`
- `GET /api/v1/session/basic`
- `HEAD /api/v1/session/basic`
- `GET /api/v1/session/state`

The UI consumes those endpoints and uses `mega-mpp-sdk/client` to satisfy `402 Payment Required` challenges for both charge and session flows.
