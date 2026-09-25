// Loads game.html's module script into a Node vm context, section by section.
// No build step and no copies of game code: the sections are sliced out of the
// real file by their banner comments, so the tests always run what ships.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const GAME_PATH = process.env.GAME_HTML || fileURLToPath(new URL('../game.html', import.meta.url));

const BANNER = /^\/\/ ═+\n\/\/ \[(\d+)\] ([^\n]*)\n((?:\/\/[^\n]*\n)*?)\/\/ ═+\n/gm;

// Returns { sections: [{ id, title, exports, code, startLine }], script }
export function readSections(path = GAME_PATH) {
  const html = readFileSync(path, 'utf8');
  const m = html.match(/<script type="module">\n([\s\S]*?)<\/script>/);
  if (!m) throw new Error('game.html: no <script type="module"> block');
  const script = m[1];
  const scriptLine = html.slice(0, m.index).split('\n').length + 1;

  const banners = [...script.matchAll(BANNER)];
  const sections = banners.map((b, i) => {
    const end = i + 1 < banners.length ? banners[i + 1].index : script.length;
    const exportsText = (b[3].match(/\/\/ EXPORTS:([\s\S]*?)(?=\n\/\/ [A-Z]+[ :]|$)/) || [, ''])[1];
    const exports = exportsText.replace(/\/\/|\([^)]*\)/g, ' ')
      .split(/[\s,]+/).filter(n => /^[A-Za-z_$][\w$]*$/.test(n));
    return {
      id: Number(b[1]),
      title: b[2].trim(),
      exports,
      code: script.slice(b.index, end),
      startLine: scriptLine + script.slice(0, b.index).split('\n').length - 1,
    };
  });
  return { sections, script };
}

// Code without comments or string/template contents, for static checks.
export function stripCode(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, "''");
}

export function memoryStorage() {
  const data = new Map();
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    clear: () => data.clear(),
  };
}

// Evaluates the given sections (ids, in file order) in a fresh vm context and
// returns every top-level name they declare, keyed by name. `globals` are the
// only outside names the code can see: leave THREE/document/window out and any
// use of them throws a ReferenceError.
export function loadSections(ids, globals = {}, path = GAME_PATH) {
  const { sections } = readSections(path);
  const picked = sections.filter(s => ids.includes(s.id));
  const code = picked.map(s => s.code).join('');
  const names = new Set();
  const decl = /^(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const d of code.matchAll(decl)) names.add(d[1]);
  for (const d of code.matchAll(/^let\s+([^;=]+?)(?:=|;)/gm)) {
    for (const n of d[1].split(',')) if (/^\s*[A-Za-z_$][\w$]*\s*$/.test(n)) names.add(n.trim());
  }
  const tail = `\n;({${[...names].map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(',')}})`;
  const context = vm.createContext({ console, performance, ...globals });
  const api = vm.runInContext(code + tail, context, {
    filename: 'game.html', lineOffset: picked[0].startLine - 1, // right lines while sections are contiguous
  });
  return { api, context, sections: picked };
}
