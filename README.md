# mega-mpp-sdk

MegaETH payment method SDK for the Machine Payments Protocol.

`mega-mpp-sdk` mirrors the Solana MPP SDK structure, but v1 is intentionally scoped to the **charge** method only. It implements the current MegaETH charge draft from [mpp-specs PR 205](https://github.com/tempoxyz/mpp-specs/pull/205) and keeps the client/server developer experience aligned with the Solana reference SDK.

> [!IMPORTANT]
> The MegaETH charge spec is still a draft as of March 25, 2026. Wire details can still change, and this repository documents the places where the SDK has to make draft-specific assumptions.

## Scope

- Charge-only v1. `session` is intentionally deferred.
- Direct Permit2 settlement for server-settled flows.
- Broadcast `hash` mode for payer-settled flows.
- Split payments, fee sponsorship, replay protection, and RFC 9457-compatible instructive errors.
- Viem-first ergonomics for local accounts, wallet clients, public clients, and browser/EIP-1193 wallets.

## Package Exports

- `mega-mpp-sdk`: shared charge schemas, types, constants, and MegaETH method definitions.
- `mega-mpp-sdk/client`: client charge method factory plus `Mppx`.
- `mega-mpp-sdk/server`: server charge method factory plus `Mppx` and `Store`.

## Repository Layout

```text
mega-mpp-sdk/
├── typescript/
│   └── packages/mpp/
│       └── src/
│           ├── Methods.ts
│           ├── constants.ts
│           ├── client/
│           ├── server/
│           ├── utils/
│           └── __tests__/
├── docs/
├── demo/
│   ├── app/
│   └── server/
├── .github/workflows/
└── justfile
```

## Install

```bash
pnpm add mega-mpp-sdk
```

## Quick Start

### Server

```ts
import { Mppx, megaeth } from 'mega-mpp-sdk/server'
import { privateKeyToAccount } from 'viem/accounts'

const settlementAccount = privateKeyToAccount(process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY!)

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [
    megaeth.charge({
      account: settlementAccount,
      currency: '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7',
      recipient: settlementAccount.address,
      testnet: true,
    }),
  ],
})
```

### Client

```ts
import { Mppx, megaeth } from 'mega-mpp-sdk/client'

const mppx = Mppx.create({
  methods: [
    megaeth.charge({
      walletClient,
      publicClient,
      account,
      broadcast: false,
    }),
  ],
})

const response = await mppx.fetch('https://api.example.com/paid-resource')
```

## Draft Caveats

- The draft MegaETH charge spec does not currently expose a distinct spender field for direct Permit2 settlement. This SDK therefore signs the challenge `recipient` as the spender in direct mode, which means the settlement wallet and recipient must match.
- Split payments use a batch Permit2 extension in the SDK implementation when multiple transfer legs are present. The single-transfer path remains draft-compatible.
- `eth_sendRawTransactionSync` is preferred when the MegaETH RPC supports it. The SDK falls back to `realtime_sendRawTransaction`, then to a standard send-and-wait flow.
- Receipt headers stay `mppx`-compatible. The serialized `Payment-Receipt` header contains `method`, `reference`, `status`, `timestamp`, and optional `externalId`; it does not embed `challengeId`.

## Permit2 Approval

Before running a funded local, live, or demo flow, approve Permit2 once for the token you want to spend. The payer wallet needs:

- the payment token balance
- enough ETH for MegaETH gas when you use `hash` mode
- an ERC-20 approval that lets Permit2 spend at least the amount you plan to test

For the Carrot testnet demo, use testnet USDC at `0x75139a9559c9cd1ad69b7e239c216151d2c81e6f` instead of the default USDm example token and set `MEGAETH_TOKEN_ADDRESS` explicitly.

The full walkthrough for local, live, and demo setup lives in [docs/getting-started.md](/Users/m/workspace/mega-mpp-sdk/docs/getting-started.md).

## Development

```bash
pnpm --dir typescript install
just ts-typecheck
just ts-test
just ts-test-integration
just ts-audit
just ts-build
just release-prep
```

For a demo walkthrough and environment variables, see [docs/getting-started.md](/Users/m/workspace/mega-mpp-sdk/docs/getting-started.md) and [docs/demo.md](/Users/m/workspace/mega-mpp-sdk/docs/demo.md).

## License

This repository and the published SDK package are released under the [Unlicense](/Users/m/workspace/mega-mpp-sdk/LICENSE).
