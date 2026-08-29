// collect-def.js <module-dir> <defName> — remove one top-level
// definition from a module's source (kernel-only, decision-directed).
// Refuses when the def is absent or ambiguous. Run from a workspace
// root (vendored typescript resolvable).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.join(process.cwd(), 'noop.js'));
const ts = require(path.join(process.cwd(), 'node_modules/typescript/lib/typescript.js'));

const [dir, name] = process.argv.slice(2);
if (!dir || !name) { console.error('usage: collect-def.js <module-dir> <defName>'); process.exit(1); }
const hits = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.d.ts')).sort()) {
  const full = path.join(dir, f);
  const src = fs.readFileSync(full, 'utf8');
  const sf = ts.createSourceFile(full, src, ts.ScriptTarget.ES2022, true);
  for (const st of sf.statements) {
    let declared = null;
    if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
      const d = st.declarationList.declarations[0];
      if (ts.isIdentifier(d.name)) declared = d.name.text;
    } else if ((ts.isFunctionDeclaration(st) || ts.isTypeAliasDeclaration(st) ||
                ts.isInterfaceDeclaration(st)) && st.name) {
      declared = st.name.text;
    }
    if (declared === name) hits.push({ full, src, start: st.getFullStart(), end: st.getEnd() });
  }
}
if (hits.length === 0) { console.error(`collect-def: '${name}' not found in ${dir}`); process.exit(1); }
if (hits.length > 1) { console.error(`collect-def: '${name}' ambiguous (${hits.length} declarations)`); process.exit(1); }
const { full, src, start, end } = hits[0];
let tail = end;
while (tail < src.length && (src[tail] === '\n' || src[tail] === '\r')) tail++;
fs.writeFileSync(full, src.slice(0, start) + src.slice(tail));
console.log(`collected ${name} from ${full}`);
