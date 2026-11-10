import { z } from "zod";

// Pure module so CLI tooling (drizzle-kit) can import the validated env.
// Application server code should import `@/lib/env.server`, which carries the
// `server-only` guard.

// Server-only variables. Client-exposed values (NEXT_PUBLIC_*) must live in a
// separate module so they can never be imported into a server bundle by mistake.
function isPostgresUrl(value: string) {
  try {
    const { protocol } = new URL(value);
    return protocol === "postgres:" || protocol === "postgresql:";
  } catch {
    return false;
  }
}

function isHttpUrl(value: string) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const serverSchema = z.object({
  DATABASE_URL: z
    .string()
    .refine(isPostgresUrl, "must be a postgres:// or postgresql:// connection string"),
  // Better Auth rejects secrets shorter than 32 characters at runtime, so the
  // failure should happen here with a variable name instead of mid-request.
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  BETTER_AUTH_URL: z
    .string()
    .refine(isHttpUrl, "must be an http:// or https:// URL"),
});

const parsed = serverSchema.safeParse(process.env);

if (!parsed.success) {
  // Zod reports the variable name and reason; it never includes the value.
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid server environment:\n${issues}`);
}

export const env: z.infer<typeof serverSchema> = parsed.data;
