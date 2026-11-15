#!/usr/bin/env node
// Guarded disposable-database run for the auth/workspace tests.
//
// Creates a throwaway PostgreSQL container on 127.0.0.1:55432, applies every
// migration, runs scripts/db-verify.sql, runs the tests, then removes the
// container. It refuses any URL that is not the disposable database, so it
// cannot touch the development database on port 5433.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const container = "mindlinx-auth-test";
const databaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://test:test@127.0.0.1:55432/mindlinx_test";

const url = new URL(databaseUrl);
const databaseName = url.pathname.replace(/^\//, "");
const disposable =
  ["127.0.0.1", "localhost"].includes(url.hostname) &&
  url.port === "55432" &&
  databaseName === "mindlinx_test";
if (!disposable) {
  console.error(
    `Refusing to run: TEST_DATABASE_URL must be 127.0.0.1:55432/mindlinx_test (got ${url.hostname}:${url.port}/${databaseName})`,
  );
  process.exit(1);
}

function removeContainer() {
  spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.status !== 0) {
    removeContainer();
    process.exit(result.status ?? 1);
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: "test-only-secret-0123456789abcdef0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3000",
};

removeContainer();
try {
  console.log("== disposable database ==");
  run("docker", [
    "run", "-d", "--name", container,
    "-e", "POSTGRES_USER=test",
    "-e", "POSTGRES_PASSWORD=test",
    "-e", "POSTGRES_DB=mindlinx_test",
    "-p", "127.0.0.1:55432:5432",
    "--tmpfs", "/var/lib/postgresql/data:rw",
    "postgres:16-alpine",
  ]);

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = spawnSync(
      "docker",
      ["exec", container, "pg_isready", "-U", "test", "-d", "mindlinx_test"],
      { stdio: "ignore" },
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    sleep(1000);
  }
  if (!ready) throw new Error("PostgreSQL did not become ready");

  console.log("== migrations ==");
  // Same binary as `pnpm db:migrate`, without a shell so args are never re-parsed.
  run(process.execPath, [join(root, "node_modules", "drizzle-kit", "bin.cjs"), "migrate"], { env });

  console.log("== schema verification ==");
  run(
    "docker",
    ["exec", "-i", container, "psql", "-U", "test", "-d", "mindlinx_test", "-v", "ON_ERROR_STOP=1"],
    { input: readFileSync(join(root, "scripts", "db-verify.sql")), stdio: ["pipe", "inherit", "inherit"] },
  );

  console.log("== tests ==");
  run(process.execPath, [
    "--conditions=react-server",
    "--import", "tsx",
    "--test",
    "tests/auth-context.test.ts",
    "tests/workspace-route.test.ts",
    "tests/business-profile.test.ts",
    "tests/business-profile-route.test.ts",
  ], { env });
} finally {
  removeContainer();
}
