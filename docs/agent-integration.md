# Agent Integration Guide

This is the canonical integration guide for coding agents.

Use this page before reading the other docs. It is self-contained and optimized
for copy-paste integration work against the real public SDK surface.

The SDK already runs in Cloudflare Workers. The repository includes a Worker
demo under `demo/worker`, and that demo proves the supported Cloudflare path.
If the target system is Cloudflare-only, keep the payment backend inside the
Cloudflare boundary instead of adding a separate non-Cloudflare server.

## Agent Rules

1. Start with `charge`. Only use `session` when the caller explicitly needs a reusable funded channel.
2. Use only the public entrypoints:
   - `@moldy/mega-mpp-sdk/server`
   - `@moldy/mega-mpp-sdk/client`
   - `@moldy/mega-mpp-sdk/chains`
3. Keep `chainId` and `recipient` explicit.
4. Omit `submissionMode` to use `realtime`, or set it explicitly when a charge flow needs `sync` or `sendAndWait`.
5. Keep the settlement wallet and `recipient` aligned for server-broadcast `charge` and all `session` flows.
6. Do not invent a mainnet session escrow address. Mainnet `session` requires a deployed or user-provided escrow contract.
7. Cloudflare Workers are a supported runtime. Prefer the Worker recipe and the `demo/worker` implementation when the integration target already lives on Cloudflare.

## Choose the Flow

| Need | Use | Why |
| --- | --- | --- |
| One payment per protected request | `charge` | Lowest integration overhead |
| Reuse one funded channel across many requests | `session` | Lower repeat overhead after `open` |
| Server should sponsor gas for charge settlement | `charge` with Permit2 credential mode | The server broadcasts the Permit2 settlement |
| Payer should broadcast the charge directly | `charge` with transaction-hash credential mode | The client broadcasts and the server verifies the hash |

If the user does not say otherwise, integrate `charge`.

## Published Network Constants

| Network | Chain ID | RPC | Charge Token | Permit2 | Session Escrow |
| --- | --- | --- | --- | --- | --- |
| MegaETH mainnet | `4326` | `https://mainnet.megaeth.com/rpc` | USDm `0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7` | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Deploy your own or provide one |
| MegaETH testnet | `6343` | `https://carrot.megaeth.com/rpc` | USDC `0x75139a9559c9cd1ad69b7e239c216151d2c81e6f` | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `0xD83A68408539868e5f48D0E93537f56afBB9d512` |

## Shared Environment Variables

Use these names when you wire server runtimes:

| Variable | Charge Mainnet | Charge Testnet | Session Testnet | Session Mainnet | Notes |
| --- | --- | --- | --- | --- | --- |
| `MPP_SECRET_KEY` | required | required | required | required | Keep this stable across restarts so challenge verification stays valid |
| `MEGAETH_SETTLEMENT_PRIVATE_KEY` | required for server-broadcast charge | required for server-broadcast charge | required | required | Fund this wallet with MegaETH gas |
| `MEGAETH_CHAIN_ID` | required | required | required | required | `4326` mainnet, `6343` testnet |
| `MEGAETH_RECIPIENT_ADDRESS` | required | required | required | required | For server-broadcast charge and session, set this to the settlement wallet address |
| `MEGAETH_PAYMENT_TOKEN_ADDRESS` | optional | required | required | recommended | Mainnet charge defaults to USDm if you omit it |
| `MEGAETH_SESSION_ESCROW_ADDRESS` | not used | not used | required | required | Mainnet session requires your deployed or provided escrow |
| `MEGAETH_SUBMISSION_MODE` | required when the flow broadcasts | required when the flow broadcasts | not used for client voucher signing | not used for client voucher signing | Set `realtime`, `sync`, or `sendAndWait` |
| `MEGAETH_PERMIT2_ADDRESS` | optional | optional | not used | not used | Defaults to the canonical Permit2 address |

## Public Package Exports

```ts
import { Mppx, Store, megaeth } from "@moldy/mega-mpp-sdk/server";
import { Mppx as ClientMppx, megaeth as megaethClient } from "@moldy/mega-mpp-sdk/client";
import { megaethMainnet, megaethTestnet } from "@moldy/mega-mpp-sdk/chains";
```

Use:

