/**
 * platform/ledger — the accretion ledger and certificate machinery.
 *
 * Extracts top-level definitions from module directories and computes:
 *  - selfHash: sha256 of the definition's comment-stripped normalized
 *    print — the ACCRETION floor (a surviving name whose selfHash
 *    changed is an illegal edit);
 *  - closureHash: hash over the definition and everything it
 *    references, transitively, across module boundaries (SCCs hashed
 *    as a unit — mutual recursion is legal and common). External
 *    imports (the platform) are stable leaves.
 *  - nodes: AST node count (formatting- and comment-insensitive; the
 *    entropy needle's unit).
 *
 * diffLedgers(old, next) → { added, deleted, modified } where
 * `modified` non-empty = accretion violation.
 *
 * CLI: node ledger.js <module-dir>...            → ledger JSON to stdout
 *      node ledger.js --diff <old.json> <dir>... → diff report; exit 1 on modified
 */
import ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const countNodes = (n) => {
    let c = 1;
    ts.forEachChild(n, (ch) => { c += countNodes(ch); });
    return c;
};
export const computeLedger = (moduleDirs) => {
    const printer = ts.createPrinter({ removeComments: true });
    const dirToModule = new Map();
    for (const [name, dir] of Object.entries(moduleDirs))
        dirToModule.set(path.resolve(dir), name);
    const defs = new Map();
    const moduleTopNames = new Map();
    const files = [];
    for (const [module, dir] of Object.entries(moduleDirs)) {
        moduleTopNames.set(module, new Set());
        const list = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
        for (const f of list.sort()) {
            const full = path.join(dir, f);
            const sf = ts.createSourceFile(full, fs.readFileSync(full, 'utf8'), ts.ScriptTarget.ES2022, true);
            const importRefs = new Map();
            for (const st of sf.statements) {
                if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier))
                    continue;
                const spec = st.moduleSpecifier.text;
                const resolvedDir = spec.startsWith('.')
                    ? path.resolve(path.dirname(full), path.dirname(spec) === '.' ? '.' : path.dirname(spec))
                    : undefined;
                // same-dir relative import → same module; other known module dir → that
                // module; anything else → external leaf
                const targetModule = resolvedDir !== undefined ? dirToModule.get(resolvedDir) : undefined;
                const refFor = (name) => targetModule !== undefined ? `${targetModule}#${name}` : `extern:${spec}#${name}`;
                const c = st.importClause;
                if (!c)
                    continue;
                if (c.name)
                    importRefs.set(c.name.text, refFor('default'));
                if (c.namedBindings) {
                    if (ts.isNamespaceImport(c.namedBindings)) {
                        importRefs.set(c.namedBindings.name.text, refFor('*'));
                    }
                    else {
                        for (const el of c.namedBindings.elements) {
                            importRefs.set(el.name.text, refFor((el.propertyName ?? el.name).text));
                        }
                    }
                }
            }
            files.push({ sf, module, importRefs });
        }
    }
    // pass 1: collect top-level definition names per module
    const topOf = (st) => {
        const exported = ts.canHaveModifiers(st)
            ? (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
            : false;
        if (ts.isFunctionDeclaration(st) && st.name)
            return [{ name: st.name.text, node: st, exported }];
        if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) {
            return [{ name: st.name.text, node: st, exported }];
        }
        if (ts.isVariableStatement(st)) {
            return st.declarationList.declarations
                .filter((d) => ts.isIdentifier(d.name))
                .map((d) => ({ name: d.name.text, node: d, exported }));
        }
        return [];
    };
    for (const { sf, module } of files) {
        for (const st of sf.statements) {
            for (const t of topOf(st))
                moduleTopNames.get(module)?.add(t.name);
        }
    }
    // pass 2: build defs with refs
    for (const { sf, module, importRefs } of files) {
        const top = moduleTopNames.get(module) ?? new Set();
        for (const st of sf.statements) {
            for (const { name, node, exported } of topOf(st)) {
                const key = `${module}#${name}`;
                const refs = new Set();
                const visit = (n) => {
                    if (ts.isIdentifier(n)) {
                        const id = n.text;
                        if (id !== name && top.has(id))
                            refs.add(`${module}#${id}`);
                        const imp = importRefs.get(id);
                        if (imp !== undefined)
                            refs.add(imp);
                    }
                    ts.forEachChild(n, visit);
                };
                visit(node);
                const text = printer.printNode(ts.EmitHint.Unspecified, node, sf);
                defs.set(key, { key, module, name, exported, text, nodes: countNodes(node), refs });
            }
        }
    }
    // pass 3: closure hashes — Tarjan SCC condensation, then DAG-order hashing
    const keys = [...defs.keys()];
    const index = new Map();
    const low = new Map();
    const onStack = new Set();
    const stack = [];
    const sccOf = new Map();
    const sccMembers = new Map();
    let counter = 0;
    let sccCount = 0;
    const strongconnect = (v) => {
        index.set(v, counter);
        low.set(v, counter);
        counter++;
        stack.push(v);
        onStack.add(v);
        for (const w of defs.get(v)?.refs ?? []) {
            if (!defs.has(w))
                continue; // external leaf
            if (!index.has(w)) {
                strongconnect(w);
                low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
            }
            else if (onStack.has(w))
                low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0));
        }
        if (low.get(v) === index.get(v)) {
            const members = [];
            for (;;) {
                const w = stack.pop();
                if (w === undefined)
                    break;
                onStack.delete(w);
                members.push(w);
                if (w === v)
                    break;
            }
            const id = sccCount++;
            for (const m of members)
                sccOf.set(m, id);
            sccMembers.set(id, members.sort());
        }
    };
    for (const k of keys)
        if (!index.has(k))
            strongconnect(k);
    const sccHash = new Map();
    const hashScc = (id) => {
        const done = sccHash.get(id);
        if (done !== undefined)
            return done;
        const members = sccMembers.get(id) ?? [];
        const externalRefs = new Set();
        const childSccs = new Set();
        for (const m of members) {
            for (const r of defs.get(m)?.refs ?? []) {
                if (!defs.has(r)) {
                    externalRefs.add(r);
                    continue;
                }
                const child = sccOf.get(r);
                if (child !== undefined && child !== id)
                    childSccs.add(child);
            }
        }
        const childHashes = [...childSccs].map(hashScc).sort();
        const body = members.map((m) => `${m}\n${defs.get(m)?.text ?? ''}`).join('\n---\n');
        const h = sha([body, ...[...externalRefs].sort(), ...childHashes].join('\n===\n'));
        sccHash.set(id, h);
        return h;
    };
    const modules = {};
    let totalNodes = 0;
    let totalDefs = 0;
    for (const module of Object.keys(moduleDirs))
        modules[module] = { definitions: {}, nodes: 0 };
    for (const d of defs.values()) {
        const scc = sccOf.get(d.key);
        const entry = {
            exported: d.exported,
            nodes: d.nodes,
            selfHash: sha(d.text),
            closureHash: scc !== undefined ? hashScc(scc) : sha(d.text),
            refs: [...d.refs].sort(),
        };
        const m = modules[d.module];
        if (m) {
            m.definitions[d.name] = entry;
            m.nodes += d.nodes;
        }
        totalNodes += d.nodes;
        totalDefs += 1;
    }
    return { modules, totalNodes, totalDefs };
};
export const diffLedgers = (before, after) => {
    const added = [];
    const deleted = [];
    const modified = [];
    const flat = (l) => {
        const out = new Map();
        for (const [m, ml] of Object.entries(l.modules)) {
            for (const [n, e] of Object.entries(ml.definitions))
                out.set(`${m}#${n}`, e);
        }
        return out;
    };
    const a = flat(before);
    const b = flat(after);
    for (const [k, e] of b) {
        const prev = a.get(k);
        if (!prev)
            added.push(k);
        else if (prev.selfHash !== e.selfHash)
            modified.push(k);
    }
    for (const k of a.keys())
        if (!b.has(k))
            deleted.push(k);
    return { added: added.sort(), deleted: deleted.sort(), modified: modified.sort() };
};
// --------------------------------------------------------------------------
const realpathSafe = (p) => { try {
    return fs.realpathSync(p);
}
catch {
    return p;
} };
const isEntry = process.argv[1] !== undefined
    && realpathSafe(path.resolve(process.argv[1])) === realpathSafe(new URL(import.meta.url).pathname);
if (isEntry) {
    const args = process.argv.slice(2);
    const dirsOf = (list) => Object.fromEntries(list.map((d) => [path.basename(path.resolve(d)), d]));
    if (args[0] === '--diff') {
        const oldLedger = JSON.parse(fs.readFileSync(String(args[1]), 'utf8'));
        const next = computeLedger(dirsOf(args.slice(2)));
        const diff = diffLedgers(oldLedger, next);
        console.log(JSON.stringify({ diff, totalNodes: next.totalNodes, totalDefs: next.totalDefs }, null, 1));
        process.exit(diff.modified.length === 0 ? 0 : 1);
    }
    else {
        console.log(JSON.stringify(computeLedger(dirsOf(args)), null, 1));
    }
}
