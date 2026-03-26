# MegaETH Session

## Model

`session` uses an escrow-backed Tempo-style voucher channel:

- the payer opens an on-chain escrow channel
- the payer or delegated signer signs cumulative EIP-712 vouchers
- the server accepts vouchers, settles periodically, and closes cooperatively

The serialized `Payment-Receipt` header stays `mppx`-compatible in v1. Richer channel state is returned separately by the SDK and demo.

## Request Shape

```ts
type SessionRequest = {
  amount: string // price per unit in base units
  currency: `0x${string}`
  recipient: `0x${string}`
  description?: string
  externalId?: string
  suggestedDeposit?: string
  unitType?: string
  methodDetails: {
    chainId?: number
    testnet?: boolean
    escrowContract?: `0x${string}`
    channelId?: `0x${string}`
    minVoucherDelta?: string
  }
}
```

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

Breaking cleanup in `0.2.0`:

- `managementOnly` was removed from the public session context
- use `authorizeCurrentRequest: false` instead when a top-up should not authorize the current request

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

The default `session({ store })` path treats channel persistence as single-process. For multi-instance runtimes, pass `channelStore` with cross-instance atomic update semantics instead of relying on the built-in JSON-store helper.

Inline periodic settlement runs after voucher acceptance when either threshold is met:

- `acceptedCumulative - settled >= minUnsettledAmount`
- `now - lastSettlementAt >= intervalSeconds`

## Escrow Contract

The repository ships an upgradeable `MegaMppSessionEscrow` contract in [contracts/src/MegaMppSessionEscrow.sol](/Users/m/workspace/mega-mpp-sdk/contracts/src/MegaMppSessionEscrow.sol).

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

On MegaETH, include `--skip-simulation` when you deploy with Foundry. The deployment flow should target the live broadcast path directly.

Verification helper:

```bash
export SESSION_ESCROW_IMPLEMENTATION='0x...'
export SESSION_ESCROW_PROXY='0x...'
export SESSION_ESCROW_OWNER='0x...'
export SESSION_ESCROW_CLOSE_DELAY=86400
export SESSION_ESCROW_VERIFIER_URL='https://your-blockscout-or-etherscan-api'

pnpm contracts:verify
```

Deployment and operations checklist:

- use the proxy address in `MEGAETH_SESSION_ESCROW_ADDRESS`, never the implementation address
- `SESSION_ESCROW_OWNER` controls upgrades through UUPS, so production deployments should use a multisig or dedicated admin account
- `SESSION_ESCROW_CLOSE_DELAY` defines the forced-close withdrawal window after `requestClose`
- only the configured payee can call `settle` and `close`, so keep the server settlement wallet aligned with the payee you intend to use
- session deposits require a direct ERC-20 approval to the escrow contract; Permit2 approval does not apply here
- avoid fee-on-transfer or rebasing tokens because the escrow accounting assumes exact transfer amounts
- redeploying the escrow changes the channel namespace because `computeChannelId` includes both `block.chainid` and the escrow contract address

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
