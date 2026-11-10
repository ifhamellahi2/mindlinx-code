import "server-only";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import { env } from "@/lib/env.server";
import { provisionInitialWorkspace } from "@/lib/workspace-provisioning";

// Better Auth owns session/account/verification. `users` is the existing
// identity table, so it is mapped rather than duplicated.
export const auth = betterAuth({
  appName: "MindLinx",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    // Sign-up writes user + account + session; keep them atomic.
    transaction: true,
  }),
  user: {
    modelName: "users",
  },
  advanced: {
    database: {
      // Every auth id column is uuid; Better Auth's default generator emits a
      // 32-char string, which PostgreSQL rejects.
      generateId: "uuid",
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh at most once per day
  },
  trustedOrigins: [env.BETTER_AUTH_URL],
  databaseHooks: {
    user: {
      create: {
        // Better Auth 1.7.18 queues `after` hooks until the sign-up transaction
        // has committed, so this can open its own transaction without touching
        // uncommitted rows.
        after: async (user) => {
          try {
            await provisionInitialWorkspace(user.id);
          } catch (error) {
            // The account is already committed. Failing the request would leave
            // a stranded account with a taken email; POST /api/workspace/ensure
            // retries on demand instead.
            const name = error instanceof Error ? error.name : "UnknownError";
            if (process.env.NODE_ENV === "production") {
              // Never log driver errors: they can carry query text and bound values.
              console.error("[auth] initial workspace provisioning failed", { userId: user.id, error: name });
            } else {
              console.error("[auth] initial workspace provisioning failed", { userId: user.id, error });
            }
          }
        },
      },
    },
  },
  // Must stay last: it reads the cookies Next.js set during the request.
  plugins: [nextCookies()],
});
