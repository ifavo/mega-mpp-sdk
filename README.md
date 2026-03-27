# @moldy/mega-mpp-sdk

MegaETH payment methods for the Machine Payments Protocol.

The package ships both first-class MegaETH flows:

- `charge` for one-shot Permit2-backed payments
- `session` for reusable escrow-backed voucher channels

The default server path is intentionally short:

1. Configure the shared MegaETH signer, `chainId`, and `recipient` once in `Mppx.create(...)`.
2. Register `megaeth.charge()` or `megaeth.session(...)`.
3. Issue route challenges with `mppx.megaeth.charge({ amount })` or `mppx.megaeth.session({ amount })`.

## Scope

- Charge flows:
  - server-broadcast Permit2 credentials
  - client-broadcast transaction-hash credentials
  - fee sponsorship
  - split payments
  - replay protection
  - instructive RFC 9457-compatible errors
- Session flows:
  - upgradeable in-repo MegaETH escrow contract
  - payer and delegated-signer vouchers
  - cooperative close
  - inline periodic settlement
  - durable channel state for server runtimes

## Install

```bash
pnpm add @moldy/mega-mpp-sdk
```

## Agents

- Coding agents should start with [docs/agent-integration.md](docs/agent-integration.md).
- Tooling that supports an agent index can start with [llms.txt](llms.txt).

## Quick Start

### Quick Charge Server

This is the shortest integration-first server example. It keeps `chainId` and
`recipient` explicit, then shows the one route pattern developers usually need
first: either return the challenge or return the data.

```ts
import { Mppx, megaeth } from "@moldy/mega-mpp-sdk/server";
import { megaethMainnet } from "@moldy/mega-mpp-sdk/chains";
import { parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const settlementAccount = privateKeyToAccount(
  process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY!,
);

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!, // Signs and verifies MPP challenges across requests.
  account: settlementAccount, // Signs server-side MegaETH transactions when this flow broadcasts.
  chainId: megaethMainnet.id, // Makes the target network explicit so the SDK never guesses.
  recipient: settlementAccount.address, // Sets who receives the payment when the charge settles.
  methods: [
    megaeth.charge({
      submissionMode: "realtime", // Uses MegaETH's realtime submission path when the RPC supports it.
    }),
  ],
});

const result = await mppx.megaeth.charge({
  amount: parseUnits("0.01", 18).toString(), // Required. 1 cent of USDm on MegaETH mainnet.
  description: "Premium API response", // Optional. Tells the payer what this charge unlocks.
})(request); // Verifies a retrying payment or creates the next 402 challenge.

if (result.status === 402) {
  return result.challenge; // Return payment instructions when the request is still unpaid.
}

return result.withReceipt(
  Response.json({ data: "..." }), // Return your data and attach the Payment-Receipt header.
);
```

For the quick charge path:

- `mppx.megaeth.charge({ amount })`: `amount` is required.
- `mppx.megaeth.charge({ description, externalId })`: both are optional.
- `megaeth.charge({ currency })`: optional and defaults to mainnet USDm.
- `megaeth.charge({ permit2Address })`: optional and defaults to the canonical Permit2 contract.
- `recipient` and `methodDetails.chainId`: optional on the route request when you already set `recipient` and `chainId` in `Mppx.create(...)`, as this example does.
- `megaeth.charge({ submissionMode })`: optional to pass, but it has no automatic SDK default. Set `sync`, `realtime`, or `sendAndWait` before using a broadcast flow.

### Explicit Testnet Charge Setup

When you want readability over magic, use the exported chain objects:

```ts
import { Mppx, megaeth } from "@moldy/mega-mpp-sdk/server";
import { megaethTestnet } from "@moldy/mega-mpp-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";

const settlementAccount = privateKeyToAccount(
  process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY!,
);
const recipient = settlementAccount.address;

const mppx = Mppx.create({
  account: settlementAccount,
  chainId: megaethTestnet.id,
  currency: process.env.MEGAETH_PAYMENT_TOKEN_ADDRESS!,
  methods: [megaeth.charge({ submissionMode: "realtime" })],
  recipient,
  secretKey: process.env.MPP_SECRET_KEY!,
});
```

### Session Server

`session` still needs explicit escrow and settlement policy, but it can inherit the explicit create-level account, chain, currency, and recipient values you already chose:

```ts
import { Mppx, Store, megaeth } from "@moldy/mega-mpp-sdk/server";
import { megaethTestnet } from "@moldy/mega-mpp-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";

const settlementAccount = privateKeyToAccount(
  process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY!,
);
const recipient = settlementAccount.address;

const mppx = Mppx.create({
  account: settlementAccount,
  chainId: megaethTestnet.id,
  currency: process.env.MEGAETH_PAYMENT_TOKEN_ADDRESS!,
  methods: [
    megaeth.session({
      escrowContract: process.env.MEGAETH_SESSION_ESCROW_ADDRESS!,
      settlement: {
        close: { enabled: true },
        periodic: {
          intervalSeconds: 3600,
          minUnsettledAmount: "200000",
        },
      },
      store: Store.memory(),
      suggestedDeposit: "500000",
      unitType: "request",
      verifier: {
        allowDelegatedSigner: true,
        minVoucherDelta: "100000",
      },
    }),
  ],
  recipient,
  secretKey: process.env.MPP_SECRET_KEY!,
});
```

### Client

Client APIs stay explicit because the wallet and transport configuration belongs on the client side:

```ts
import { Mppx, megaeth } from "@moldy/mega-mpp-sdk/client";

const mppx = Mppx.create({
  methods: [
    megaeth.charge({
      account,
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

## Choosing a Flow

| Need | Use |
| --- | --- |
| One payment per request | `charge` |
| Reuse a funded channel across many requests | `session` |
| Server pays gas for charge settlement | `charge` with Permit2 credentials |
| Payer broadcasts the payment directly | `charge` with transaction-hash credentials |
| Durable multi-instance server runtime | `session` with a shared `channelStore` |

## Docs

- Coding agents: [docs/agent-integration.md](docs/agent-integration.md)
- Agent index: [llms.txt](llms.txt)
- Start here: [docs/getting-started.md](docs/getting-started.md)
- Runtime walkthroughs: [docs/demo.md](docs/demo.md)
- Charge reference: [docs/methods/charge.md](docs/methods/charge.md)
- Session reference: [docs/methods/session.md](docs/methods/session.md)
- Release guide: [docs/releasing.md](docs/releasing.md)
- Demo workspace notes: [demo/README.md](demo/README.md)

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

- Charge direct settlement still signs the challenge recipient as the spender because PR 205 does not yet expose a separate spender field.
- Split charge payments use a batch Permit2 extension when more than one transfer leg is needed.
- Session receipts stay `mppx`-compatible in v1. Richer session acceptance state is returned alongside the resource instead of inside the serialized `Payment-Receipt` header.
- Session gas sponsorship is out of scope in v1. The payer wallet pays gas for `open` and `topUp`, while the server settlement wallet pays gas for `settle` and `close`.

## License

This repository and the published SDK package are released under the [Unlicense](LICENSE).
