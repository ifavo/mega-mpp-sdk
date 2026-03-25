set shell := ["bash", "-uc"]

default:
    @just --list

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

release-prep: ts-typecheck ts-lint ts-test ts-test-integration ts-build demo-build ts-audit

build: ts-build demo-build

test: ts-test ts-test-integration

pre-commit: ts-typecheck ts-lint ts-test ts-test-integration ts-build
