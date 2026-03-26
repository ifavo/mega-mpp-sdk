#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    printf 'Set %s before retrying. Session contract verification needs that value.\n' "$name" >&2
    exit 1
  fi
}

require_env SESSION_ESCROW_IMPLEMENTATION
require_env SESSION_ESCROW_PROXY
require_env SESSION_ESCROW_OWNER
require_env SESSION_ESCROW_CLOSE_DELAY
require_env SESSION_ESCROW_VERIFIER_URL

VERIFIER="${SESSION_ESCROW_VERIFIER:-blockscout}"
COMPILER_VERSION="${SESSION_ESCROW_COMPILER_VERSION:-v0.8.30+commit.73712a01}"
OPTIMIZER_RUNS="${SESSION_ESCROW_OPTIMIZER_RUNS:-200}"

INITIALIZE_DATA="$(
  cast calldata \
    'initialize(address,uint64)' \
    "$SESSION_ESCROW_OWNER" \
    "$SESSION_ESCROW_CLOSE_DELAY"
)"
PROXY_CONSTRUCTOR_ARGS="$(
  cast abi-encode \
    'constructor(address,bytes)' \
    "$SESSION_ESCROW_IMPLEMENTATION" \
    "$INITIALIZE_DATA"
)"

verify_contract() {
  local address="$1"
  local contract_path="$2"
  shift 2

  local -a args=(
    --root "$ROOT_DIR"
    --verifier "$VERIFIER"
    --verifier-url "$SESSION_ESCROW_VERIFIER_URL"
    --compiler-version "$COMPILER_VERSION"
    --num-of-optimizations "$OPTIMIZER_RUNS"
  )

  if [[ -n "${SESSION_ESCROW_VERIFY_API_KEY:-}" ]]; then
    args+=(--etherscan-api-key "$SESSION_ESCROW_VERIFY_API_KEY")
  fi

  forge verify-contract "${args[@]}" "$address" "$contract_path" "$@"
}

verify_contract \
  "$SESSION_ESCROW_IMPLEMENTATION" \
  src/MegaMppSessionEscrow.sol:MegaMppSessionEscrow

verify_contract \
  "$SESSION_ESCROW_PROXY" \
  lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy \
  --constructor-args "$PROXY_CONSTRUCTOR_ARGS"
