import "server-only";

// Server-only entry point. Import this from application code; drizzle.config.ts
// imports the pure `./env` module instead because drizzle-kit runs outside Next.
export { env } from "./env";
