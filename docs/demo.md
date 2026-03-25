# MPP Playground

The repository ships two demo runtimes around the same React + Vite client:

- local Node demo: `demo/app` + `demo/server`
- Cloudflare demo: `demo/app` + `demo/worker`

The local Express server remains the primary rapid-iteration path. The Worker demo is the deployment-compatible example.

## Install

```bash
pnpm demo:install
```

## Architecture

- `demo/app` builds the SPA that both runtimes serve
- `demo/server` is the local Express adapter
- `demo/worker` is the Cloudflare adapter
- the Worker stores replay-sensitive challenge and session state in a Durable Object

## Testnet Quickstart

The Carrot walkthrough uses two wallets:

- a server wallet with testnet ETH so it can pay gas for `permit2`, `settle`, and `close`
- a client wallet with testnet ETH plus testnet USDC so it can approve Permit2, approve escrow, and pay

> [!IMPORTANT]
> On MegaETH testnet, use testnet USDC at `0x75139a9559c9cd1ad69b7e239c216151d2c81e6f` for the demo flow. The SDK still ships USDm as the default example token in code, so you should override `MEGAETH_TOKEN_ADDRESS` explicitly on testnet.

Export the shared environment in the first terminal:

```bash
export PORT=3001
export DEMO_PUBLIC_ORIGIN=http://localhost:3001
export MPP_SECRET_KEY="$(openssl rand -hex 32)"
export MEGAETH_TESTNET=true
export MEGAETH_RPC_URL=https://carrot.megaeth.com/rpc
export MEGAETH_TOKEN_ADDRESS=0x75139a9559c9cd1ad69b7e239c216151d2c81e6f
export MEGAETH_PERMIT2_ADDRESS=0x000000000022D473030F116dDEE9F6B43aC78BA3
export MEGAETH_SUBMISSION_MODE=realtime
export MEGAETH_SETTLEMENT_PRIVATE_KEY='YOUR_SERVER_PRIVATE_KEY'
export MEGAETH_FEE_PAYER=true
```

Then startup is two commands:

```bash
pnpm demo:server
pnpm demo:app
```

## Charge Walkthrough

Approve Permit2 once from the client wallet before the first funded charge run:

```bash
export MEGAETH_RPC_URL=https://carrot.megaeth.com/rpc
export MEGAETH_TOKEN_ADDRESS=0x75139a9559c9cd1ad69b7e239c216151d2c81e6f
export MEGAETH_PERMIT2_ADDRESS=0x000000000022D473030F116dDEE9F6B43aC78BA3
export CLIENT_PRIVATE_KEY='YOUR_CLIENT_PRIVATE_KEY'

cast send "$MEGAETH_TOKEN_ADDRESS" \
  "approve(address,uint256)(bool)" \
  "$MEGAETH_PERMIT2_ADDRESS" \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  --private-key "$CLIENT_PRIVATE_KEY" \
  --rpc-url "$MEGAETH_RPC_URL"
```

Open `http://localhost:5173`, connect the client wallet, review the cost shown in the `Run Flow` panel, choose `Charge`, select `Server submits Permit2 transaction`, and run the `Direct charge resource` endpoint.

`MEGAETH_SUBMISSION_MODE` reuses the SDK's `submissionMode` setting. The demo defaults it to `realtime` so both server-broadcast and client-broadcast charge flows can showcase MegaETH mini-block receipts when the signer supports raw transaction signing.

## Session Walkthrough

Deploy or point the demo at a `MegaMppSessionEscrow` contract, then export:

```bash
export MEGAETH_SESSION_ESCROW_ADDRESS='0xYOUR_ESCROW_PROXY'
```

Approve the escrow contract directly from the client wallet:

```bash
export MEGAETH_RPC_URL=https://carrot.megaeth.com/rpc
export MEGAETH_TOKEN_ADDRESS=0x75139a9559c9cd1ad69b7e239c216151d2c81e6f
export MEGAETH_SESSION_ESCROW_ADDRESS='0xYOUR_ESCROW_PROXY'
export CLIENT_PRIVATE_KEY='YOUR_CLIENT_PRIVATE_KEY'

cast send "$MEGAETH_TOKEN_ADDRESS" \
  "approve(address,uint256)(bool)" \
  "$MEGAETH_SESSION_ESCROW_ADDRESS" \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  --private-key "$CLIENT_PRIVATE_KEY" \
  --rpc-url "$MEGAETH_RPC_URL"
```

In the UI:

1. Choose `Session`.
2. Run the `Reusable session resource` endpoint once to auto-open the channel.
3. Inspect the current deposit, accepted cumulative value, settled amount, unsettled amount, signer mode, and status.
4. Use `Top Up` and `Close` to exercise management actions on the same route.

For a pure top-up management action, the demo client now sends `context.action = "topUp"` with `authorizeCurrentRequest: false`.

## Cloudflare Worker Quickstart

The Worker demo serves the built frontend and the API from one Worker origin:

```bash
pnpm demo:worker:build
pnpm demo:worker:dev
```

The Worker defaults to MegaETH testnet, Carrot RPC, realtime submission mode, and testnet USDC through [wrangler.jsonc](/Users/m/workspace/mega-mpp-sdk/demo/worker/wrangler.jsonc). It still starts without secrets so config and health can describe missing setup before funded endpoints are usable.

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
- `MEGAETH_TOKEN_SYMBOL`
- `MEGAETH_TOKEN_DECIMALS`

## Local-Only Startup

The demo boots without live credentials so you can inspect the UI and readiness payloads. In that state:

- `/api/v1/health` reports `configuration-required` or `partial-configuration`
- `/api/v1/config` publishes separate blockers for charge modes and session setup
- funded endpoints return instructive `503` responses until their required environment is configured

The same partial-configuration behavior applies to the Worker demo, with session and replay state stored in a Durable Object once flows are enabled.

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
3. Start `pnpm demo:server` and `pnpm demo:app` after exporting the Carrot environment above.
4. Confirm `/api/v1/health` reports charge readiness and session blockers or readiness accurately.
5. Connect the client wallet in the browser and run the charge endpoint once.
6. Switch to `Session` and run the session endpoint once to auto-open the channel.
7. Verify the UI updates channel deposit, accepted value, settled value, unsettled value, and signer mode.
8. Use `Top Up` and `Close` to confirm the same route handles session management actions.