- `Mppx.create(...)` for server defaults and method registration
- `megaeth.charge(...)` for one-shot payments
- `megaeth.session(...)` for reusable escrow-backed channels
- `megaethMainnet` / `megaethTestnet` for explicit chain selection

## Cloudflare Compatibility

Cloudflare Workers are a first-class supported runtime for this SDK.

The repository already proves that path:

- `demo/worker` runs the payment API inside a Cloudflare Worker
- `demo/server` and `demo/worker` expose the same API routes
- the Worker demo keeps replay-sensitive charge and session state in a Durable Object
- the Worker demo serves the SPA and API from one origin without requiring a separate non-Cloudflare backend

When another agent is integrating this SDK into a Cloudflare-only product:

- keep the payment routes in the Worker
- keep replay and session state in Cloudflare storage primitives such as Durable Objects
- use the Worker recipe in this guide and the runtime notes in `docs/demo.md`
- do not add a separate Node or non-Cloudflare payment backend unless the user explicitly asks for one

For paid Worker routes, do not rely on a fresh in-memory store inside each
request handler. Paid retries need shared challenge and replay state across
requests, so use a Durable Object-backed store or another shared store with the
same semantics.

## Instant Mainnet Charge

Mainnet `charge` is the default instant path. It uses the SDK's published
defaults for the payment token and Permit2 unless you override them.

### Environment

```bash
export MPP_SECRET_KEY="$(openssl rand -hex 32)"
export MEGAETH_SETTLEMENT_PRIVATE_KEY='0xYOUR_SETTLEMENT_PRIVATE_KEY'
export MEGAETH_CHAIN_ID=4326
export MEGAETH_RECIPIENT_ADDRESS='0xYOUR_SETTLEMENT_WALLET_ADDRESS'
export MEGAETH_RPC_URL=https://mainnet.megaeth.com/rpc
export MEGAETH_SUBMISSION_MODE=realtime
```

### Server

```ts
import { Mppx, megaeth } from "@moldy/mega-mpp-sdk/server";
import { megaethMainnet } from "@moldy/mega-mpp-sdk/chains";
import { parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const settlementAccount = privateKeyToAccount(
  process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY as `0x${string}`,
);

export const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  account: settlementAccount,
  chainId: megaethMainnet.id,
  rpcUrls: {
    [megaethMainnet.id]: process.env.MEGAETH_RPC_URL!,
  },
  recipient: settlementAccount.address,
  methods: [
    megaeth.charge({
      submissionMode: process.env.MEGAETH_SUBMISSION_MODE as
        | "realtime"
        | "sync"
        | "sendAndWait",
    }),
  ],
});

export async function handlePaidRoute(request: Request): Promise<Response> {
  const result = await mppx.megaeth.charge({
    amount: parseUnits("0.01", 18).toString(),
    description: "Mainnet paid response",
  })(request);

  if (result.status === 402) {
    return result.challenge;
  }

  return result.withReceipt(Response.json({ ok: true }));
}
```

Notes:

- `currency` is optional here and defaults to mainnet USDm `0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7`.
- `permit2Address` is optional here and defaults to `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
- Keep `recipient` equal to the settlement wallet address for this server-broadcast flow.

## Instant Testnet Charge

Use the published Carrot values when you want a fully explicit testnet setup.

### Environment

```bash
export MPP_SECRET_KEY="$(openssl rand -hex 32)"
export MEGAETH_SETTLEMENT_PRIVATE_KEY='0xYOUR_SETTLEMENT_PRIVATE_KEY'
export MEGAETH_CHAIN_ID=6343
export MEGAETH_RECIPIENT_ADDRESS='0xYOUR_SETTLEMENT_WALLET_ADDRESS'
export MEGAETH_RPC_URL=https://carrot.megaeth.com/rpc
export MEGAETH_PAYMENT_TOKEN_ADDRESS=0x75139a9559c9cd1ad69b7e239c216151d2c81e6f
export MEGAETH_PERMIT2_ADDRESS=0x000000000022D473030F116dDEE9F6B43aC78BA3
export MEGAETH_SUBMISSION_MODE=realtime
```

### Server

```ts
import { Mppx, megaeth } from "@moldy/mega-mpp-sdk/server";
import { megaethTestnet } from "@moldy/mega-mpp-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";

const settlementAccount = privateKeyToAccount(
  process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY as `0x${string}`,
);

