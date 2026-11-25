// Renders scripts/og-image.html to public/og.png (1200×630), the picture link previews show.
// Needs Google Chrome installed. Run: node scripts/og-image.mjs
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
execFileSync(chrome, [
  '--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630',
  '--virtual-time-budget=4000', `--screenshot=${join(root, 'public', 'og.png')}`,
  pathToFileURL(join(root, 'scripts', 'og-image.html')).href,
], { stdio: 'inherit' });
console.log('Wrote public/og.png');
