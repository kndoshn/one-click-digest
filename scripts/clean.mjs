import fs from 'node:fs';
import path from 'node:path';

for (const dir of ['dist', 'build']) {
  const abs = path.join(process.cwd(), dir);
  if (fs.existsSync(abs)) {
    fs.rmSync(abs, { recursive: true, force: true });
    console.log(`[clean] removed ${dir}/`);
  }
}
