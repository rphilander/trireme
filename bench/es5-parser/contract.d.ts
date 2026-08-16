/**
 * es5-parser — public API contract.
 *
 * A parser for ECMAScript 5 source text (script goal, non-strict) that returns
 * an ESTree abstract syntax tree without positions. The reference is acorn at
 * `ecmaVersion: 5`; the acceptance suite's expected trees are acorn's own
 * output with `start` and `end` removed, and every node type below is shaped
 * exactly as acorn emits it — including `sourceType` on Program, `raw` on
 * Literal, `directive` on prologue statements and `expression: false` on
 * functions.
 */

// ---------------------------------------------------------------------------
// Program and statements
// ---------------------------------------------------------------------------

export interface Program {
  type: "Program";
  body: Statement[];
  sourceType: "script";
}

export type Statement =
  | ExpressionStatement
  | BlockStatement
  | EmptyStatement
  | DebuggerStatement
  | WithStatement
  | ReturnStatement
  | LabeledStatement
  | BreakStatement
  | ContinueStatement
  | IfStatement
  | SwitchStatement
  | ThrowStatement
  | TryStatement
  | WhileStatement
  | DoWhileStatement
  | ForStatement
  | ForInStatement
  | FunctionDeclaration
  | VariableDeclaration;

export interface ExpressionStatement {
  type: "ExpressionStatement";
  expression: Expression;
  /**
   * Present only on a directive: a statement in the directive prologue of a
   * Program or function body whose expression is an unparenthesized string
   * literal. Holds the literal's raw characters between the quotes.
   */
  directive?: string;
}

export interface BlockStatement {
  type: "BlockStatement";
  body: Statement[];
}

export interface EmptyStatement {
  type: "EmptyStatement";
}

export interface DebuggerStatement {
  type: "DebuggerStatement";
}

export interface WithStatement {
  type: "WithStatement";
  object: Expression;
  body: Statement;
}

export interface ReturnStatement {
  type: "ReturnStatement";
  argument: Expression | null;
}

export interface LabeledStatement {
  type: "LabeledStatement";
  label: Identifier;
  body: Statement;
}

export interface BreakStatement {
  type: "BreakStatement";
  label: Identifier | null;
}

export interface ContinueStatement {
  type: "ContinueStatement";
  label: Identifier | null;
}

export interface IfStatement {
  type: "IfStatement";
  test: Expression;
  consequent: Statement;
  alternate: Statement | null;
}

export interface SwitchStatement {
  type: "SwitchStatement";
  discriminant: Expression;
  cases: SwitchCase[];
}

export interface SwitchCase {
  type: "SwitchCase";
  /** `null` for the `default` clause. */
  test: Expression | null;
  consequent: Statement[];
}

export interface ThrowStatement {
  type: "ThrowStatement";
  argument: Expression;
}

export interface TryStatement {
  type: "TryStatement";
  block: BlockStatement;
  handler: CatchClause | null;
  finalizer: BlockStatement | null;
}

export interface CatchClause {
  type: "CatchClause";
  param: Identifier;
  body: BlockStatement;
}

export interface WhileStatement {
  type: "WhileStatement";
  test: Expression;
  body: Statement;
}

export interface DoWhileStatement {
  type: "DoWhileStatement";
  body: Statement;
  test: Expression;
}

export interface ForStatement {
  type: "ForStatement";
  init: VariableDeclaration | Expression | null;
  test: Expression | null;
  update: Expression | null;
  body: Statement;
}

export interface ForInStatement {
  type: "ForInStatement";
  left: VariableDeclaration | Identifier | MemberExpression;
  right: Expression;
  body: Statement;
}

export interface FunctionDeclaration {
  type: "FunctionDeclaration";
  id: Identifier;
  params: Identifier[];
  body: BlockStatement;
  expression: false;
}

export interface VariableDeclaration {
  type: "VariableDeclaration";
  declarations: VariableDeclarator[];
  kind: "var";
}

