import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

test("manifest: MV3, no content_scripts, minimal permissions/host_permissions", () => {
  const manifestPath = path.join(process.cwd(), "dist", "manifest.json");
  assert.ok(fs.existsSync(manifestPath), "dist/manifest.json must exist (run build first)");
  const m = readJson(manifestPath);

  assert.equal(m.manifest_version, 3);
  assert.ok(!("content_scripts" in m), "content_scripts must not be present");

  const perms = new Set(m.permissions || []);
  const allowed = new Set(["activeTab", "scripting", "storage"]);
  for (const p of perms) assert.ok(allowed.has(p), `permission not allowed: ${p}`);
  assert.deepEqual([...perms].sort(), [...allowed].sort(), "permissions must match allowlist exactly");

  const hosts = m.host_permissions || [];
  assert.deepEqual(hosts, ["https://api.anthropic.com/*"], "host_permissions must be only api.anthropic.com");

  const war = m.web_accessible_resources || [];
  assert.equal(war.length, 1, "web_accessible_resources must include the i18n messages entry");
  const entry = war[0] || {};
  assert.deepEqual(entry.resources, ["_locales/*/messages.json"], "web_accessible_resources must expose locales");
  assert.deepEqual(entry.matches, ["<all_urls>"], "web_accessible_resources matches must be <all_urls>");
});
