/**
 * es5-evaluator — public API contract.
 *
 * Evaluates an ECMAScript 5 program given as an ESTree abstract syntax tree
 * (the shape acorn produces at `ecmaVersion: 5`, positions removed — the same
 * `Program` the es5-parser rung emits) and reports what the program observably
 * did: the lines it printed and the name of any exception that escaped.
 *
 * Nothing is parsed here; the input is already a tree. The node types below
 * are the input language, reproduced from the ESTree/acorn shape so the
 * evaluator can be built against the contract alone.
 */


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

// ---------------------------------------------------------------------------
// What the evaluator reports
// ---------------------------------------------------------------------------

/**
 * The observable result of running a program.
 *
 * `output` is one entry per `print(...)` call, in order: the call's arguments
 * each converted to a string with the language's ToString and joined by a
 * single space. `error` is `null` when the program ran to completion; when an
 * exception propagates to the top it is that exception's `name` (a string) if
 * the thrown value is an object with a string `name` — `"TypeError"`,
 * `"ReferenceError"`, `"RangeError"`, `"Error"`, and so on — and otherwise the
 * thrown value converted with ToString (so `throw "boom"` gives `"boom"`).
 * Output printed before the exception is retained.
 */
export interface EvalResult {
  output: string[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// The one function
// ---------------------------------------------------------------------------

/**
 * Evaluates `program` as an ECMAScript 5 script and returns what it observably
 * did. Never throws for a program the evaluator can run: a script-level
 * exception is reported through `EvalResult.error`, not propagated. The host
 * `print` is the only ambient binding beyond the standard globals the spec
 * lists; it appends one line to `output`.
 */
export declare function evaluate(program: Program): EvalResult;