export interface VariableDeclarator {
  type: "VariableDeclarator";
  id: Identifier;
  init: Expression | null;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type Expression =
  | ThisExpression
  | Identifier
  | Literal
  | ArrayExpression
  | ObjectExpression
  | FunctionExpression
  | UnaryExpression
  | UpdateExpression
  | BinaryExpression
  | AssignmentExpression
  | LogicalExpression
  | MemberExpression
  | ConditionalExpression
  | CallExpression
  | NewExpression
  | SequenceExpression;

export interface ThisExpression {
  type: "ThisExpression";
}

export interface Identifier {
  type: "Identifier";
  /** The name with any unicode escapes already decoded. */
  name: string;
}

export type Literal = SimpleLiteral | RegExpLiteral;

export interface SimpleLiteral {
  type: "Literal";
  value: string | number | boolean | null;
  /** The literal exactly as written in the source, quotes included. */
  raw: string;
}

export interface RegExpLiteral {
  type: "Literal";
  /** `new RegExp(pattern, flags)`, or `null` if the host cannot construct it. */
  value: RegExp | null;
  raw: string;
  regex: {
    pattern: string;
    flags: string;
  };
}

export interface ArrayExpression {
  type: "ArrayExpression";
  /** A hole (elision) is `null`. */
  elements: Array<Expression | null>;
}

export interface ObjectExpression {
  type: "ObjectExpression";
  properties: Property[];
}

export interface Property {
  type: "Property";
  key: Identifier | Literal;
  value: Expression;
  kind: "init" | "get" | "set";
}

export interface FunctionExpression {
  type: "FunctionExpression";
  id: Identifier | null;
  params: Identifier[];
  body: BlockStatement;
  expression: false;
}

export type UnaryOperator = "-" | "+" | "!" | "~" | "typeof" | "void" | "delete";

export interface UnaryExpression {
  type: "UnaryExpression";
  operator: UnaryOperator;
  prefix: true;
  argument: Expression;
}

export type UpdateOperator = "++" | "--";

export interface UpdateExpression {
  type: "UpdateExpression";
  operator: UpdateOperator;
  argument: Expression;
  prefix: boolean;
}

export type BinaryOperator =
  | "=="
  | "!="
  | "==="
  | "!=="
  | "<"
  | "<="
  | ">"
  | ">="
  | "<<"
  | ">>"
  | ">>>"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "|"
  | "^"
  | "&"
  | "in"
  | "instanceof";

export interface BinaryExpression {
  type: "BinaryExpression";
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
}

export type AssignmentOperator =
  | "="
  | "+="
  | "-="
  | "*="
  | "/="
  | "%="
  | "<<="
  | ">>="
  | ">>>="
  | "|="
  | "^="
  | "&=";

export interface AssignmentExpression {
  type: "AssignmentExpression";
  operator: AssignmentOperator;
  left: Identifier | MemberExpression;
  right: Expression;
}

export type LogicalOperator = "||" | "&&";

export interface LogicalExpression {
  type: "LogicalExpression";
  operator: LogicalOperator;
  left: Expression;
  right: Expression;
}

export interface MemberExpression {
  type: "MemberExpression";
  object: Expression;
  /** An Identifier when `computed` is false; any expression when true. */
  property: Expression;
  computed: boolean;
}

export interface ConditionalExpression {
  type: "ConditionalExpression";
  test: Expression;
  consequent: Expression;
  alternate: Expression;
}

export interface CallExpression {
  type: "CallExpression";
  callee: Expression;
  arguments: Expression[];
}

export interface NewExpression {
  type: "NewExpression";
  callee: Expression;
  /** `[]` when the `new` has no argument list. */
  arguments: Expression[];
}

export interface SequenceExpression {
  type: "SequenceExpression";
  expressions: Expression[];
}

/** Every node kind, for consumers that walk the tree. */
export type Node = Program | Statement | Expression | SwitchCase | CatchClause | VariableDeclarator | Property;

// ---------------------------------------------------------------------------
// The one function
// ---------------------------------------------------------------------------

/**
 * Parses `source` as an ECMAScript 5 script and returns its Program.
 *
 * Throws a `SyntaxError` (or a subclass) when `source` is not a valid ES5
 * script: a malformed token, a construct that is not in the grammar, syntax
 * that arrived after ES5, an assignment to something that is not a variable
 * or property, a `break`/`continue`/`return` in the wrong place, or a label
 * problem. What the error says and where it points are not specified.
 */
export declare function parse(source: string): Program;
