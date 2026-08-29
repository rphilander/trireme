// wave.js — supersession waves: plan / apply / verify.
//   plan   <module> <declFile>   analyze; report frontier + mechanical set
//   apply  <module> <declFile>   generate successors + migrated estate in-world
//   verify <module> <declFile>   reconstruct pre-state, re-derive, byte-compare
// Run from a workspace root. Declarations: lines `SUPERSEDE: <old> -> <new>`.
// The frontier is DISCOVERED: a generated caller that fails tsc names
// its predecessor as still needing a hand-authored successor.
// derive() is a pure function of the pre-apply workspace — plan, apply,
// and admission verification all share it, so mechanical parts are
// checkable byte-for-byte.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [cmd, MOD, DECL] = process.argv.slice(2);
const die = (m) => { console.error(`wave: ${m}`); process.exit(1); };
if (!cmd || !MOD || !DECL) die('usage: wave.js plan|apply|verify <module> <declFile>');
const W = process.cwd();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SLUG = path.basename(DECL).replace(/\.md$/, '').replace(/[^a-z0-9-]/gi, '-').toLowerCase();

const derive = (root) => {
  const RENAME = path.join(root, 'platform/wave/rename.js');
  const declText = fs.readFileSync(path.join(root, DECL), 'utf8');
  const seeds = {};
  for (const ln of declText.split('\n')) {
    const m = ln.match(/^SUPERSEDE:\s*([A-Za-z0-9_]+)\s*->\s*([A-Za-z0-9_]+)\s*$/);
    if (m) seeds[m[1]] = m[2];
  }
  if (!Object.keys(seeds).length) die(`no SUPERSEDE lines in ${DECL}`);
  const ledger = JSON.parse(execFileSync('node', ['platform/ledger/ledger.js', `modules/${MOD}`],
    { cwd: root, encoding: 'utf8' }));
  const defs = ledger.modules[MOD]?.definitions ?? {};
  for (const [oldN, newN] of Object.entries(seeds)) {
    if (!defs[oldN]) die(`SUPERSEDE source '${oldN}' is not a published def in ${MOD}`);
    if (!defs[newN]) die(`successor '${newN}' not found — author it before planning the wave`);
  }
  const callers = {};
  for (const [n, info] of Object.entries(defs)) {
    for (const r of info.refs ?? []) {
      const m = r.match(new RegExp(`^${MOD}#(.+)$`));
      if (m) (callers[m[1]] ??= []).push(n);
    }
  }
  const successors = new Set(Object.values(seeds));
  const closure = new Set();
  const queue = Object.keys(seeds);
  while (queue.length) {
    const cur = queue.shift();
    for (const c of callers[cur] ?? []) {
      if (seeds[c] !== undefined || successors.has(c) || closure.has(c)) continue;
      closure.add(c); queue.push(c);
    }
  }
  // locate defs + record source order so appended clones preserve it
  const srcFiles = fs.readdirSync(path.join(root, `modules/${MOD}`))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).sort();
  const loc = {};
  for (const f of srcFiles) {
    const text = fs.readFileSync(path.join(root, `modules/${MOD}/${f}`), 'utf8');
    for (const n of closure) {
      if (loc[n]) continue;
      const m = text.match(new RegExp(`(?:^|\\n)(?:export\\s+)?(?:const|function|type|interface)\\s+${n}\\b`));
      if (m) loc[n] = { file: f, pos: m.index };
    }
  }
  for (const n of closure) if (!loc[n]) die(`cannot locate source file for def '${n}'`);
  const taken = new Set(Object.keys(defs));
  const swap = { ...seeds };
  const ordered = [...closure].sort((a, b) =>
    loc[a].file.localeCompare(loc[b].file) || loc[a].pos - loc[b].pos);
  for (const n of ordered) {
    const base = n.replace(/\d+$/, '');
    const cur = n.match(/(\d+)$/);
    let i = cur ? Number(cur[1]) + 1 : 2;
    while (taken.has(base + i)) i++;
    taken.add(base + i);
    swap[n] = base + i;
  }
  // generated blocks with per-def spans (for frontier mapping)
  const blocks = {}; const spans = {};
  for (const n of ordered) {
    const f = loc[n].file;
    const out = execFileSync('node', [RENAME, 'def', path.join(root, `modules/${MOD}/${f}`), n, JSON.stringify(swap)],
      { cwd: root, encoding: 'utf8' });
    const piece = `\n// wave:${SLUG} — mechanical successor of ${n}\n` + out;
    const prev = blocks[f] ?? '';
    (spans[f] ??= []).push({ def: n, fromLine: prev.split('\n').length, toLine: (prev + piece).split('\n').length });
    blocks[f] = prev + piece;
  }
  // estate migration keys off exported swaps
  const exportSwap = {};
  for (const [oldN, newN] of Object.entries(swap)) if (defs[oldN]?.exported) exportSwap[oldN] = newN;
  const migrated = {};
  const testDir = path.join(root, `modules/${MOD}/test`);
  if (fs.existsSync(testDir) && Object.keys(exportSwap).length) {
    const estate = [];
    const walkd = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkd(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) estate.push(p);
    } };
    walkd(testDir);
    const touches = (p) => {
      const t = fs.readFileSync(p, 'utf8');
      return Object.keys(exportSwap).some((n) => new RegExp(`\\b${n}\\b`).test(t));
    };
    const migSrc = estate.filter(touches).sort();
    const migName = (p) => p.endsWith('.test.ts')
      ? p.replace(/\.test\.ts$/, `.${SLUG}.test.ts`) : p.replace(/\.ts$/, `.${SLUG}.ts`);
    for (const p of migSrc) {
      let out = execFileSync('node', [RENAME, 'file', p, JSON.stringify(exportSwap)], { cwd: root, encoding: 'utf8' });
      for (const q of migSrc) {
        if (q === p) continue;
        for (const pre of ['./', '../']) {
          const from = pre + path.basename(q).replace(/\.ts$/, '.js');
          const to = pre + path.basename(migName(q)).replace(/\.ts$/, '.js');
          out = out.split(from).join(to);
        }
      }
      migrated[path.relative(root, migName(p))] = out;
    }
  }
  return { seeds, swap, ordered, loc, blocks, spans, exportSwap, migrated };
};

