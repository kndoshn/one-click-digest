import fs from "node:fs";
import path from "node:path";

const distDir = path.join(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
  console.log("[clean] removed dist/");
} else {
  console.log("[clean] dist/ not found (noop)");
}
