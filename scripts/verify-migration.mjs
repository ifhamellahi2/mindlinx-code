// Guards the hand-edited composite SET NULL constraints in drizzle/*.sql.
// Drizzle regenerates `ON DELETE set null` without a column list, which is
// invalid for a composite FK (it would try to null workspace_id too).
// Run after every `pnpm db:generate`.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../drizzle/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

const failures = [];
for (const file of files) {
  const sql = readFileSync(join(dir, file), "utf8");
  for (const match of sql.matchAll(/FOREIGN KEY \(([^)]*)\)[\s\S]*?;/gi)) {
    const statement = match[0];
    const columns = match[1].split(",").map((c) => c.trim());
    if (columns.length < 2 || !/ON DELETE SET NULL/i.test(statement)) continue;
    const scoped = /ON DELETE SET NULL\s*\(\s*"?([a-z_]+)"?\s*\)/i.exec(statement);
    if (!scoped) {
      failures.push(`${file}: composite FK has a bare SET NULL: ${statement.split("\n")[0]}`);
    } else if (!columns.includes(`"${scoped[1]}"`)) {
      failures.push(`${file}: SET NULL ("${scoped[1]}") is not one of the FK columns`);
    }
  }
}

if (failures.length > 0) {
  console.error("Migration guard failed:\n" + failures.join("\n"));
  console.error(
    '\nFix: change `ON DELETE set null` to `ON DELETE SET NULL ("<column>")` for the nullable column only.',
  );
  process.exit(1);
}

console.log(`Migration guard passed: ${files.length} file(s) checked.`);
