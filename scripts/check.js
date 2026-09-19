import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'artifacts', 'test-results', 'playwright-report'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.status !== 0) process.exitCode = 1;
    } else if (/\.tsx?$/.test(entry.name)) {
      console.error(`Unexpected TypeScript project source: ${file}`);
      process.exitCode = 1;
    }
  }
}
await check('.');
if (!process.exitCode) console.log('Project JavaScript syntax and JavaScript-only source check passed.');
