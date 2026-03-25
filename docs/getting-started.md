# Getting Started

## Prerequisites

- Node.js 20+
- pnpm 10+
- Anvil for local deterministic integration runs
- A MegaETH-compatible RPC when you want to exercise the live flow

## Install Dependencies

```bash
pnpm --dir typescript install
```

## Core Commands

```bash
just ts-typecheck
just ts-test
just ts-test-integration
just ts-audit
just ts-build
just release-prep
```

## Demo Quickstart

For the MegaETH testnet demo, use two wallets:

- a server wallet with testnet ETH so it can sponsor gas for `permit2` mode
- a client wallet with testnet ETH plus testnet USDC so it can approve Permit2 and pay

> [!IMPORTANT]
> The testnet demo flow uses testnet USDC at `0x75139a9559c9cd1ad69b7e239c216151d2c81e6f`, not the default USDm example token. Set `MEGAETH_TOKEN_ADDRESS` explicitly when you run against Carrot.

Export the server environment in one terminal:

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

Before the first funded run, approve Permit2 once from the client wallet:

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

After both processes are running, open `http://localhost:5173`, connect the client wallet, confirm the displayed cost in the `Request Paid Resource` panel, select `Server broadcasts Permit2 transaction`, and run the `Direct MegaETH charge demo` endpoint.

## Local Deterministic Flow

The repository ships an Anvil-backed integration suite with a mock ERC-20 and mock Permit2 contract. That suite covers:

- direct Permit2 settlement
- client-broadcast transaction-hash credential settlement
- split payments
- challenge replay protection
- RFC 9457 problem-details mapping with instructive failure messages

Run it with:

```bash
pnpm --dir typescript test:integration
```

## One-Time Permit2 Approval

Funded flows need a payer wallet with both token balance and Permit2 approval. Complete this once per token and payer wallet:

1. Bridge or mint the payment token into the payer wallet.
2. Fund the payer wallet with ETH for MegaETH gas when you plan to use `credentialMode: 'hash'`.
3. Approve Permit2 at `0x000000000022D473030F116dDEE9F6B43aC78BA3` for at least the amount you will test.
4. Re-run the paid flow after the approval transaction confirms.

If a funded flow still fails after approval, increase the approval amount or token balance before retrying.

## Live Smoke Flow

The live smoke project is opt-in. Set `RUN_MEGAETH_LIVE=true` and choose one of these configurations before calling:

```bash
pnpm --dir typescript test:live
```

### Readonly Live Checks

Readonly checks verify RPC reachability, deployed bytecode at Permit2 and token addresses, token read calls, and the configured submission mode.

Required environment variables:

- `RUN_MEGAETH_LIVE=true`
- `MEGAETH_RPC_URL`

Optional environment variables:

- `MEGAETH_TESTNET=true|false`
- `MEGAETH_PERMIT2_ADDRESS`
- `MEGAETH_TOKEN_ADDRESS`
- `MEGAETH_SUBMISSION_MODE=auto|sync|realtime|sendAndWait`

### Funded Live Checks

Funded checks perform one live transaction-hash credential payment end to end, then verify the recipient token balance increased by the requested amount.

Additional required environment variables:

- `MEGAETH_LIVE_PAYER_PRIVATE_KEY`
- `MEGAETH_LIVE_RECIPIENT`

Optional environment variables:

- `MEGAETH_LIVE_AMOUNT`

Before running funded live checks, make sure the payer wallet has:

- MegaETH gas funds
- the configured payment token balance
- a Permit2 approval that covers `MEGAETH_LIVE_AMOUNT`

## Draft-Spec Behavior

- Direct settlement signs the challenge `recipient` as the spender because PR 205 does not yet expose a separate spender field.
- Split payments use a batch Permit2 extension in the SDK implementation when more than one transfer leg is needed.
- The SDK requires each charge flow to resolve `chainId` explicitly from either `methodDetails.chainId` or `methodDetails.testnet`.
- `submissionMode` defaults to `auto`, and auto mode only downgrades when the active RPC or wallet reports that the current submission method is unsupported.
- Receipt serialization stays aligned with `mppx`. `challengeId` remains part of verification context and problem details, but not the serialized `Payment-Receipt` header.
