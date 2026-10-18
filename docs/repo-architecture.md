# Monorepo architecture

This project is intentionally structured as a single monorepo.

## Why monorepo

- one product, one deploy flow
- frontend and backend stay in sync through shared contracts
- one CI pipeline and one review gate for the whole repo
- easier onboarding for a small team

We do not split the product into a separate frontend repo, backend repo and common repo unless the team later grows into truly independent delivery units.

## Final repo layout

```text
reaplift-bsp-skeleton/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared/
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── db/
├── infra/
├── docs/
├── .github/
├── .githooks/
├── scripts/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
└── Dockerfile
```

## Shared contract rule

The `packages/shared` package is the source of truth for API and UI contracts.

Use it for:

- request and response types
- enums and status values
- validation schemas
- payload contracts for Meta, webhook and internal messages
- shared constants used by both apps

This prevents the frontend and server from drifting apart after design changes. The rule is simple: if both apps need the same shape, it belongs in `packages/shared`.

## Frontend and backend split

- `apps/web`: React + Vite dashboard and pages
- `apps/server`: Fastify API and workers
- `packages/shared`: common typing and validation

The web app may import `@reaplift/shared` for types and schemas. The server may do the same for incoming payload validation and response shaping.

This gives the team a single source of truth without the complexity of an extra repository layer.
