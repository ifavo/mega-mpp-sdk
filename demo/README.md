# MPP Playground

The demo workspace packages two runtimes around the same React + Vite client:

- `demo/server`: local Express runtime for fast iteration
- `demo/worker`: Cloudflare Worker runtime for deployment-compatible behavior

For the payment flow explanation and the request/response sequence diagrams, start with [../docs/getting-started.md](../docs/getting-started.md).

## Install

```bash
pnpm demo:install
```

## Local Runtime

For the smallest local Carrot testnet setup, export:

```bash
export MEGAETH_CHAIN_ID=6343
export MEGAETH_RPC_URL=https://carrot.megaeth.com/rpc
export MEGAETH_PAYMENT_TOKEN_ADDRESS=0x75139a9559c9cd1ad69b7e239c216151d2c81e6f
export MEGAETH_RECIPIENT_ADDRESS=0xYOUR_SETTLEMENT_WALLET_ADDRESS
export MEGAETH_SESSION_ESCROW_ADDRESS=0xD83A68408539868e5f48D0E93537f56afBB9d512
```

Then run:

```bash
pnpm demo:server
pnpm demo:app
```

That starts the demo with the testnet payment token, explicit payee, and
session escrow wired in. The local server keeps replay-sensitive charge and
session state in `.mega-mpp-demo-store.json` under the current working
directory so restarts do not clear accepted challenge markers. Funded flows
still need:

```bash
export PORT=3001
export DEMO_PUBLIC_ORIGIN=http://localhost:3001
export MPP_SECRET_KEY="$(openssl rand -hex 32)"
export MEGAETH_PERMIT2_ADDRESS=0x000000000022D473030F116dDEE9F6B43aC78BA3
export MEGAETH_SUBMISSION_MODE=realtime
export MEGAETH_SETTLEMENT_PRIVATE_KEY='YOUR_SERVER_PRIVATE_KEY'
export MEGAETH_FEE_PAYER=true
```

For the demo's server-broadcast Permit2 flow and session flow, keep
`MEGAETH_RECIPIENT_ADDRESS` equal to the settlement wallet address.

## Cloudflare Worker

Build the frontend, then run the Worker locally:

```bash
pnpm demo:worker:build
pnpm demo:worker:dev
```

The Worker keeps replay-sensitive charge and session state in a Durable Object. It defaults to MegaETH testnet and testnet USDC through [worker/wrangler.jsonc](worker/wrangler.jsonc), but it still starts without secrets so `/api/v1/health` and `/api/v1/config` can explain what you need to configure before funded routes can succeed.

## Routes

- `GET /api/v1/health`
- `GET /api/v1/config`
- `GET /api/v1/charge/basic`
- `GET /api/v1/charge/splits`
- `GET /api/v1/session/basic`
- `HEAD /api/v1/session/basic`
- `GET /api/v1/session/state`
