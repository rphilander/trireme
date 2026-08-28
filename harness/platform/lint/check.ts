/**
 * platform/lint/check — mechanical enforcement of CODE-CONTRACT.
 * Runs in-world for feedback and at the bank as a floor.
 *
 * Syntactic rules: no-class, no-this, no-enum, no-namespace, no-as
 * (except `as const`), no-any, no-non-null, no-module-mutable
 * (top-level let/var), no-shared-mutation (assignment/delete/++/--
 * whose target root is not function-local), no-admin-import.
 * The platform kernel (platform/values) is exempt (its casts are the
 * audited exception).
 *
 * Type-directed rule: linear-state — a binding whose type alias ends
 * in `State` is consumed by reads; more reads than the capacity
 * provides (1 per binding/reassignment) is the stale-state hazard.
 * Branch-aware: if/else, ternary, &&/||, and switch clauses fork;
 * loops that consume state without rethreading it are flagged.
 *
 * CLI: node check.js [--kernel <regex>] <file-or-dir>...
 */
import ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

const DEFAULT_KERNEL = /platform[/\\]values[/\\]/;

// --------------------------------------------------------------------------
// Syntactic pass.

export const lintSourceFile = (sf: ts.SourceFile): Finding[] => {
  const findings: Finding[] = [];
  const report = (node: ts.Node, rule: string, message: string): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ file: sf.fileName, line: line + 1, rule, message });
  };

  const scopes: Array<Set<string>> = [];
  const declareLocal = (name: ts.BindingName): void => {
    const top = scopes[scopes.length - 1];
    if (!top) return;
    const add = (b: ts.BindingName): void => {
      if (ts.isIdentifier(b)) top.add(b.text);
      else for (const el of b.elements) {
        if (ts.isBindingElement(el)) add(el.name);
      }
    };
    add(name);
  };
  const isLocal = (name: string): boolean => scopes.some((s) => s.has(name));

  const rootIdent = (e: ts.Expression): ts.Identifier | undefined => {
    let cur: ts.Expression = e;
    for (;;) {
      if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)
        || ts.isNonNullExpression(cur)) { cur = cur.expression; continue; }
      if (ts.isParenthesizedExpression(cur)) { cur = cur.expression; continue; }
      break;
    }
    return ts.isIdentifier(cur) ? cur : undefined;
  };

  const checkMutationTarget = (node: ts.Node, target: ts.Expression, what: string): void => {
    const root = rootIdent(target);
    // a bare `x = …` to a local is fine; to module scope TS blocks const and
    // top-level let is banned, so any non-local root is shared state.
    if (root && !isLocal(root.text)) {
      report(node, 'no-shared-mutation',
        `${what} mutates '${root.text}', which is not function-local (module scope, import, or global)`);
    }
  };

  const walk = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      report(node, 'no-class', 'classes are not part of the language');
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      report(node, 'no-this', '`this` is not part of the language');
    }
    if (ts.isEnumDeclaration(node)) report(node, 'no-enum', 'enums are not part of the language');
    if (ts.isModuleDeclaration(node)) report(node, 'no-namespace', 'namespaces are not part of the language');
    if (ts.isAsExpression(node)) {
      const t = node.type;
      const isConst = ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && t.typeName.text === 'const';
      if (!isConst) report(node, 'no-as', '`as` casts are kernel-only');
    }
    if (ts.isTypeAssertionExpression?.(node)) report(node, 'no-as', 'type assertions are kernel-only');
    if (ts.isNonNullExpression(node)) report(node, 'no-non-null', 'non-null `!` is kernel-only');
    if (node.kind === ts.SyntaxKind.AnyKeyword) report(node, 'no-any', '`any` is not part of the language');

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text.includes('services-admin')) {
      report(node, 'no-admin-import', 'services-admin is shell/harness territory');
    }

    if (ts.isVariableStatement(node) && scopes.length === 0
      && !(node.declarationList.flags & ts.NodeFlags.Const)) {
      report(node, 'no-module-mutable', 'module-level let/var is shared mutable state');
    }

    if (ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      checkMutationTarget(node, node.left, 'assignment');
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
      checkMutationTarget(node, node.operand, 'increment/decrement');
    }
    if (ts.isDeleteExpression(node)) checkMutationTarget(node, node.expression, 'delete');

    const isFn = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
      || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
    if (isFn) {
      scopes.push(new Set());
      for (const p of (node as ts.FunctionLikeDeclaration).parameters) declareLocal(p.name);
      ts.forEachChild(node, walk);
      scopes.pop();
      return;
    }
    if (ts.isVariableDeclaration(node) && scopes.length > 0) declareLocal(node.name);
    ts.forEachChild(node, walk);
  };

  walk(sf);
  return findings;
};

