# Demo

The demo is a React + Vite client paired with a lightweight Express server.

## Install

```bash
pnpm demo:install
```

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
export MEGAETH_SETTLEMENT_PRIVATE_KEY='YOUR_SERVER_PRIVATE_KEY'
export MEGAETH_FEE_PAYER=true
```

Then startup is two commands:

```bash
pnpm demo:server
pnpm demo:app
```

Open `http://localhost:5173`, connect the client wallet, review the cost shown in the `Run Payment` panel, select `Server settles Permit2`, and run the `Direct MegaETH charge demo` endpoint.

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
- `/api/v1/config` publishes separate blockers for `permit2` and `hash`
- paid endpoints return instructive `503` responses until their selected mode is configured

## Live/Testnet Environment

The demo server reads these variables when you want to connect to a real MegaETH environment:

- `MPP_SECRET_KEY`
- `MEGAETH_RPC_URL`
- `MEGAETH_TOKEN_ADDRESS`
- `MEGAETH_TOKEN_SYMBOL`
- `MEGAETH_TOKEN_DECIMALS`
- `MEGAETH_PERMIT2_ADDRESS`
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

`MEGAETH_TOKEN_SYMBOL` and `MEGAETH_TOKEN_DECIMALS` are optional. The demo auto-detects the built-in USDm example token and the documented Carrot testnet USDC address, and these overrides are only needed when you point the demo at a different token and want the UI cost display to stay accurate.

## Permit2 Walkthrough

Before using the live demo against a funded payer wallet:

1. Connect an EIP-1193 wallet on the same MegaETH network the server is configured for.
2. Fund that wallet with ETH for gas and the configured payment token.
3. On Carrot testnet, use testnet USDC instead of USDm by setting `MEGAETH_TOKEN_ADDRESS=0x75139a9559c9cd1ad69b7e239c216151d2c81e6f`.
4. Approve Permit2 once for the token amount you plan to test.
5. Use `permit2` mode for server-settled flow or `hash` mode for client-broadcast flow.

The split endpoint also requires `MEGAETH_SPLIT_RECIPIENT`. Without it, the split route still appears in config, but health warns that the server cannot fan out the extra transfer leg yet.

## Manual Verification Checklist

1. Fund the server wallet with testnet ETH and fund the client wallet with testnet ETH plus testnet USDC.
2. Approve Permit2 once for testnet USDC from the client wallet.
3. Start `pnpm demo:server` and `pnpm demo:app` after exporting the Carrot environment above.
4. Confirm `/api/v1/health` reports both modes as `ready`.
5. Connect the client wallet in the browser, choose `Server settles Permit2`, and run the basic endpoint.
6. Confirm the UI shows `challenge`, `signing`, `signed`, `paying`, `confirming`, and `paid`, then inspect the `Payment-Receipt` header shown in the progress panel.
7. Confirm the server wallet spent ETH for gas and received the paid USDC amount.
