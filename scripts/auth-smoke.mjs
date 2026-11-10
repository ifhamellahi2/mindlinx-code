#!/usr/bin/env node
// Read-only smoke test for the Better Auth route. Requires a running server
// (pnpm build && pnpm start). It never creates users, never prints secrets,
// session tokens or cookies.
const base = (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");

let failures = 0;
function check(name, passed, detail = "") {
  if (!passed) failures++;
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// The default sign-in/sign-up limit is 3 requests per 10s per IP, so retry once
// when a previous run consumed the window.
async function request(path, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(base + path, init);
    if (res.status !== 429 || attempt === 1) return res;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

const post = (body, origin = base) => ({
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify(body),
});

try {
  const ok = await request("/api/auth/ok");
  check("GET /api/auth/ok → 200 {ok:true}", ok.status === 200 && (await ok.json())?.ok === true);

  const session = await request("/api/auth/get-session");
  check("GET /api/auth/get-session → 200 null", session.status === 200 && (await session.json()) === null);
  check(
    "GET /api/auth/get-session → cache-control no-store",
    (session.headers.get("cache-control") || "").includes("no-store"),
  );

  const forged = await request("/api/auth/get-session", {
    headers: { cookie: "better-auth.session_token=not-a-real-token" },
  });
  check("GET /api/auth/get-session (forged cookie) → 200 null", forged.status === 200 && (await forged.json()) === null);

  const missing = await request("/api/auth/does-not-exist");
  check("GET /api/auth/does-not-exist → 404", missing.status === 404);

  const badLogin = await request(
    "/api/auth/sign-in/email",
    post({ email: "nobody@example.invalid", password: "wrong-password-123" }),
  );
  check(
    "POST /api/auth/sign-in/email (bad credentials) → 401",
    badLogin.status === 401 && (await badLogin.json())?.code === "INVALID_EMAIL_OR_PASSWORD",
  );

  const shortPassword = await request(
    "/api/auth/sign-up/email",
    post({ email: "shortpw@example.invalid", password: "1234567", name: "Short Pw" }),
  );
  check(
    "POST /api/auth/sign-up/email (7-char password) → 400 PASSWORD_TOO_SHORT",
    shortPassword.status === 400 && (await shortPassword.json())?.code === "PASSWORD_TOO_SHORT",
  );

  // A 7-char password keeps this read-only even if the origin check regressed.
  const evilOrigin = await request(
    "/api/auth/sign-up/email",
    post({ email: "evil@example.invalid", password: "1234567", name: "Evil" }, "http://evil.example"),
  );
  check(
    "POST /api/auth/sign-up/email (untrusted Origin) → 403 INVALID_ORIGIN",
    evilOrigin.status === 403 && (await evilOrigin.json())?.code === "INVALID_ORIGIN",
  );
} catch (error) {
  failures++;
  console.log(`FAIL  request error — ${error instanceof Error ? error.message : String(error)}`);
  console.log(`Is the server running at ${base}?`);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
