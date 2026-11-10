# MindLinx

AI-powered autonomous customer acquisition platform.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19
- TypeScript
- Tailwind CSS v4
- Node.js 24
- pnpm 12.18.0 — pinned via `packageManager` and Corepack, no global install needed

## Commands

| Command                  | Description                              |
| ------------------------ | ---------------------------------------- |
| `pnpm dev`               | Dev server on http://localhost:3000      |
| `pnpm build`             | Production build                         |
| `pnpm start`             | Serve the production build               |
| `pnpm lint`              | ESLint                                   |
| `pnpm exec tsc --noEmit` | Type check                               |

On a fresh machine, run `corepack enable` once. Corepack reads `packageManager`
from `package.json` and uses exactly pnpm 12.18.0 in this folder.

## Structure

```
src/app/    App Router routes, root layout, global styles
```

## Not installed yet

PostgreSQL, Drizzle ORM, Better Auth, Inngest and the OpenAI SDK are added in
later steps, once this foundation is reviewed.
