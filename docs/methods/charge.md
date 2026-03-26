# MegaETH Charge

Use `charge` when each protected request should settle independently.

This is the best fit when you want:

- one Permit2-backed payment per request
- a simple server-broadcast flow with fee sponsorship
- a client-broadcast fallback that returns a transaction hash instead of a server-submitted settlement

For the end-to-end walkthrough, start with [../getting-started.md](../getting-started.md).

## Explicit Server Shape

Keep `chainId` and `recipient` explicit in server configuration. When the
settlement wallet is also the payee, opt in visibly with
`recipient: settlementAccount.address`.

```ts
import { Mppx, megaeth } from "@moldy/mega-mpp-sdk/server";
import { megaethMainnet } from "@moldy/mega-mpp-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";

const settlementAccount = privateKeyToAccount(
  process.env.MEGAETH_SETTLEMENT_PRIVATE_KEY!,
);
const recipient = settlementAccount.address;

const mppx = Mppx.create({
  account: settlementAccount,
  chainId: megaethMainnet.id,
  methods: [megaeth.charge()],
  recipient,
  secretKey: process.env.MPP_SECRET_KEY!,
});
```

Then issue a charge from the route handler with only the price:

```ts
const result = await mppx.megaeth.charge({
  amount: "100000",
  description: "Premium API response",
})(request);
```

Once `chainId` and `recipient` are explicit, the charge server still defaults:

- `currency`: mainnet USDm
- `permit2Address`: the canonical Permit2 contract

Use explicit overrides when you are:

- running on testnet
- charging a token other than mainnet USDm
- using a non-default recipient
- forcing a specific submission mode

## Modes

### Permit2 Credential (Server Broadcast)

- Client signs Permit2 typed data.
- Server verifies the challenge, signature, token, amount, splits, and source DID.
- Server broadcasts the Permit2 transaction from the settlement wallet.
- This is the fee-sponsored path.

### Transaction Hash Credential (Client Broadcast)

- Client signs Permit2 typed data.
- Client broadcasts the Permit2 transaction directly.
- Client returns the transaction hash as the credential payload.
- Server verifies the on-chain transaction against the challenge and rejects replays.

## Request Shape

```ts
type ChargeRequest = {
  amount: string
  currency: `0x${string}`
  recipient: `0x${string}`
  description?: string
  externalId?: string
  methodDetails: {
    chainId?: number
    feePayer?: boolean
    permit2Address?: `0x${string}`
    splits?: Array<{
      recipient: `0x${string}`
      amount: string
      memo?: string
    }>
  }
}
```

`methodDetails.chainId` is the only public network selector. The old `testnet`
flag is gone. Provide `chainId` either through explicit create-level defaults
or on each request.

## Client Credential Mode

The client charge factory accepts an optional `credentialMode` parameter:

- `permit2`: return a signed Permit2 credential for server-side verification and broadcast
- `hash`: broadcast the Permit2 transaction from the payer wallet and return a transaction-hash credential

## Submission Mode

Client and server charge factories both accept an optional `submissionMode` parameter:

- `sync`: require `eth_sendRawTransactionSync`
- `realtime`: require `realtime_sendRawTransaction`
- `sendAndWait`: send the raw transaction through the standard path and wait for the receipt by hash

When the flow needs to broadcast a transaction, set `submissionMode`
explicitly. The SDK no longer probes submission capabilities automatically.

## Receipt Behavior

`mppx` currently serializes a generic payment receipt header. The SDK keeps the MegaETH request and credential wire format aligned to the draft spec, while the receipt remains compatible with the shared `mppx` receipt serializer.

```ts
type ChargeReceipt = {
  method: "megaeth"
  reference: string
  status: "success"
  timestamp: string
  externalId?: string
}
```

`challengeId` remains available in server verification context and problem details, but it is not part of the serialized `Payment-Receipt` header.

## Client Progress Lifecycle

Both `credentialMode: "permit2"` and `credentialMode: "hash"` emit the same user-facing lifecycle stages:

- `challenge`
- `signing`
- `signed`
- `paying`
- `confirming`
- `paid`

## Error Style

All server failures are intentionally instructive. The caller should learn what to do next, for example:

- approve Permit2 before retrying
- request a fresh challenge before retrying
- use the configured chain ID and recipient before retrying
- switch back to `credentialMode: "permit2"` when the server sponsors gas

The verification layer maps those failures onto `mppx.Errors.*` problem-details classes so callers can inspect both the human-readable detail and the RFC 9457 `type` URI.
