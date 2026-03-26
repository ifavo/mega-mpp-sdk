# MPP Playground

This guide is about the demo runtimes, not the payment concepts themselves.

If you need the payment flow explanation first, read [getting-started.md](getting-started.md).

## Architecture

The playground ships two runtimes around the same React + Vite client:

- `demo/server`: local Express server for fast local development
- `demo/worker`: full-stack Cloudflare Worker that serves static assets and the demo API from one origin

Both runtimes expose the same API routes and the same browser UI. The Worker keeps replay-sensitive charge and session state in a Durable Object.

## Local Node Runtime

Install the demo workspaces:

```bash
pnpm demo:install
```

### Minimal Testnet Startup

If you want the demo to boot against the Carrot testnet with the payment token
and session escrow already configured, the smallest useful setup is:

```bash
export MEGAETH_CHAIN_ID=6343
export MEGAETH_RPC_URL=https://carrot.megaeth.com/rpc
export MEGAETH_PAYMENT_TOKEN_ADDRESS=0x75139a9559c9cd1ad69b7e239c216151d2c81e6f
export MEGAETH_RECIPIENT_ADDRESS=0xYOUR_SETTLEMENT_WALLET_ADDRESS
export MEGAETH_SESSION_ESCROW_ADDRESS=0xD83A68408539868e5f48D0E93537f56afBB9d512
```

Then start the two local processes:

```bash
pnpm demo:server
pnpm demo:app
```

That setup is enough to inspect the UI and prewire the demo to the current
testnet payment token, payee, and escrow contract. Funded charge and session
requests still need `MPP_SECRET_KEY` and `MEGAETH_SETTLEMENT_PRIVATE_KEY`.

### Funded Testnet Startup

Add the funded-flow settings in the same terminal when you want live charge and
session requests to succeed:

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

The UI runs at `http://localhost:5173`.

## Runtime-Specific Notes

### Charge

- `MEGAETH_SUBMISSION_MODE` feeds directly into the SDK `submissionMode` and must be `sync`, `realtime`, or `sendAndWait`.
- `mode=permit2` uses the server-broadcast charge runtime.
- `mode=hash` uses the client-broadcast verification runtime.
- Split payments are driven per request through `methodDetails.splits`.

### Session

- The demo session runtime inherits the explicit create-level account, chain, currency, and recipient values you configured.
- You still need `MEGAETH_SESSION_ESCROW_ADDRESS`.
- The browser route reuses the same endpoint for open, voucher, top-up, and close actions.

## Cloudflare Worker Runtime

Build the frontend once, then run the Worker locally:

```bash
pnpm demo:worker:build
pnpm demo:worker:dev
```

The Worker defaults to:

- `MEGAETH_CHAIN_ID=6343`
- Carrot RPC
- `MEGAETH_SUBMISSION_MODE=realtime`
- testnet USDC

Those defaults live in [demo/worker/wrangler.jsonc](../demo/worker/wrangler.jsonc).

Required Worker secrets for funded flows:

```bash
cd demo/worker
pnpm wrangler secret put MPP_SECRET_KEY
pnpm wrangler secret put MEGAETH_SETTLEMENT_PRIVATE_KEY
```

Optional Worker vars or secrets:

- `MEGAETH_RECIPIENT_ADDRESS`
- `MEGAETH_SESSION_ESCROW_ADDRESS`
- `MEGAETH_SESSION_ALLOW_DELEGATED_SIGNER`
- `MEGAETH_SESSION_MIN_VOUCHER_DELTA`
- `MEGAETH_SESSION_SETTLE_INTERVAL_SECONDS`
- `MEGAETH_SESSION_SETTLE_MIN_UNSETTLED_AMOUNT`
- `MEGAETH_SESSION_SUGGESTED_DEPOSIT`
- `MEGAETH_SPLIT_RECIPIENT`
- `MEGAETH_SPLIT_AMOUNT`
- `MEGAETH_FEE_PAYER`
- `MEGAETH_PERMIT2_ADDRESS`
- `MEGAETH_SUBMISSION_MODE`
- `MEGAETH_PAYMENT_TOKEN_SYMBOL`
- `MEGAETH_PAYMENT_TOKEN_DECIMALS`

## Local-Only Startup

Both runtimes boot without live credentials so you can inspect the UI and
readiness payloads. The minimal testnet startup above is enough for that mode.
In that state:

- `/api/v1/health` reports `configuration-required` or `partial-configuration`
- `/api/v1/config` publishes separate blockers for charge modes and session setup
- funded endpoints return instructive `503` responses until their required environment is configured

## Routes

- `GET /api/v1/health`
- `GET /api/v1/config`
- `GET /api/v1/charge/basic`
- `GET /api/v1/charge/splits`
- `GET /api/v1/session/basic`
- `HEAD /api/v1/session/basic`
- `GET /api/v1/session/state`

## Manual Verification Checklist

1. Fund the server wallet with testnet ETH and the client wallet with testnet ETH plus testnet USDC.
2. Approve Permit2 once for charge and approve the escrow contract once for session.
3. Start `pnpm demo:server` and `pnpm demo:app` after exporting the funded Carrot environment above.
4. Confirm `/api/v1/health` reports charge readiness and session blockers or readiness accurately.
5. Connect the client wallet in the browser and run the charge endpoint once.
6. Switch to `Session` and run the session endpoint once to auto-open the channel.
7. Verify the UI updates channel deposit, accepted value, settled value, unsettled value, and signer mode.
8. Use `Top Up` and `Close` to confirm the same route handles session management actions.
