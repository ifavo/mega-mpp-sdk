# MegaETH Demo

The demo pairs a lightweight Express server with a React + Vite client.

## Install

```bash
pnpm demo:install
```

## Run

```bash
pnpm build
pnpm demo:server
pnpm demo:app
```

## Routes

- `GET /api/v1/health`
- `GET /api/v1/config`
- `GET /api/v1/charge/basic`
- `GET /api/v1/charge/splits`

The UI consumes those endpoints and uses `mega-mpp-sdk/client` to satisfy any `402 Payment Required` challenge.
