import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const BAD_PATTERNS = [
  /api\.anthropic\.com/i,
  /authorization\s*:/i,
  /x-api-key/i,
  /anthropic/i,
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test("content/ must not contain Claude API calls or auth headers (scaffold invariant)", () => {
  const dir = path.join(process.cwd(), "src", "content");
  assert.ok(fs.existsSync(dir), "src/content must exist");
  const files = walk(dir).filter((p) => p.endsWith(".ts") || p.endsWith(".js"));
  for (const f of files) {
    const text = fs.readFileSync(f, "utf-8");
    for (const re of BAD_PATTERNS) {
      assert.ok(!re.test(text), `Found forbidden pattern ${re} in ${f}`);
    }
  }
});
