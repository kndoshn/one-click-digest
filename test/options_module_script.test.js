import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("options page loads options/index.js as a module", () => {
  const htmlPath = path.join(process.cwd(), "dist", "options.html");
  assert.ok(fs.existsSync(htmlPath), "dist/options.html must exist (run build first)");
  const html = fs.readFileSync(htmlPath, "utf-8");

  // If options/index.js uses ESM imports, options.html must load it as type=module.
  assert.match(html, /<script[^>]*type=\"module\"[^>]*src=\"options\/index\.js\"/);
});