const applyInto = (root, d) => {
  const pre = {}; const preLines = {};
  for (const [f, block] of Object.entries(d.blocks)) {
    const fp = path.join(root, `modules/${MOD}/${f}`);
    const text = fs.readFileSync(fp, 'utf8');
    pre[f] = text.length; preLines[f] = text.split('\n').length;
    fs.rmSync(fp); fs.writeFileSync(fp, text + block); // break hardlinks
  }
  for (const [rel, content] of Object.entries(d.migrated)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return { pre, preLines };
};

if (cmd === 'plan') {
  const d = derive(W);
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-'));
  execFileSync('cp', ['-al', W + '/.', path.join(T, 'w')]);
  const TW = path.join(T, 'w');
  const { preLines } = applyInto(TW, d);
  let tsc = '';
  try { execFileSync('node', ['node_modules/typescript/lib/tsc.js', '-p', 'tsconfig.json', '--noEmit'],
    { cwd: TW, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { tsc = String(e.stdout ?? ''); }
  fs.rmSync(T, { recursive: true, force: true });
  const report = { decl: DECL, slug: SLUG, seeds: d.seeds,
    mechanical: d.ordered.map((n) => ({ def: n, successor: d.swap[n], file: d.loc[n].file })),
    exportSwap: d.exportSwap, migratedEstate: Object.keys(d.migrated) };
  if (tsc.trim()) {
    const frontier = new Set();
    for (const ln of tsc.split('\n')) {
      const m = ln.match(new RegExp(`modules/${MOD}/([^(]+)\\((\\d+),`));
      if (!m) continue;
      const [, f, L] = m; const line = Number(L);
      const base = preLines[f] ?? Infinity;
      for (const s of d.spans[f] ?? []) {
        if (line > base + s.fromLine - 1 && line <= base + s.toLine) frontier.add(s.def);
      }
    }
    report.frontier = [...frontier];
    report.tscErrors = tsc.trim().split('\n').slice(0, 20);
    console.log(JSON.stringify(report, null, 1));
    console.error(`wave plan: INCOMPLETE — hand-authored successors needed for: ${[...frontier].join(', ') || '(see tscErrors)'}`);
    process.exit(1);
  }
  report.status = 'clean';
  console.log(JSON.stringify(report, null, 1));
} else if (cmd === 'apply') {
  const d = derive(W);
  const { pre } = applyInto(W, d);
  const manifest = { decl: DECL, slug: SLUG, seeds: d.seeds, swap: d.swap, preSizes: pre,
    generated: Object.fromEntries(Object.entries(d.blocks).map(([f, b]) => [f, sha(b)])),
    migratedHashes: Object.fromEntries(Object.entries(d.migrated).map(([rel, c]) => [rel, sha(c)])) };
  const mp = path.join(W, `modules/${MOD}/supersessions/${SLUG}.manifest.json`);
  fs.mkdirSync(path.dirname(mp), { recursive: true });
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 1));
  console.log(`wave applied: ${d.ordered.length} mechanical successor(s), ${Object.keys(d.migrated).length} migrated estate file(s); manifest ${path.relative(W, mp)}`);
} else if (cmd === 'verify') {
  const mp = path.join(W, `modules/${MOD}/supersessions/${SLUG}.manifest.json`);
  if (!fs.existsSync(mp)) die(`no manifest for ${SLUG} — run wave apply before delivering`);
  const man = JSON.parse(fs.readFileSync(mp, 'utf8'));
  // reconstruct the pre-apply state in a temp copy, re-derive, compare
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-'));
  execFileSync('cp', ['-al', W + '/.', path.join(T, 'w')]);
  const TW = path.join(T, 'w');
  for (const [f, size] of Object.entries(man.preSizes)) {
    const fp = path.join(TW, `modules/${MOD}/${f}`);
    const text = fs.readFileSync(fp, 'utf8');
    if (text.length < size) die(`source ${f} is shorter than its pre-apply size — delivery inconsistent`);
    fs.rmSync(fp); fs.writeFileSync(fp, text.slice(0, size));
  }
  for (const rel of Object.keys(man.migratedHashes)) fs.rmSync(path.join(TW, rel), { force: true });
  fs.rmSync(path.join(TW, `modules/${MOD}/supersessions/${SLUG}.manifest.json`), { force: true });
  let ok = true; const errs = [];
  const d2 = derive(TW);
  for (const [f, h] of Object.entries(man.generated)) {
    if (sha(d2.blocks[f] ?? '') !== h) { ok = false; errs.push(`generated block in ${f}`); }
  }
  for (const [rel, h] of Object.entries(man.migratedHashes)) {
    if (sha(d2.migrated[rel] ?? '') !== h) { ok = false; errs.push(`migrated ${rel}`); }
  }
  // and the delivery's actual bytes must match the manifest it carries
  for (const [f, size] of Object.entries(man.preSizes)) {
    const text = fs.readFileSync(path.join(W, `modules/${MOD}/${f}`), 'utf8');
    if (sha(text.slice(size)) !== man.generated[f]) { ok = false; errs.push(`delivered tail of ${f}`); }
  }
  for (const [rel, h] of Object.entries(man.migratedHashes)) {
    if (sha(fs.readFileSync(path.join(W, rel), 'utf8')) !== h) { ok = false; errs.push(`delivered ${rel}`); }
  }
  fs.rmSync(T, { recursive: true, force: true });
  if (!ok) die(`mechanical parts do not match derivation: ${errs.join('; ')}`);
  console.log(`wave verified: ${SLUG} — mechanical parts match derivation`);
} else die(`unknown command: ${cmd}`);
