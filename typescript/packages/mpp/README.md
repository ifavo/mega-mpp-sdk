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
- Cloudflare Workers are supported today. The proof path is the Worker demo in [github.com/ifavo/mega-mpp-sdk/blob/main/demo/README.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/demo/README.md).

## Cloudflare Workers

Cloudflare integration stays inside the Worker boundary. For live paid routes,
use a shared store such as a Durable Object-backed store instead of a fresh
in-memory store per request. The smallest correct production pattern and the
working demo are documented here:

- Canonical guide: [github.com/ifavo/mega-mpp-sdk/blob/main/docs/agent-integration.md#cloudflare-worker-recipe](https://github.com/ifavo/mega-mpp-sdk/blob/main/docs/agent-integration.md#cloudflare-worker-recipe)
- Demo runtime: [github.com/ifavo/mega-mpp-sdk/blob/main/demo/worker/src/index.ts](https://github.com/ifavo/mega-mpp-sdk/blob/main/demo/worker/src/index.ts)
- Durable Object store adapter: [github.com/ifavo/mega-mpp-sdk/blob/main/demo/worker/src/store.ts](https://github.com/ifavo/mega-mpp-sdk/blob/main/demo/worker/src/store.ts)

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
  methods: [megaeth.charge()],
});
```

## Charge Notes

- Split `charge` requests use ordered Permit2 `authorizations[]` and settle sequentially, primary transfer first.
- `credentialMode: "hash"` is supported only for unsplit charge requests.
- The default MegaETH HTTP transport writes `challengeId` into the raw `Payment-Receipt` header, while generic `mppx` receipt parsing still drops that field.

## Docs

- Coding agents: [github.com/ifavo/mega-mpp-sdk/blob/main/docs/agent-integration.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/docs/agent-integration.md)
- Agent index: [github.com/ifavo/mega-mpp-sdk/blob/main/llms.txt](https://github.com/ifavo/mega-mpp-sdk/blob/main/llms.txt)
- Getting started: [github.com/ifavo/mega-mpp-sdk/blob/main/docs/getting-started.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/docs/getting-started.md)
- Charge reference: [github.com/ifavo/mega-mpp-sdk/blob/main/docs/methods/charge.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/docs/methods/charge.md)
- Session reference: [github.com/ifavo/mega-mpp-sdk/blob/main/docs/methods/session.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/docs/methods/session.md)
- Release guide: [github.com/ifavo/mega-mpp-sdk/blob/main/docs/releasing.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/docs/releasing.md)
- Changelog: [github.com/ifavo/mega-mpp-sdk/blob/main/typescript/packages/mpp/CHANGELOG.md](https://github.com/ifavo/mega-mpp-sdk/blob/main/typescript/packages/mpp/CHANGELOG.md)
