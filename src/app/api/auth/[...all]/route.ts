import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// Better Auth serves every endpoint under /api/auth/*. The instance lives in
// src/lib/auth.ts; this file only wires it into the App Router.
export const { GET, POST } = toNextJsHandler(auth);
