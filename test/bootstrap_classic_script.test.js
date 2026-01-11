import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("dist/content/*.js must be classic-script friendly (no import/export)", () => {
  const dir = path.join(process.cwd(), "dist", "content");
  assert.ok(fs.existsSync(dir), "dist/content must exist (run build first)");

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join(dir, f));

  assert.ok(files.length > 0, "dist/content must contain compiled js files");

  for (const p of files) {
    const text = fs.readFileSync(p, "utf-8");

    // Basic check: MV3 executeScript(files) runs in classic script context.
    assert.ok(!/\bimport\b/.test(text), `${path.basename(p)} must not contain import`);
    assert.ok(!/\bexport\b/.test(text), `${path.basename(p)} must not contain export`);
  }
});
