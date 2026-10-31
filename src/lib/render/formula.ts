/**
 * Deterministic formula engine (WP-G, spec §18 "Charts and graphs").
 *
 * A client wants a designed graphic derived from a mathematical expression — a decay curve, a
 * distribution, a growth line — without an illustrator. This module turns a plain formula string into
 * a sampled series the existing chart renderers draw, so the graphic is branded, vector-crisp and
 * deterministic.
 *
 * There is NO `eval`, NO `new Function`, and NO model call. The grammar is fixed and small: numbers,
 * the variable `x`, the constants `pi` and `e`, the operators `+ - * / ^`, parentheses, and a fixed
 * list of functions. A string outside that grammar is rejected with a plain reason, so a formula is
 * data, never code. Everything is a pure function of its arguments: no clock, no randomness, no IO.
 */

export type FormulaFn =
  | 'sin' | 'cos' | 'tan' | 'asin' | 'acos' | 'atan'
  | 'sqrt' | 'abs' | 'exp' | 'ln' | 'log' | 'log2'
  | 'floor' | 'ceil' | 'round' | 'sign';

export const FORMULA_FUNCTIONS: FormulaFn[] = [
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sqrt', 'abs', 'exp', 'ln', 'log', 'log2',
  'floor', 'ceil', 'round', 'sign',
];

/** The two-argument functions, kept separate because they take a comma. */
export const FORMULA_BINARY_FUNCTIONS = ['min', 'max', 'pow', 'mod'] as const;

export const FORMULA_CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

/** The largest expression the engine will parse, so a hostile input cannot exhaust the parser. */
export const FORMULA_LIMITS = {
  maxLength: 400,
  maxNodes: 200,
  maxDepth: 32,
  /** The number of samples a curve is drawn from. Fixed, so the graphic is reproducible. */
  samples: 256,
} as const;

export type FormulaNode =
  | { kind: 'number'; value: number }
  | { kind: 'variable' }
  | { kind: 'constant'; name: string }
  | { kind: 'unary'; op: '-' | '+'; operand: FormulaNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: FormulaNode; right: FormulaNode }
  | { kind: 'call'; name: string; args: FormulaNode[] };

export interface FormulaError {
  /** A stable code the editor can switch on. */
  code: 'empty' | 'too_long' | 'bad_character' | 'unexpected' | 'unknown_name' | 'bad_arity' | 'too_complex' | 'too_deep';
  /** Where in the string the problem starts. */
  at: number;
  message: string;
}

export interface CompiledFormula {
  /** The expression exactly as the client typed it, for display and for the graphic's caption. */
  source: string;
  ast: FormulaNode;
  /** The variables the expression uses, always a subset of `['x']` today. */
  variables: string[];
  /** The functions the expression calls, in first-use order. */
  functions: string[];
}

export type FormulaResult =
  | { ok: true; formula: CompiledFormula }
  | { ok: false; error: FormulaError };

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

interface Token { kind: 'number' | 'name' | 'op' | 'lparen' | 'rparen' | 'comma'; text: string; at: number }

function tokenise(src: string): { ok: true; tokens: Token[] } | { ok: false; error: FormulaError } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i += 1; continue; }
    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < src.length && /[0-9]/.test(src[i])) i += 1;
      if (src[i] === '.') { i += 1; while (i < src.length && /[0-9]/.test(src[i])) i += 1; }
      if (src[i] === 'e' || src[i] === 'E') {
        const save = i;
        i += 1;
        if (src[i] === '+' || src[i] === '-') i += 1;
        if (i < src.length && /[0-9]/.test(src[i])) { while (i < src.length && /[0-9]/.test(src[i])) i += 1; } else { i = save; }
      }
      tokens.push({ kind: 'number', text: src.slice(start, i), at: start });
      continue;
    }
    if (ch === '.') {
      const start = i;
      i += 1;
      while (i < src.length && /[0-9]/.test(src[i])) i += 1;
      if (i === start + 1) return { ok: false, error: { code: 'bad_character', at: start, message: `"." must be followed by digits` } };
      tokens.push({ kind: 'number', text: src.slice(start, i), at: start });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i += 1;
      tokens.push({ kind: 'name', text: src.slice(start, i), at: start });
      continue;
    }
    if ('+-*/^'.includes(ch)) { tokens.push({ kind: 'op', text: ch, at: i }); i += 1; continue; }
    if (ch === '(') { tokens.push({ kind: 'lparen', text: ch, at: i }); i += 1; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen', text: ch, at: i }); i += 1; continue; }
    if (ch === ',') { tokens.push({ kind: 'comma', text: ch, at: i }); i += 1; continue; }
    return { ok: false, error: { code: 'bad_character', at: i, message: `"${ch}" is not allowed in a formula` } };
  }
  return { ok: true, tokens };
}

