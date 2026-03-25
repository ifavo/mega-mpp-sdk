# Demo

The repository now ships two demo runtimes around the same React + Vite client:

- local Node demo: `demo/app` + `demo/server`
- Cloudflare demo: `demo/app` + `demo/worker`

The local Express server remains the primary rapid-iteration path. The Worker demo is the Cloudflare compatibility and deployment example.

## Install

```bash
pnpm demo:install
```

## Architecture

- `demo/app` builds the SPA that both runtimes serve.
- `demo/server` is the local Express adapter.
- `demo/worker` is the Cloudflare adapter.
- The Worker stores replay-sensitive challenge state in a Durable Object, not KV.

## Testnet Quickstart

The manual Carrot flow uses two wallets:

- a server wallet with testnet ETH so it can sponsor gas for `permit2` mode
- a client wallet with testnet ETH plus testnet USDC so it can approve Permit2 and pay

> [!IMPORTANT]
> On MegaETH testnet, use testnet USDC at `0x75139a9559c9cd1ad69b7e239c216151d2c81e6f` for the demo flow. The SDK still ships USDm as the default example token in code, so you should override `MEGAETH_TOKEN_ADDRESS` explicitly on testnet.

Export the server environment in the first terminal:

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

Open `http://localhost:5173`, connect the client wallet, review the cost shown in the `Request Paid Resource` panel, select `Server broadcasts Permit2 transaction`, and run the `Direct MegaETH charge demo` endpoint.

## Cloudflare Worker Quickstart

The Worker demo serves the built frontend and the API from one Worker origin. Build the SPA first, then start Wrangler:

```bash
pnpm demo:worker:build
pnpm demo:worker:dev
```

The Worker defaults to MegaETH testnet, Carrot RPC, realtime submission mode, and testnet USDC through [wrangler.jsonc](/Users/m/workspace/mega-mpp-sdk/demo/worker/wrangler.jsonc). It still starts without secrets so config and health can describe missing setup before the paid endpoints are usable.

Set the required Worker secrets before running a funded flow:

```bash
cd demo/worker
pnpm wrangler secret put MPP_SECRET_KEY
pnpm wrangler secret put MEGAETH_SETTLEMENT_PRIVATE_KEY
```

Optional Worker secrets or vars:

- `MEGAETH_RECIPIENT_ADDRESS`
- `MEGAETH_SPLIT_RECIPIENT`
- `MEGAETH_SPLIT_AMOUNT`
- `MEGAETH_FEE_PAYER`
- `MEGAETH_PERMIT2_ADDRESS`
- `MEGAETH_SUBMISSION_MODE`
- `MEGAETH_TOKEN_SYMBOL`
- `MEGAETH_TOKEN_DECIMALS`

Mode-specific prerequisites stay the same in the Worker runtime:

- `permit2`: `MPP_SECRET_KEY` and `MEGAETH_SETTLEMENT_PRIVATE_KEY`
- `hash`: `MPP_SECRET_KEY` and either `MEGAETH_RECIPIENT_ADDRESS` or `MEGAETH_SETTLEMENT_PRIVATE_KEY`

Deploy manually with Wrangler after the app build is up to date:

```bash
pnpm demo:worker:deploy
```

The Worker demo is deployable, but v1 does not add auth, rate limiting, or public abuse protection.

## One-Time Client Approval

Approve Permit2 once from the client wallet before the first funded run:

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

## Local-Only Startup

The demo boots without live credentials so you can inspect the UI and readiness payloads. In that state:

- `/api/v1/health` reports `configuration-required` or `partial-configuration`
- `/api/v1/config` publishes separate blockers for `permit2` and transaction-hash credential flows
- paid endpoints return instructive `503` responses until their selected mode is configured

The same partial-configuration behavior applies to the Worker demo. The difference is that the Worker stores replay markers in a Durable Object once real payment flows are enabled.

## Live/Testnet Environment

The demo server reads these variables when you want to connect to a real MegaETH environment:

- `MPP_SECRET_KEY`
- `MEGAETH_RPC_URL`
- `MEGAETH_TOKEN_ADDRESS`
- `MEGAETH_TOKEN_SYMBOL`
- `MEGAETH_TOKEN_DECIMALS`
- `MEGAETH_PERMIT2_ADDRESS`
- `MEGAETH_SUBMISSION_MODE`
- `MEGAETH_SETTLEMENT_PRIVATE_KEY`
- `MEGAETH_RECIPIENT_ADDRESS`
- `MEGAETH_SPLIT_RECIPIENT`
- `MEGAETH_SPLIT_AMOUNT`
- `MEGAETH_FEE_PAYER`
- `MEGAETH_TESTNET`

Mode-specific prerequisites:

- `permit2`: `MPP_SECRET_KEY` and `MEGAETH_SETTLEMENT_PRIVATE_KEY`
- `hash`: `MPP_SECRET_KEY` and either `MEGAETH_RECIPIENT_ADDRESS` or `MEGAETH_SETTLEMENT_PRIVATE_KEY`

If those variables are missing, the demo still starts and exposes health and config payloads that explain exactly what to configure before the selected mode can settle.

`MEGAETH_SUBMISSION_MODE` reuses the SDK's existing `submissionMode` setting. The demo defaults it to `realtime` so both the server-broadcast flow and the client-broadcast flow can showcase MegaETH's mini-block receipt path when the signer supports raw transaction signing.

`MEGAETH_TOKEN_SYMBOL` and `MEGAETH_TOKEN_DECIMALS` are optional. The demo auto-detects the built-in USDm example token and the documented Carrot testnet USDC address, and these overrides are only needed when you point the demo at a different token and want the UI cost display to stay accurate.

## Permit2 Walkthrough

Before using the live demo against a funded payer wallet:

1. Connect an EIP-1193 wallet on the same MegaETH network the server is configured for.
2. Fund that wallet with ETH for gas and the configured payment token.
3. On Carrot testnet, use testnet USDC instead of USDm by setting `MEGAETH_TOKEN_ADDRESS=0x75139a9559c9cd1ad69b7e239c216151d2c81e6f`.
4. Approve Permit2 once for the token amount you plan to test.
5. Use `permit2` mode for server-broadcast flow or `hash` mode for client-broadcast transaction-hash credentials.

The split endpoint also requires `MEGAETH_SPLIT_RECIPIENT`. Without it, the split route still appears in config, but health warns that the server cannot fan out the extra transfer leg yet.

## Manual Verification Checklist

1. Fund the server wallet with testnet ETH and fund the client wallet with testnet ETH plus testnet USDC.
2. Approve Permit2 once for testnet USDC from the client wallet.
3. Start `pnpm demo:server` and `pnpm demo:app` after exporting the Carrot environment above.
4. Confirm `/api/v1/health` reports both modes as `ready`.
5. Connect the client wallet in the browser, choose `Server broadcasts Permit2 transaction`, and run the basic endpoint.
6. Confirm the UI shows `challenge`, `signing`, `signed`, `paying`, `confirming`, and `paid`, then inspect the `Payment-Receipt` header shown in the progress panel.
7. Confirm the server wallet spent ETH for gas and received the paid USDC amount.
