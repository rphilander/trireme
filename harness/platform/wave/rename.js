// rename.js — mechanical successor generation for supersession waves.
//   def  <file> <defName> <swapJson>  → successor def source on stdout
//   file <file> <swapJson>            → migrated file source on stdout
// Scope-aware: property names/keys and shadowed locals never rename;
// shorthand properties expand ({foo} → {foo: foo2}); `import {a as b}`
// renames only the imported name. Deterministic — admission re-derives
// and byte-compares.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.join(process.cwd(), 'noop.js'));
const ts = require(path.join(process.cwd(), 'node_modules/typescript/lib/typescript.js'));

const [mode, file, ...rest] = process.argv.slice(2);
const die = (m) => { console.error(`rename: ${m}`); process.exit(1); };
if (!mode || !file) die('usage: rename.js def <file> <defName> <swapJson> | file <file> <swapJson>');

const declaredNameOf = (st) => {
  if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
    const d = st.declarationList.declarations[0];
    if (ts.isIdentifier(d.name)) return d.name.text;
  } else if ((ts.isFunctionDeclaration(st) || ts.isTypeAliasDeclaration(st) ||
              ts.isInterfaceDeclaration(st)) && st.name) return st.name.text;
  return null;
};

// does this scope-owning node declare `name` locally?
const declares = (node, name) => {
  const inBinding = (b) => {
    if (!b) return false;
    if (ts.isIdentifier(b)) return b.text === name;
    if (ts.isObjectBindingPattern(b) || ts.isArrayBindingPattern(b))
      return b.elements.some((e) => !ts.isOmittedExpression(e) && inBinding(e.name));
    return false;
  };
  if (ts.isFunctionLike(node)) {
    if (node.parameters.some((p) => inBinding(p.name))) return true;
    if (node.name && ts.isIdentifier(node.name) && node.name.text === name) return true;
  }
  if (ts.isCatchClause(node) && node.variableDeclaration && inBinding(node.variableDeclaration.name)) return true;
  const stmts = ts.isBlock(node) || ts.isSourceFile(node) ? node.statements
    : ts.isCaseClause(node) || ts.isDefaultClause(node) ? node.statements : null;
  if (stmts) {
    for (const st of stmts) {
      if (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => inBinding(d.name))) return true;
      if (ts.isFunctionDeclaration(st) && st.name && st.name.text === name) return true;
    }
  }
  if (ts.isForStatement(node) && node.initializer && ts.isVariableDeclarationList(node.initializer)
      && node.initializer.declarations.some((d) => inBinding(d.name))) return true;
  if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && ts.isVariableDeclarationList(node.initializer)
      && node.initializer.declarations.some((d) => inBinding(d.name))) return true;
  return false;
};
const shadowed = (id, name, stopAt) => {
  for (let n = id.parent; n && n !== stopAt; n = n.parent) if (declares(n, name)) return true;
  return false;
};

// collect [start, end, text] edits for references per swap map
const collectEdits = (root, sf, swap, edits, opts = {}) => {
  const visit = (n) => {
    if (ts.isIdentifier(n) && swap[n.text] !== undefined) {
      const p = n.parent;
      const skip =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isPropertySignature(p) && p.name === n) ||
        (ts.isMethodSignature(p) && p.name === n) ||
        (ts.isBindingElement(p) && p.propertyName === n) ||
        (ts.isImportSpecifier(p)) || (ts.isExportSpecifier(p)) ||
        (ts.isQualifiedName(p) && p.right === n && !ts.isIdentifier(p.left)) ||
        (opts.skipDecl && opts.skipDecl.has(n));
      if (!skip && !shadowed(n, n.text, root)) {
        if (ts.isShorthandPropertyAssignment(p) && p.name === n) {
          edits.push([n.getEnd(), n.getEnd(), `: ${swap[n.text]}`]);
        } else {
          edits.push([n.getStart(sf), n.getEnd(), swap[n.text]]);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
};
const splice = (text, edits) => {
  edits.sort((a, b) => b[0] - a[0]);
  for (const [s, e, t] of edits) text = text.slice(0, s) + t + text.slice(e);
  return text;
};

if (mode === 'def') {
  const [defName, swapJson] = rest;
  const swap = JSON.parse(swapJson);
  const full = fs.readFileSync(file, 'utf8');
  const sf0 = ts.createSourceFile(file, full, ts.ScriptTarget.ES2022, true);
  const st = sf0.statements.find((x) => declaredNameOf(x) === defName);
  if (!st) die(`'${defName}' not found in ${file}`);
  const defText = full.slice(st.getStart(sf0), st.getEnd());
  const mini = ts.createSourceFile('def.ts', defText, ts.ScriptTarget.ES2022, true);
  const edits = [];
  collectEdits(mini, mini, swap, edits);
  process.stdout.write(splice(defText, edits) + '\n');
} else if (mode === 'file') {
  const [swapJson] = rest;
  const swap = JSON.parse(swapJson);
  const full = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, full, ts.ScriptTarget.ES2022, true);
  const edits = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !st.importClause.namedBindings) continue;
    const nb = st.importClause.namedBindings;
    if (!ts.isNamedImports(nb)) continue;
    for (const spec of nb.elements) {
      const importedName = (spec.propertyName ?? spec.name).text;
      if (swap[importedName] === undefined) continue;
      if (spec.propertyName) {
        // import { old as alias } → only the imported name changes
        edits.push([spec.propertyName.getStart(sf), spec.propertyName.getEnd(), swap[importedName]]);
      } else {
        edits.push([spec.name.getStart(sf), spec.name.getEnd(), swap[importedName]]);
        // references throughout the file follow the local binding
      }
    }
  }
  // rename references for plain (non-aliased) imported bindings
  const plain = {};
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !st.importClause.namedBindings) continue;
    const nb = st.importClause.namedBindings;
    if (!ts.isNamedImports(nb)) continue;
    for (const spec of nb.elements) {
      if (!spec.propertyName && swap[spec.name.text] !== undefined) plain[spec.name.text] = swap[spec.name.text];
    }
  }
  const skipDecl = new Set();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause && st.importClause.namedBindings
        && ts.isNamedImports(st.importClause.namedBindings)) {
      for (const spec of st.importClause.namedBindings.elements) skipDecl.add(spec.name);
    }
  }
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) continue;
    collectEdits(st, sf, plain, edits, { skipDecl });
  }
  process.stdout.write(splice(full, edits));
} else die(`unknown mode: ${mode}`);
