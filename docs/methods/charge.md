# MegaETH Charge

## Modes

### Direct Permit2

- Client signs Permit2 typed data.
- Server validates the challenge, signature, token, amount, splits, and source DID.
- Server broadcasts the Permit2 transaction from the settlement wallet.
- This mode is the fee-sponsored flow.

### Broadcast Hash

- Client signs Permit2 typed data.
- Client broadcasts the Permit2 transaction itself.
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
    testnet?: boolean
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

## Receipt Behavior

`mppx` currently serializes a generic payment receipt header. The SDK keeps the MegaETH request and credential wire format aligned to the draft spec, while the receipt remains compatible with the shared `mppx` receipt serializer.

The serialized receipt shape in v1 is:

```ts
type ChargeReceipt = {
  method: 'megaeth'
  reference: string
  status: 'success'
  timestamp: string
  externalId?: string
}
```

`challengeId` remains available in server verification context and RFC 9457 problem details, but it is not part of the serialized `Payment-Receipt` header.

## Client Progress Lifecycle

Both direct Permit2 mode and broadcast `hash` mode now emit the same user-facing lifecycle stages:

- `challenge`
- `signing`
- `signed`
- `paying`
- `confirming`
- `paid`

## Error Style

All server failures are written to be instructive. They should tell the caller what to fix next, for example:

- approve Permit2 before retrying
- request a fresh challenge before retrying
- use the requested recipient and amount ordering before retrying
- disable broadcast mode when the server sponsors gas

The verification layer maps those failures onto `mppx.Errors.*` problem-details classes so callers can inspect both the human-readable detail and the RFC 9457 `type` URI.
