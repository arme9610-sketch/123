import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['public/app.js', 'server.mjs', ...readdirSync('lib').filter(name => name.endsWith('.mjs')).map(name => `lib/${name}`)];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked: ${files.length} files`);
