# Getting Started

## Prerequisites

- Node.js 20+
- pnpm 10+
- Foundry for contract build and test commands
- Anvil for deterministic integration runs
- a MegaETH-compatible RPC when you want to exercise live flows

## Install Dependencies

```bash
pnpm --dir typescript install
pnpm demo:install
```

## Core Commands

```bash
just contracts-test
just contracts-verify
just ts-typecheck
just ts-test
just ts-test-integration
just demo-test
just ts-audit
just release-prep
```

## Demo Quickstart

Choose one of these demo paths:

- local development: `pnpm demo:server` and `pnpm demo:app`
- Cloudflare compatibility: `pnpm demo:worker:build` and `pnpm demo:worker:dev`

For the MegaETH Carrot demo, use two wallets:

- a server wallet with testnet ETH so it can pay gas for server-settled charge and session actions
- a client wallet with testnet ETH plus testnet USDC so it can approve Permit2 for charge and escrow for session

> [!IMPORTANT]
> The testnet walkthrough uses testnet USDC at `0x75139a9559c9cd1ad69b7e239c216151d2c81e6f`, not the default USDm example token. Set `MEGAETH_TOKEN_ADDRESS` explicitly when you run against Carrot.

Export the shared demo environment in one terminal:

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

### Charge Demo Preparation

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

After both processes are running, open `http://localhost:5173`, connect the client wallet, confirm the displayed cost in the `Run Flow` panel, choose `Charge`, select `Server submits Permit2 transaction`, and run the `Direct charge resource` endpoint.

### Session Demo Preparation

Session flows need one extra piece of infrastructure: a deployed `MegaMppSessionEscrow`.

Deploy one with Foundry:

```bash
cd contracts
export PRIVATE_KEY='0x...'
export SESSION_ESCROW_OWNER='0x...'
export SESSION_ESCROW_CLOSE_DELAY=86400

forge script script/DeployMegaMppSessionEscrow.s.sol:DeployMegaMppSessionEscrowScript \
  --rpc-url "$MEGAETH_RPC_URL" \
  --broadcast
```

Then export the proxy address in the same terminal where you start `pnpm demo:server`:

```bash
export MEGAETH_SESSION_ESCROW_ADDRESS='0xYOUR_ESCROW_PROXY'
```

If you want explorer verification after deployment, export the implementation and proxy addresses plus the verifier URL, then run:

```bash
pnpm contracts:verify
```

Approve the escrow contract once from the client wallet for the token deposit:

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

- choose `Session`
- run the `Reusable session resource` endpoint once to auto-open the channel
- use `Top Up` or `Close` to exercise management actions on the same route

The session client cleanup in `0.2.0` removes `managementOnly`. Pure management top-ups now use `context.action = "topUp"` with `authorizeCurrentRequest: false`.

The demo shows:

- current deposit
- accepted cumulative value
- settled amount
- unsettled amount
- signer mode
- current channel status

## Cloudflare Worker Demo

The Worker demo serves the built SPA and the API from one origin with a Durable Object-backed replay store.

Build and run it locally with:

```bash
pnpm demo:worker:build
pnpm demo:worker:dev
```

Before you exercise funded Worker flows, set these secrets in `demo/worker`:

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
- `MEGAETH_TOKEN_SYMBOL`
- `MEGAETH_TOKEN_DECIMALS`

The demo runtimes reuse the SDK's existing `submissionMode` option through `MEGAETH_SUBMISSION_MODE`. They default to `realtime` so MegaETH mini-block receipts are showcased out of the box.

## Local Deterministic Flow

The repository ships:

- an Anvil-backed charge integration suite with a mock ERC-20 and mock Permit2
- an Anvil-backed session integration suite with a mock ERC-20 and the in-repo upgradeable escrow contract
- Foundry contract tests for the session escrow itself

Run them with:

```bash
pnpm contracts:test
pnpm --dir typescript test:integration
```

## Live Smoke Flow

The live smoke suite is opt-in:

```bash
pnpm --dir typescript test:live
```

Set `RUN_MEGAETH_LIVE=true` and then choose one or both live configurations.

### Readonly Live Checks

Readonly checks verify:

- RPC reachability
- bytecode at Permit2 and token addresses
- token read calls
- submission mode parsing
- optional session escrow deployment and domain separator reads when `MEGAETH_SESSION_ESCROW_ADDRESS` is set

Required environment variables:

- `RUN_MEGAETH_LIVE=true`
- `MEGAETH_RPC_URL`

Optional environment variables:

- `MEGAETH_TESTNET=true|false`
- `MEGAETH_PERMIT2_ADDRESS`
- `MEGAETH_TOKEN_ADDRESS`
- `MEGAETH_SUBMISSION_MODE=auto|sync|realtime|sendAndWait`
- `MEGAETH_SESSION_ESCROW_ADDRESS`

### Funded Charge Live Checks

Additional required environment variables:

- `MEGAETH_LIVE_PAYER_PRIVATE_KEY`
- `MEGAETH_LIVE_RECIPIENT`

Optional environment variables:

- `MEGAETH_LIVE_AMOUNT`

Before running funded charge live checks, make sure the payer wallet has:

- MegaETH gas funds
- the configured payment token balance
- a Permit2 approval that covers `MEGAETH_LIVE_AMOUNT`

### Funded Session Live Checks

Additional required environment variables:

- `MEGAETH_SESSION_ESCROW_ADDRESS`
- `MEGAETH_LIVE_SESSION_PAYER_PRIVATE_KEY`
- `MEGAETH_LIVE_SESSION_SERVER_PRIVATE_KEY`

Optional environment variables:

- `MEGAETH_LIVE_SESSION_AMOUNT`
- `MEGAETH_LIVE_SESSION_DEPOSIT`

Before running funded session live checks, make sure:

- the payer wallet has MegaETH gas funds and token balance
- the payer wallet has approved the escrow contract for at least `MEGAETH_LIVE_SESSION_DEPOSIT`
- the server wallet has MegaETH gas funds for `settle` and `close`

## Draft-Spec Behavior

- Direct charge settlement signs the challenge `recipient` as the spender because PR 205 does not yet expose a separate spender field.
- Split charge payments use a batch Permit2 extension when more than one transfer leg is needed.
- Each charge and session flow resolves `chainId` explicitly from either `methodDetails.chainId` or `methodDetails.testnet`.
- Session receipts stay aligned with `mppx`. `challengeId` remains part of verification context and problem details, but not the serialized `Payment-Receipt` header.