// ---------------------------------------------------------------------------
// Parser (recursive descent, precedence climbing)
// ---------------------------------------------------------------------------

const isFn = (n: string): n is FormulaFn => (FORMULA_FUNCTIONS as string[]).includes(n);
const isBinaryFn = (n: string): boolean => (FORMULA_BINARY_FUNCTIONS as readonly string[]).includes(n);

class Parser {
  private i = 0;

  private nodes = 0;

  constructor(private readonly tokens: Token[], private readonly src: string) {}

  parse(): FormulaResult {
    if (this.tokens.length === 0) {
      return { ok: false, error: { code: 'empty', at: 0, message: 'the formula is empty' } };
    }
    let ast: FormulaNode;
    try {
      ast = this.expression(0);
    } catch (e) {
      return { ok: false, error: e as FormulaError };
    }
    if (this.i < this.tokens.length) {
      const t = this.tokens[this.i];
      return { ok: false, error: { code: 'unexpected', at: t.at, message: `unexpected "${t.text}"` } };
    }
    const vars = new Set<string>();
    const fns: string[] = [];
    collect(ast, vars, fns);
    return { ok: true, formula: { source: this.src, ast, variables: [...vars], functions: fns } };
  }

  private peek(): Token | undefined { return this.tokens[this.i]; }

  private count(): void {
    this.nodes += 1;
    if (this.nodes > FORMULA_LIMITS.maxNodes) {
      throw { code: 'too_complex', at: this.peek()?.at ?? 0, message: 'the formula is too long to evaluate' } as FormulaError;
    }
  }

  /** Precedence: 0 = additive, 1 = multiplicative, 2 = power, 3 = unary. */
  private expression(minPrec: number): FormulaNode {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== 'op') break;
      const prec = t.text === '+' || t.text === '-' ? 0 : t.text === '*' || t.text === '/' ? 1 : 2;
      if (prec < minPrec) break;
      this.i += 1;
      // Power is right-associative, so the right side is parsed at the same precedence.
      const right = this.expression(t.text === '^' ? prec : prec + 1);
      this.count();
      left = { kind: 'binary', op: t.text as '+' | '-' | '*' | '/' | '^', left, right };
    }
    return left;
  }

  private unary(): FormulaNode {
    const t = this.peek();
    if (t && t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      this.i += 1;
      const operand = this.unary();
      this.count();
      return { kind: 'unary', op: t.text as '-' | '+', operand };
    }
    return this.power();
  }

  private power(): FormulaNode {
    const base = this.atom();
    const t = this.peek();
    if (t && t.kind === 'op' && t.text === '^') {
      this.i += 1;
      const exp = this.unary();
      this.count();
      return { kind: 'binary', op: '^', left: base, right: exp };
    }
    return base;
  }

  private atom(): FormulaNode {
    const t = this.peek();
    if (!t) throw { code: 'unexpected', at: this.src.length, message: 'the formula ends early' } as FormulaError;
    if (t.kind === 'number') {
      this.i += 1;
      this.count();
      const value = Number(t.text);
      if (!Number.isFinite(value)) throw { code: 'unexpected', at: t.at, message: `"${t.text}" is not a number` } as FormulaError;
      return { kind: 'number', value };
    }
    if (t.kind === 'name') {
      this.i += 1;
      const next = this.peek();
      if (next && next.kind === 'lparen') {
        this.i += 1;
        const args = this.arguments();
        this.count();
        if (!isFn(t.text) && !isBinaryFn(t.text)) {
          throw { code: 'unknown_name', at: t.at, message: `"${t.text}" is not a known function` } as FormulaError;
        }
        if (isFn(t.text) && args.length !== 1) {
          throw { code: 'bad_arity', at: t.at, message: `${t.text} takes one argument` } as FormulaError;
        }
        if (isBinaryFn(t.text) && args.length !== 2) {
          throw { code: 'bad_arity', at: t.at, message: `${t.text} takes two arguments` } as FormulaError;
        }
        return { kind: 'call', name: t.text, args };
      }
      if (t.text === 'x') { this.count(); return { kind: 'variable' }; }
      if (t.text in FORMULA_CONSTANTS) { this.count(); return { kind: 'constant', name: t.text }; }
      throw { code: 'unknown_name', at: t.at, message: `"${t.text}" is not a variable, constant or function` } as FormulaError;
    }
    if (t.kind === 'lparen') {
      this.i += 1;
      const inner = this.expression(0);
      const close = this.peek();
      if (!close || close.kind !== 'rparen') {
        throw { code: 'unexpected', at: t.at, message: 'a "(" is not closed' } as FormulaError;
      }
      this.i += 1;
      return inner;
    }
    throw { code: 'unexpected', at: t.at, message: `unexpected "${t.text}"` } as FormulaError;
  }

  private arguments(): FormulaNode[] {
    const args: FormulaNode[] = [];
    const first = this.peek();
    if (first && first.kind === 'rparen') { this.i += 1; return args; }
    for (;;) {
      args.push(this.expression(0));
      const t = this.peek();
      if (t && t.kind === 'comma') { this.i += 1; continue; }
      if (t && t.kind === 'rparen') { this.i += 1; return args; }
      throw { code: 'unexpected', at: t?.at ?? this.src.length, message: 'a function call is not closed' } as FormulaError;
    }
  }
}