export const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  account: settlementAccount,
  chainId: megaethTestnet.id,
  currency: process.env.MEGAETH_PAYMENT_TOKEN_ADDRESS as `0x${string}`,
  rpcUrls: {
    [megaethTestnet.id]: process.env.MEGAETH_RPC_URL!,
  },
  recipient: settlementAccount.address,
  methods: [
    megaeth.charge({
      permit2Address: process.env.MEGAETH_PERMIT2_ADDRESS as `0x${string}`,
      submissionMode: process.env.MEGAETH_SUBMISSION_MODE as
        | "realtime"
        | "sync"
        | "sendAndWait",
    }),
  ],
});
```

### Permit2 Approval

Approve Permit2 once from the payer wallet before the first funded charge:

```bash
export CLIENT_PRIVATE_KEY='0xYOUR_CLIENT_PRIVATE_KEY'

cast send "$MEGAETH_PAYMENT_TOKEN_ADDRESS" \
  "approve(address,uint256)(bool)" \
  "$MEGAETH_PERMIT2_ADDRESS" \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  --private-key "$CLIENT_PRIVATE_KEY" \
  --rpc-url "$MEGAETH_RPC_URL"
```

## Instant Testnet Session

Testnet `session` is instant because the repository already publishes a Carrot
escrow address.

### Environment

```bash
export MPP_SECRET_KEY="$(openssl rand -hex 32)"
export MEGAETH_SETTLEMENT_PRIVATE_KEY='0xYOUR_SETTLEMENT_PRIVATE_KEY'
export MEGAETH_CHAIN_ID=6343
export MEGAETH_RECIPIENT_ADDRESS='0xYOUR_SETTLEMENT_WALLET_ADDRESS'
export MEGAETH_RPC_URL=https://carrot.megaeth.com/rpc
export MEGAETH_PAYMENT_TOKEN_ADDRESS=0x75139a9559c9cd1ad69b7e239c216151d2c81e6f
export MEGAETH_SESSION_ESCROW_ADDRESS=0xD83A68408539868e5f48D0E93537f56afBB9d512
```

### Server

```ts
import { Mppx, Store, megaeth } from "@moldy/mega-mpp-sdk/server";
import { megaethTestnet } from "@moldy/mega-mpp-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";

const settlementAccount = privateKeyToAccount(
  process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY as `0x${string}`,
);

