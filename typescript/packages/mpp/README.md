# @moldy/mega-mpp-sdk

MegaETH payment methods for the Machine Payments Protocol.

The package ships both first-class MegaETH flows:

- `charge` for one-shot Permit2-backed payments
- `session` for reusable escrow-backed voucher channels

## Install

```bash
pnpm add @moldy/mega-mpp-sdk
```

## Agents

- Coding agents should start with [github.com/ifavo/mega-mpp-sdk/blob/main/docs/agent-integration.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/docs/agent-integration.md).
- Tooling that supports an agent index can start with [github.com/ifavo/mega-mpp-sdk/blob/main/llms.txt](https://github.com/ifavo/mega-mpp-sdk/blob/main/llms.txt).

## Package Exports

- `@moldy/mega-mpp-sdk/server`
- `@moldy/mega-mpp-sdk/client`
- `@moldy/mega-mpp-sdk/chains`

## Quick Start

```ts
import { Mppx, megaeth } from "@moldy/mega-mpp-sdk/server";
import { megaethMainnet } from "@moldy/mega-mpp-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";

const settlementAccount = privateKeyToAccount(
  process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY!,
);

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  account: settlementAccount,
  chainId: megaethMainnet.id,
  recipient: settlementAccount.address,
  methods: [megaeth.charge({ submissionMode: "realtime" })],
});
```

## Docs

- Coding agents: [github.com/ifavo/mega-mpp-sdk/blob/main/docs/agent-integration.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/docs/agent-integration.md)
- Agent index: [github.com/ifavo/mega-mpp-sdk/blob/main/llms.txt](https://github.com/ifavo/mega-mpp-sdk/blob/main/llms.txt)
- Getting started: [github.com/ifavo/mega-mpp-sdk/blob/main/docs/getting-started.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/docs/getting-started.md)
- Charge reference: [github.com/ifavo/mega-mpp-sdk/blob/main/docs/methods/charge.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/docs/methods/charge.md)
- Session reference: [github.com/ifavo/mega-mpp-sdk/blob/main/docs/methods/session.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/docs/methods/session.md)
- Release guide: [github.com/ifavo/mega-mpp-sdk/blob/main/docs/releasing.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/docs/releasing.md)
- Changelog: [github.com/ifavo/mega-mpp-sdk/blob/main/typescript/packages/mpp/CHANGELOG.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/typescript/packages/mpp/CHANGELOG.md)
