// Headless Chromium first visual pass. Run: node tests/screenshot.mjs
// Serves the repo locally, opens game.html, saves tests/out/setup.png, clicks
// "Random battle" and saves tests/out/battle-*.png a few seconds apart.
// Fails on any page error or console error. The human still does the real look.
//
// Needs Playwright (preinstalled globally in Claude Code web sessions). If the
// three.js CDN is unreachable, three is fetched once from the npm registry into
// tests/.cache and served in its place. Math.random is seeded, so the random
// battle is the same every run.

import { createServer } from 'node:http';
import { readFile, mkdir, access } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'tests/out');
const CACHE = path.join(ROOT, 'tests/.cache');
const THREE_VERSION = '0.160.0'; // keep in step with game.html's import map
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`;
const SHOTS_AT = [3000, 8000]; // ms after clicking Random battle

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const globalRoot = execSync('npm root -g').toString().trim();
  return createRequire(path.join(globalRoot, 'noop.js'))('playwright');
}

async function threeFromCache(rest) {
  const dir = path.join(CACHE, `three-${THREE_VERSION}`);
  try { await access(dir); } catch {
    await mkdir(dir, { recursive: true });
    const tgz = execSync(`npm pack three@${THREE_VERSION} --silent`, { cwd: dir }).toString().trim();
    execSync(`tar -xzf ${tgz} && rm ${tgz}`, { cwd: dir });
  }
  return readFile(path.join(dir, 'package', rest));
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/game.html`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  let usedCache = false;
  await page.route(`${CDN}**`, async route => {
    try {
      const response = await route.fetch();
      if (!response.ok()) throw new Error(`CDN ${response.status()}`);
      await route.fulfill({ response });
    } catch {
      usedCache = true;
      const body = await threeFromCache(route.request().url().slice(CDN.length));
      await route.fulfill({ body, contentType: 'text/javascript' });
    }
  });
  await page.addInitScript(() => {
    let s = 0x2f6e2b1;
    Math.random = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0) >>> 0) / 4294967296;
  });

  await mkdir(OUT, { recursive: true });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT, 'setup.png'), fullPage: true });

  await page.getByRole('button', { name: 'Random battle' }).click();
  await page.waitForSelector('#viewport canvas', { timeout: 15000 });
  let last = 0;
  for (const [i, at] of SHOTS_AT.entries()) {
    await page.waitForTimeout(at - last); last = at;
    await page.locator('#viewport').screenshot({ path: path.join(OUT, `battle-${i + 1}.png`) });
  }
  const log = await page.locator('#log').textContent();
  console.log(log.split('\n').filter(l => /Random battle|fielded|Determinism|Live match/.test(l)).join('\n'));
  if (!/Determinism check .*PASS/.test(log)) errors.push('in-page determinism check did not PASS');
  if (usedCache) console.log('(three.js CDN unreachable; served from npm cache)');
  console.log(`screenshots: ${path.relative(ROOT, OUT)}/setup.png, battle-1..${SHOTS_AT.length}.png`);
} catch (e) {
  errors.push(e.stack || String(e));
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.log(`FAIL\n  ${errors.join('\n  ')}`); exitCode = 1; }
else console.log('ok   no page or console errors');
process.exit(exitCode);
