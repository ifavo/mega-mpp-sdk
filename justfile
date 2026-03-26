set shell := ["bash", "-uc"]

default:
    @just --list

contracts-build:
    forge build --root contracts

contracts-test:
    forge test --root contracts

contracts-verify:
    ./contracts/script/verify-session-escrow.sh

ts-install:
    cd typescript && pnpm install

ts-build:
    cd typescript && pnpm build

ts-typecheck:
    cd typescript && pnpm typecheck

ts-test:
    cd typescript && pnpm test

ts-test-integration:
    cd typescript && pnpm test:integration

ts-test-live:
    cd typescript && pnpm test:live

ts-lint:
    cd typescript && pnpm lint && pnpm format:check

ts-audit:
    cd typescript && pnpm audit --prod --audit-level high

demo-install:
    pnpm demo:install

demo-build:
    pnpm demo:build

demo-typecheck:
    pnpm demo:typecheck

demo-test:
    pnpm demo:test

release-prep: contracts-test ts-typecheck ts-lint ts-test ts-test-integration ts-build demo-typecheck demo-test demo-build ts-audit

build: contracts-build ts-build demo-build

test: contracts-test ts-test ts-test-integration demo-test

pre-commit: contracts-test ts-typecheck ts-lint ts-test ts-test-integration ts-build demo-typecheck