export const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  account: settlementAccount,
  chainId: megaethTestnet.id,
  currency: process.env.MEGAETH_PAYMENT_TOKEN_ADDRESS as `0x${string}`,
  rpcUrls: {
    [megaethTestnet.id]: process.env.MEGAETH_RPC_URL!,
  },
  recipient: settlementAccount.address,
  methods: [
    megaeth.session({
      escrowContract: process.env.MEGAETH_SESSION_ESCROW_ADDRESS as `0x${string}`,
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
});
```

### Escrow Approval

Approve the escrow contract once from the payer wallet before the first funded
session `open`:

```bash
export CLIENT_PRIVATE_KEY='0xYOUR_CLIENT_PRIVATE_KEY'

cast send "$MEGAETH_PAYMENT_TOKEN_ADDRESS" \
  "approve(address,uint256)(bool)" \
  "$MEGAETH_SESSION_ESCROW_ADDRESS" \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  --private-key "$CLIENT_PRIVATE_KEY" \
  --rpc-url "$MEGAETH_RPC_URL"
```

## Mainnet Session

Mainnet `session` is supported, but it is not instant until you have an escrow
deployment. Do not hardcode a mainnet escrow address unless the user provides
one.

### Environment

```bash
export MPP_SECRET_KEY="$(openssl rand -hex 32)"
export MEGAETH_SETTLEMENT_PRIVATE_KEY='0xYOUR_SETTLEMENT_PRIVATE_KEY'
export MEGAETH_CHAIN_ID=4326
export MEGAETH_RECIPIENT_ADDRESS='0xYOUR_SETTLEMENT_WALLET_ADDRESS'
export MEGAETH_RPC_URL=https://mainnet.megaeth.com/rpc
export MEGAETH_PAYMENT_TOKEN_ADDRESS=0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7
export MEGAETH_SESSION_ESCROW_ADDRESS='0xYOUR_ESCROW_PROXY'
```

### Deploy or Upgrade the Escrow

Deploy a new proxy:

```bash
cd contracts
export PRIVATE_KEY='0xYOUR_PROXY_OWNER_KEY'
export MEGAETH_RPC_URL=https://mainnet.megaeth.com/rpc
export SESSION_ESCROW_OWNER='0xYOUR_PROXY_OWNER_ADDRESS'
export SESSION_ESCROW_CLOSE_DELAY=86400

forge script script/DeployMegaMppSessionEscrow.s.sol:DeployMegaMppSessionEscrowScript \
  --rpc-url "$MEGAETH_RPC_URL" \
  --skip-simulation \
  --broadcast
```

Export the deployed proxy:

```bash
export MEGAETH_SESSION_ESCROW_ADDRESS='0xYOUR_ESCROW_PROXY'
```

Upgrade an existing proxy:

```bash
cd contracts
export PRIVATE_KEY='0xYOUR_PROXY_OWNER_KEY'
export MEGAETH_RPC_URL=https://mainnet.megaeth.com/rpc
export SESSION_ESCROW_PROXY="$MEGAETH_SESSION_ESCROW_ADDRESS"

forge script script/UpgradeMegaMppSessionEscrow.s.sol:UpgradeMegaMppSessionEscrowScript \
  --rpc-url "$MEGAETH_RPC_URL" \
  --skip-simulation \
  --broadcast
```

If the proxy owner is a multisig, generate calldata and execute it through the
multisig instead of using the broadcast script directly.

### Server

```ts
import { Mppx, Store, megaeth } from "@moldy/mega-mpp-sdk/server";
import { megaethMainnet } from "@moldy/mega-mpp-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";

const settlementAccount = privateKeyToAccount(
  process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY as `0x${string}`,
);

export const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  account: settlementAccount,
  chainId: megaethMainnet.id,
  currency: process.env.MEGAETH_PAYMENT_TOKEN_ADDRESS as `0x${string}`,
  rpcUrls: {
    [megaethMainnet.id]: process.env.MEGAETH_RPC_URL!,
  },
  recipient: settlementAccount.address,
  methods: [
    megaeth.session({
      escrowContract: process.env.MEGAETH_SESSION_ESCROW_ADDRESS as `0x${string}`,
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
});
```

## Browser Client

Use the client package in the browser or wallet-facing runtime:

```ts
import { Mppx, megaeth } from "@moldy/mega-mpp-sdk/client";

export const mppx = Mppx.create({
  methods: [
    megaeth.charge({
      account,
      publicClient,
      submissionMode: "realtime",
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

Notes:

- `charge` defaults to Permit2 credential mode. That is the simplest path when the server settles.
- If the payer must broadcast the charge directly, set `credentialMode: "hash"`. Omit `submissionMode` to use `realtime`, or set it explicitly when you need `sync` or `sendAndWait`.
- `session` needs a `deposit` on the client unless the server challenge already includes `suggestedDeposit`.

## Express Server Recipe

This is the simplest accurate Express pattern: convert the Express request into
a Web `Request`, call the SDK route handler, then copy the Web `Response` back
to Express.

```ts
import express, {
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from "express";
import { Mppx, megaeth } from "@moldy/mega-mpp-sdk/server";
import { megaethTestnet } from "@moldy/mega-mpp-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";

const app = express();
const settlementAccount = privateKeyToAccount(
  process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY as `0x${string}`,
);

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  account: settlementAccount,
  chainId: megaethTestnet.id,
  currency: process.env.MEGAETH_PAYMENT_TOKEN_ADDRESS as `0x${string}`,
  rpcUrls: {
    [megaethTestnet.id]: process.env.MEGAETH_RPC_URL!,
  },
  recipient: settlementAccount.address,
  methods: [megaeth.charge({ submissionMode: "realtime" })],
});

app.get("/api/v1/paid", async (request, response) => {
  const result = await mppx.megaeth.charge({
    amount: "100000",
    description: "Express paid route",
  })(toWebRequest(request, "https://api.example.com"));

  if (result.status === 402) {
    await sendWebResponse(response, result.challenge);
    return;
  }

  await sendWebResponse(
    response,
    result.withReceipt(Response.json({ ok: true })),
  );
});

function toWebRequest(request: ExpressRequest, apiOrigin: string): Request {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (!value) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  return new Request(new URL(request.originalUrl, apiOrigin).toString(), {
    headers,
    method: request.method,
  });
}

async function sendWebResponse(
  response: ExpressResponse,
  webResponse: Response,
): Promise<void> {
  response.status(webResponse.status);

  webResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });

  response.send(await webResponse.text());
}
```

## Cloudflare Worker Recipe

Cloudflare Workers already use the Web `Request`/`Response` model, so the
integration is direct. The only extra requirement for live paid routes is a
shared store. The snippet below shows the smallest correct production shape.

```ts
import { Mppx, megaeth } from "@moldy/mega-mpp-sdk/server";
import { megaethTestnet } from "@moldy/mega-mpp-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createDurableObjectStore } from "./store";

export interface Env {
  MPP_SECRET_KEY: string;
  MEGAETH_PAYMENT_TOKEN_ADDRESS: `0x${string}`;
  PAYMENT_STORE: DurableObjectNamespace;
  MEGAETH_RPC_URL: string;
  MEGAETH_SETTLEMENT_PRIVATE_KEY: `0x${string}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/v1/paid") {
      return new Response("Not found", { status: 404 });
    }

    const settlementAccount = privateKeyToAccount(
      env.MEGAETH_SETTLEMENT_PRIVATE_KEY,
    );
    const store = createDurableObjectStore(env.PAYMENT_STORE);

    const mppx = Mppx.create({
      secretKey: env.MPP_SECRET_KEY,
      account: settlementAccount,
      chainId: megaethTestnet.id,
      currency: env.MEGAETH_PAYMENT_TOKEN_ADDRESS,
      rpcUrls: {
        [megaethTestnet.id]: env.MEGAETH_RPC_URL,
      },
      recipient: settlementAccount.address,
      methods: [
        megaeth.charge({
          store,
          submissionMode: "realtime",
        }),
      ],
    });

    const result = await mppx.megaeth.charge({
      amount: "100000",
      description: "Worker paid route",
    })(request);

    if (result.status === 402) {
      return result.challenge;
    }

    return result.withReceipt(Response.json({ ok: true }));
  },
};
```

The repository includes a working Durable Object store adapter at
`demo/worker/src/store.ts` and a full Worker runtime at `demo/worker/src/index.ts`.

## Verification Checklist

1. Confirm the server returns `402` with a payment challenge before the route is paid.
2. Confirm the route returns your resource plus a `Payment-Receipt` header after payment succeeds.
3. Confirm the client wallet is connected to the same `chainId` as the challenge.
4. Confirm the payer wallet has MegaETH gas plus the payment token balance.
5. For `charge`, confirm the payer approved Permit2 once.
6. For `session`, confirm the payer approved the escrow contract once.
7. For server-broadcast `charge` and `session`, confirm `recipient` equals the settlement wallet address.
8. For mainnet `session`, confirm `MEGAETH_SESSION_ESCROW_ADDRESS` points at your deployed proxy before the first `open`.

## Troubleshooting

- Missing `chainId`:
  - Set `chainId` through `Mppx.create(...)` or include `methodDetails.chainId` in the request challenge before retrying.
- Missing `recipient`:
  - Set `recipient` explicitly. The SDK does not infer the payee from the settlement wallet.
- Realtime submission unsupported by the RPC:
  - Set `submissionMode` to `sync` or `sendAndWait` before retrying the broadcast flow.
- Charge hash mode used with server-sponsored gas:
  - Switch back to `credentialMode: "permit2"` before retrying because the server requested fee sponsorship.
- Permit2 allowance missing:
  - Approve Permit2 for the payment token before retrying the first charge.
- Session escrow missing:
  - Set `MEGAETH_SESSION_ESCROW_ADDRESS` before retrying any session flow.
- Settlement wallet and recipient mismatch:
  - Set `MEGAETH_RECIPIENT_ADDRESS` to the settlement wallet address before retrying server-broadcast charge or session flows.
- Multi-instance runtime:
  - Replace in-memory replay and session storage with shared durable stores before relying on cross-instance verification.

## Deeper References

- Charge reference: [methods/charge.md](methods/charge.md)
- Session reference: [methods/session.md](methods/session.md)
- Runtime and demo guide: [demo.md](demo.md)
- Cloudflare demo workspace: [../demo/README.md](../demo/README.md)
- Human onboarding path: [getting-started.md](getting-started.md)
