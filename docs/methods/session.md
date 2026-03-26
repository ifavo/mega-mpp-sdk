# MegaETH Session

Use `session` when many protected requests should share one funded escrow channel.

This is the best fit when you want:

- a reusable payment channel for repeated access
- voucher-based request authorization after the first on-chain open
- periodic server settlement instead of one on-chain payment per request

For the end-to-end walkthrough, start with [../getting-started.md](../getting-started.md).

## Server Shape

`session` can inherit the explicit create-level MegaETH values you already chose
for `account`, `chainId`, `currency`, and `recipient`, but it still requires
explicit session policy:

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
    }),
  ],
  recipient,
  secretKey: process.env.MPP_SECRET_KEY!,
});
```

With that method registered, the route handler can issue the next session challenge with the request price:

```ts
const result = await mppx.megaeth.session({
  amount: "100000",
  description: "Reusable session resource",
})(request);
```

## Model

`session` uses an escrow-backed Tempo-style voucher channel:

- the payer opens an on-chain escrow channel
- the payer or delegated signer signs cumulative EIP-712 vouchers
- the server accepts vouchers, settles periodically, and closes cooperatively

The serialized `Payment-Receipt` header stays `mppx`-compatible in v1. Richer channel state is returned separately by the SDK and demo.

## Request Shape

```ts
type SessionRequest = {
  amount: string
  currency: `0x${string}`
  recipient: `0x${string}`
  description?: string
  externalId?: string
  suggestedDeposit?: string
  unitType?: string
  methodDetails: {
    chainId?: number
    escrowContract: `0x${string}`
    channelId?: `0x${string}`
    minVoucherDelta?: string
  }
}
```

`methodDetails.chainId` is the only public network selector. Provide it
explicitly through create-level configuration or on each request.

## Credential Actions

The client and server share four session payload actions:

- `open`
- `voucher`
- `topUp`
- `close`

`open` and `topUp` include on-chain transaction hashes so the server can verify the escrow mutation before accepting the request.

## Voucher Shape

Session vouchers are EIP-712 messages over:

- `channelId`
- `cumulativeAmount`

The server recovers the signer against on-chain channel state:

- `authorizedSigner` when configured
- otherwise the payer address

## Client Flow

The client session factory supports the same protected route across the full lifecycle:

- first request auto-opens a channel when no active scoped channel exists
- repeated requests sign the next cumulative voucher
- `context.action = "topUp"` performs a combined top-up by default
- `context.action = "topUp"` with `authorizeCurrentRequest: false` performs a pure management top-up
- `context.action = "close"` signs the final cooperative close voucher

Progress events:

- `challenge`
- `opening`
- `opened`
- `updating`
- `updated`
- `toppingUp`
- `toppedUp`
- `closing`
- `closed`

## Server Flow

The server verifies and persists:

- payer
- recipient
- currency
- authorized signer
- deposit
- accepted cumulative amount
- settled amount
- last voucher signature
- last challenge ID
- last settlement time
- channel status

The default `session({ store })` path is single-process. For multi-instance runtimes, pass `channelStore` with cross-instance atomic update semantics and back the replay store with a shared implementation that can serialize replay-sensitive verification keys across instances.

Inline periodic settlement runs after voucher acceptance when either threshold is met:

- `acceptedCumulative - settled >= minUnsettledAmount`
- `now - lastSettlementAt >= intervalSeconds`

## Escrow Contract

The repository ships an upgradeable `MegaMppSessionEscrow` contract in [contracts/src/MegaMppSessionEscrow.sol](../../contracts/src/MegaMppSessionEscrow.sol).

Supported contract surface:

- `open`
- `settle`
- `topUp`
- `close`
- `requestClose`
- `withdraw`
- `getChannel`
- `getChannelsBatch`
- `computeChannelId`
- `getVoucherDigest`
- `domainSeparator`

Deployment script:

```bash
cd contracts
export PRIVATE_KEY='0x...'
export SESSION_ESCROW_OWNER='0x...'
export SESSION_ESCROW_CLOSE_DELAY=86400

forge script script/DeployMegaMppSessionEscrow.s.sol:DeployMegaMppSessionEscrowScript \
  --rpc-url "$MEGAETH_RPC_URL" \
  --skip-simulation \
  --broadcast
```

On MegaETH, include `--skip-simulation` when you deploy with Foundry. The deployment path should target live broadcast directly.

## Funding Constraints

- the payer wallet pays gas for `open` and `topUp`
- the payer wallet must approve the escrow contract directly for the ERC-20 deposit
- the server settlement wallet pays gas for `settle` and `close`
- session fee sponsorship is out of scope in v1

## Error Style

Session verification maps onto instructive RFC 9457 problem-details errors for cases such as:

- invalid signature
- signer mismatch
- voucher delta too small
- cumulative amount exceeding deposit
- unknown or finalized channel
- replayed or stale challenge
