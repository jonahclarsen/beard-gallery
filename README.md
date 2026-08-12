# Beard Gallery

A minimal, horizontally-scrolling beard-day photo gallery running on Cloudflare Workers.

## Storage

- D1: photo metadata and permanent votes
- Workers KV: converted WebP photos
- Durable Object WebSockets: live vote result updates

## Local development

Copy `.dev.vars.example` to `.dev.vars`, fill in the secrets, then:

```sh
pnpm install
pnpm db:local
pnpm build
pnpm exec wrangler dev
```

Open `http://localhost:8787`. The admin is at `/admin`.

## Secrets

Production requires `ADMIN_PASSWORD` and `VOTER_SECRET` Wrangler secrets. Never commit either value.
