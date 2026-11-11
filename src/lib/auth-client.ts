"use client";

import { createAuthClient } from "better-auth/react";

// No baseURL: Better Auth resolves the same-origin `/api/auth` path in the
// browser, so no server-only environment values are exposed to the client.
export const authClient = createAuthClient();
