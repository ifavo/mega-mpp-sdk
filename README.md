# mega-mpp-sdk

MegaETH payment method SDK for the Machine Payments Protocol.

`mega-mpp-sdk` mirrors the Solana MPP SDK structure for MegaETH and now ships both first-class MegaETH methods:

- `charge` for one-shot Permit2-backed payments
- `session` for reusable escrow-backed voucher channels

> [!IMPORTANT]
> The MegaETH charge spec in PR 205 and the Tempo session method are still evolving as of March 25, 2026. This repository documents the draft-specific assumptions where the SDK has to pin behavior.

## Scope

- Charge flows:
  - direct Permit2 settlement
  - transaction-hash credential mode
  - splits
  - fee sponsorship
  - replay protection
  - RFC 9457-compatible instructive errors
- Session flows:
  - upgradeable in-repo MegaETH escrow contract
  - payer and delegated-signer vouchers
  - cooperative close
  - inline periodic settlement
  - durable channel state for server runtimes
- Viem-first ergonomics for local accounts, wallet clients, public clients, and browser/EIP-1193 wallets

## Package Exports

- `mega-mpp-sdk`
  - `charge`
  - `session`
  - MegaETH method schemas and types
  - session authorizers
  - channel ID and voucher helpers
  - session client/server store helpers
- `mega-mpp-sdk/client`
  - `megaeth.charge(...)`
  - `megaeth.session(...)`
  - `Mppx`
  - `WalletSessionAuthorizer`
  - `DelegatedSessionAuthorizer`
- `mega-mpp-sdk/server`
  - `megaeth.charge(...)`
  - `megaeth.session(...)`
  - `Mppx`
  - `Store`
  - session channel store helpers and types

## Repository Layout

```text
mega-mpp-sdk/
├── contracts/
├── typescript/
│   └── packages/mpp/
│       └── src/
│           ├── Methods.ts
│           ├── client/
│           ├── server/
│           ├── session/
│           ├── utils/
│           └── __tests__/
├── docs/
│   └── methods/
├── demo/
│   ├── app/
│   ├── server/
│   └── worker/
├── .github/workflows/
└── justfile
```

## Install

```bash
pnpm add mega-mpp-sdk
```

## Quick Start

### Charge Server

```ts
import { Mppx, megaeth } from "mega-mpp-sdk/server";
import { privateKeyToAccount } from "viem/accounts";

const settlementAccount = privateKeyToAccount(
  process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY!,
);

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [
    megaeth.charge({
      account: settlementAccount,
      chainId: 6343,
      currency: process.env.MEGAETH_TOKEN_ADDRESS!,
      permit2Address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      recipient: settlementAccount.address,
      testnet: true,
    }),
  ],
});
```

### Session Server

```ts
import { Mppx, Store, megaeth } from "mega-mpp-sdk/server";
import { privateKeyToAccount } from "viem/accounts";

const serverAccount = privateKeyToAccount(
  process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY!,
);

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [
    megaeth.session({
      account: serverAccount,
      chainId: 6343,
      currency: process.env.MEGAETH_TOKEN_ADDRESS!,
      escrowContract: process.env.MEGAETH_SESSION_ESCROW_ADDRESS!,
      recipient: serverAccount.address,
      settlement: {
        close: { enabled: true },
        periodic: {
          intervalSeconds: 3600,
          minUnsettledAmount: "200000",
        },
      },
      store: Store.memory(),
      suggestedDeposit: "500000",
      testnet: true,
      unitType: "request",
      verifier: {
        allowDelegatedSigner: true,
        minVoucherDelta: "100000",
      },
    }),
  ],
});
```

### Client

```ts
import { Mppx, megaeth } from "mega-mpp-sdk/client";

const mppx = Mppx.create({
  methods: [
    megaeth.charge({
      account,
      credentialMode: "permit2",
      publicClient,
      walletClient,
    }),
    megaeth.session({
      account,
      deposit: "500000",
      publicClient,
      walletClient,
    }),
  ],
});
```

## Demo Quickstart

The local demo starts with two commands once the environment is exported:

```bash
pnpm demo:server
pnpm demo:app
```

For the MegaETH Carrot walkthrough:

- use testnet USDC at `0x75139a9559c9cd1ad69b7e239c216151d2c81e6f`, not the default USDm example token
- charge flows require one-time Permit2 approval
- session flows require a deployed `MegaMppSessionEscrow` plus a direct ERC-20 approval to that escrow contract
- when you deploy the session escrow with Foundry on MegaETH, add `--skip-simulation` to `forge script`

The full walkthrough lives in [docs/getting-started.md](/Users/m/workspace/mega-mpp-sdk/docs/getting-started.md) and [docs/demo.md](/Users/m/workspace/mega-mpp-sdk/docs/demo.md).

For session servers, `store: Store.memory()` keeps channel persistence single-process. When you run more than one worker or instance, pass `channelStore` with an implementation that coordinates atomic channel updates across instances.

## Breaking Cleanup In 0.2.0

- the session client context no longer accepts `managementOnly`
- use `context.action = "topUp"` with `authorizeCurrentRequest: false` for a pure management top-up
- `close` remains an explicit `context.action = "close"` flow without extra flags

## Method Docs

- [MegaETH Charge](/Users/m/workspace/mega-mpp-sdk/docs/methods/charge.md)
- [MegaETH Session](/Users/m/workspace/mega-mpp-sdk/docs/methods/session.md)

## Development

```bash
pnpm --dir typescript install
pnpm demo:install
just contracts-test
just contracts-verify
just ts-typecheck
just ts-test
just ts-test-integration
just demo-test
just ts-audit
just release-prep
```

## Draft Caveats

- Charge direct settlement signs the challenge `recipient` as the spender because PR 205 does not yet expose a separate spender field.
- Charge split payments use a batch Permit2 extension when more than one transfer leg is needed.
- Session receipts stay `mppx`-compatible in v1. Richer session acceptance state is returned alongside the resource or demo state, not inside the serialized `Payment-Receipt` header.
- Session gas sponsorship is out of scope in v1. The payer wallet pays gas for `open` and `topUp`, while the server settlement wallet pays gas for `settle` and `close`.

## License

This repository and the published SDK package are released under the [Unlicense](/Users/m/workspace/mega-mpp-sdk/LICENSE).