function collect(node: FormulaNode, vars: Set<string>, fns: string[]): void {
  switch (node.kind) {
    case 'variable': vars.add('x'); return;
    case 'unary': collect(node.operand, vars, fns); return;
    case 'binary': collect(node.left, vars, fns); collect(node.right, vars, fns); return;
    case 'call':
      if (!fns.includes(node.name)) fns.push(node.name);
      for (const a of node.args) collect(a, vars, fns);
      return;
    default: return;
  }
}

/** Parse and validate a formula. Pure; the only failure mode is a returned error, never a throw. */
export function compileFormula(source: string): FormulaResult {
  const src = (source ?? '').trim();
  if (src === '') return { ok: false, error: { code: 'empty', at: 0, message: 'the formula is empty' } };
  if (src.length > FORMULA_LIMITS.maxLength) {
    return { ok: false, error: { code: 'too_long', at: FORMULA_LIMITS.maxLength, message: `a formula may be at most ${FORMULA_LIMITS.maxLength} characters` } };
  }
  const lexed = tokenise(src);
  if (!lexed.ok) return { ok: false, error: lexed.error };
  return new Parser(lexed.tokens, src).parse();
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

const SAFE = (n: number): number => (Number.isFinite(n) ? n : Number.NaN);

/** Evaluate a compiled formula at `x`. Pure. A domain error (sqrt of a negative, ln of zero) returns
 *  NaN, which the sampler treats as a gap rather than a wrong point. */
export function evaluateFormula(formula: CompiledFormula, x: number, depth = 0): number {
  if (depth > FORMULA_LIMITS.maxDepth) return Number.NaN;
  return SAFE(evalNode(formula.ast, x, depth));
}

function evalNode(node: FormulaNode, x: number, depth: number): number {
  switch (node.kind) {
    case 'number': return node.value;
    case 'variable': return x;
    case 'constant': return FORMULA_CONSTANTS[node.name] ?? Number.NaN;
    case 'unary': {
      const v = evalNode(node.operand, x, depth + 1);
      return node.op === '-' ? -v : v;
    }
    case 'binary': {
      const a = evalNode(node.left, x, depth + 1);
      const b = evalNode(node.right, x, depth + 1);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? Number.NaN : a / b;
        case '^': return a < 0 && !Number.isInteger(b) ? Number.NaN : Math.pow(a, b);
        default: return Number.NaN;
      }
    }
    case 'call': {
      const args = node.args.map((a) => evalNode(a, x, depth + 1));
      return applyFunction(node.name, args);
    }
    default: return Number.NaN;
  }
}

function applyFunction(name: string, args: number[]): number {
  switch (name) {
    case 'sin': return Math.sin(args[0]);
    case 'cos': return Math.cos(args[0]);
    case 'tan': return Math.tan(args[0]);
    case 'asin': return args[0] < -1 || args[0] > 1 ? Number.NaN : Math.asin(args[0]);
    case 'acos': return args[0] < -1 || args[0] > 1 ? Number.NaN : Math.acos(args[0]);
    case 'atan': return Math.atan(args[0]);
    case 'sqrt': return args[0] < 0 ? Number.NaN : Math.sqrt(args[0]);
    case 'abs': return Math.abs(args[0]);
    case 'exp': return Math.exp(args[0]);
    case 'ln': return args[0] <= 0 ? Number.NaN : Math.log(args[0]);
    case 'log': return args[0] <= 0 ? Number.NaN : Math.log10(args[0]);
    case 'log2': return args[0] <= 0 ? Number.NaN : Math.log2(args[0]);
    case 'floor': return Math.floor(args[0]);
    case 'ceil': return Math.ceil(args[0]);
    case 'round': return Math.round(args[0]);
    case 'sign': return Math.sign(args[0]);
    case 'min': return Math.min(args[0], args[1]);
    case 'max': return Math.max(args[0], args[1]);
    case 'pow': return Math.pow(args[0], args[1]);
    case 'mod': return args[1] === 0 ? Number.NaN : args[0] % args[1];
    default: return Number.NaN;
  }
}

/** A formula that uses no variable is a constant: it draws as a flat line, which is still correct. */
export function isConstantFormula(formula: CompiledFormula): boolean {
  return formula.variables.length === 0;
}