// --------------------------------------------------------------------------
// Linear-state pass (type-directed, branch-aware).

const isStateType = (checker: ts.TypeChecker, node: ts.Node): boolean => {
  const t = checker.getTypeAtLocation(node);
  const alias = t.aliasSymbol?.getName();
  return alias !== undefined && /State$/.test(alias);
};

export const lintLinearState = (program: ts.Program, sf: ts.SourceFile): Finding[] => {
  const checker = program.getTypeChecker();
  const findings: Finding[] = [];
  const report = (node: ts.Node, message: string): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ file: sf.fileName, line: line + 1, rule: 'linear-state', message });
  };

  type Cap = Map<ts.Symbol, number>;

  const analyzeFn = (fn: ts.FunctionLikeDeclaration): void => {
    const tracked = new Set<ts.Symbol>();
    const cap: Cap = new Map();
    const trackDecl = (name: ts.BindingName): void => {
      if (ts.isIdentifier(name) && isStateType(checker, name)) {
        const sym = checker.getSymbolAtLocation(name);
        if (sym) { tracked.add(sym); cap.set(sym, 1); }
      }
    };
    for (const p of fn.parameters) trackDecl(p.name);

    const symOf = (id: ts.Identifier): ts.Symbol | undefined => {
      const s = checker.getSymbolAtLocation(id);
      return s && tracked.has(s) ? s : undefined;
    };

    const consume = (id: ts.Identifier, c: Cap): void => {
      const s = symOf(id);
      if (!s) return;
      const left = c.get(s) ?? 1;
      if (left <= 0) {
        report(id, `state '${id.text}' used after being consumed (stale-state hazard): rethread the latest state instead`);
      }
      c.set(s, left - 1);
    };

    const mergeWorst = (a: Cap, b: Cap): Cap => {
      const out: Cap = new Map();
      for (const s of tracked) out.set(s, Math.min(a.get(s) ?? 1, b.get(s) ?? 1));
      return out;
    };
    const copy = (c: Cap): Cap => new Map(c);

    // sequential walk with forks; mutates c
    const seq = (node: ts.Node | undefined, c: Cap): void => {
      if (!node) return;
      // nested functions: analyzed separately, their bodies don't consume ours
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
        analyzeFn(node);
        return;
      }
      if (ts.isIfStatement(node)) {
        seq(node.expression, c);
        const a = copy(c); seq(node.thenStatement, a);
        const b = copy(c); seq(node.elseStatement, b);
        const m = mergeWorst(a, b);
        for (const [s, v] of m) c.set(s, v);
        return;
      }
      if (ts.isConditionalExpression(node)) {
        seq(node.condition, c);
        const a = copy(c); seq(node.whenTrue, a);
        const b = copy(c); seq(node.whenFalse, b);
        const m = mergeWorst(a, b);
        for (const [s, v] of m) c.set(s, v);
        return;
      }
      if (ts.isBinaryExpression(node)
        && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          || node.operatorToken.kind === ts.SyntaxKind.BarBarToken
          || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
        seq(node.left, c);
        const b = copy(c); seq(node.right, b);
        const m = mergeWorst(c, b);
        for (const [s, v] of m) c.set(s, v);
        return;
      }
      if (ts.isSwitchStatement(node)) {
        seq(node.expression, c);
        const outcomes: Cap[] = [];
        for (const clause of node.caseBlock.clauses) {
          const b = copy(c);
          for (const st of clause.statements) seq(st, b);
          outcomes.push(b);
        }
        const merged = outcomes.reduce(mergeWorst, copy(c));
        for (const [s, v] of merged) c.set(s, v);
        return;
      }
      if (ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isForStatement(node)
        || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        const before = copy(c);
        const reassigned = new Set<ts.Symbol>();
        const findReassigns = (n: ts.Node): void => {
          if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isIdentifier(n.left)) {
            const s = symOf(n.left);
            if (s) reassigned.add(s);
          }
          ts.forEachChild(n, findReassigns);
        };
        findReassigns(node);
        seqChildren(node, c);
        for (const s of tracked) {
          const consumed = (before.get(s) ?? 1) > (c.get(s) ?? 1);
          if (consumed && !reassigned.has(s)) {
            report(node, `state consumed inside a loop without rethreading — each iteration would reuse a stale state`);
          }
          if (reassigned.has(s)) c.set(s, 1);
        }
        return;
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)) {
        const s = symOf(node.left);
        seq(node.right, c);
        if (s) c.set(s, 1); // rethreading refills capacity
        return;
      }
      if (ts.isVariableDeclaration(node)) {
        seq(node.initializer, c);
        trackDecl(node.name);
        return;
      }
      if (ts.isIdentifier(node)) {
        // reads only: skip declaration names and property names
        const parent = node.parent;
        const isDeclName = (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === node;
        const isPropName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
          || (ts.isPropertyAssignment(parent) && parent.name === node);
        if (!isDeclName && !isPropName) consume(node, c);
        return;
      }
      seqChildren(node, c);
    };
    const seqChildren = (node: ts.Node, c: Cap): void => { ts.forEachChild(node, (ch) => seq(ch, c)); };

    if (fn.body) seq(fn.body, cap);
  };

  const findFns = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
      || ts.isMethodDeclaration(node)) {
      analyzeFn(node as ts.FunctionLikeDeclaration);
      return; // analyzeFn recurses into nested functions itself
    }
    ts.forEachChild(node, findFns);
  };
  findFns(sf);
  return findings;
};

// --------------------------------------------------------------------------
// Driver.

export const lintFiles = (files: string[], kernel: RegExp = DEFAULT_KERNEL): Finding[] => {
  const program = ts.createProgram(files, {
    strict: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true, skipLibCheck: true,
  });
  const findings: Finding[] = [];
  for (const f of files) {
    const sf = program.getSourceFile(f);
    if (!sf || kernel.test(sf.fileName)) continue;
    findings.push(...lintSourceFile(sf));
    // linear-state is threading discipline for implementation code; test
    // suites legitimately read state values repeatedly when asserting
    if (!/[/\\]test[/\\]/.test(sf.fileName)) findings.push(...lintLinearState(program, sf));
  }
  return findings;
};

const collect = (p: string): string[] => {
  const st = fs.statSync(p);
  if (st.isFile()) return p.endsWith('.ts') ? [p] : [];
  return fs.readdirSync(p)
    .filter((n) => n !== 'node_modules' && n !== 'vendor' && n !== 'dist')
    .flatMap((n) => collect(path.join(p, n)));
};

// realpath both sides: a symlinked invocation path must still count as
// direct execution (the gate/current lesson, entry-1's silent zero)
const realpathSafe = (p: string): string => { try { return fs.realpathSync(p); } catch { return p; } };
const isEntry = process.argv[1] !== undefined
  && realpathSafe(path.resolve(process.argv[1])) === realpathSafe(new URL(import.meta.url).pathname);
if (isEntry) {
  const args = process.argv.slice(2);
  let kernel = DEFAULT_KERNEL;
  const targets: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--kernel') { kernel = new RegExp(String(args[++i])); continue; }
    if (a !== undefined) targets.push(a);
  }
  const files = targets.flatMap(collect);
  const findings = lintFiles(files, kernel);
  for (const f of findings) console.log(`${f.file}:${f.line} [${f.rule}] ${f.message}`);
  console.log(findings.length === 0 ? `LINT OK (${files.length} files)` : `LINT: ${findings.length} finding(s)`);
  process.exit(findings.length === 0 ? 0 : 1);
}
