// The calculator's brain. A small safe parser: it never uses eval() or new Function().
// Pure functions only (no page code), so it can be tested on its own.

const CONSTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

const DEG = Math.PI / 180;
function funcs(deg) {
  const toRad = (x) => (deg ? x * DEG : x);
  const fromRad = (x) => (deg ? x / DEG : x);
  const one = (f) => (a) => f(a[0]);
  return {
    sqrt: [1, one(Math.sqrt)], cbrt: [1, one(Math.cbrt)], abs: [1, one(Math.abs)],
    ln: [1, one(Math.log)], log: [1, one(Math.log10)], log2: [1, one(Math.log2)], exp: [1, one(Math.exp)],
    round: [1, one(Math.round)], floor: [1, one(Math.floor)], ceil: [1, one(Math.ceil)], sign: [1, one(Math.sign)],
    sin: [1, (a) => Math.sin(toRad(a[0]))], cos: [1, (a) => Math.cos(toRad(a[0]))], tan: [1, (a) => Math.tan(toRad(a[0]))],
    asin: [1, (a) => fromRad(Math.asin(a[0]))], acos: [1, (a) => fromRad(Math.acos(a[0]))], atan: [1, (a) => fromRad(Math.atan(a[0]))],
    min: [-1, (a) => Math.min(...a)], max: [-1, (a) => Math.max(...a)],
    pow: [2, (a) => Math.pow(a[0], a[1])], hypot: [2, (a) => Math.hypot(a[0], a[1])],
  };
}

/** Turns the words and symbols people type into plain maths. */
export function normalize(input) {
  let s = String(input).toLowerCase().trim();
  s = s.replace(/[×·∗]/g, "*").replace(/÷/g, "/").replace(/[−–—]/g, "-").replace(/π/g, "pi");
  s = s.replace(/\*\*/g, "^");
  s = s.replace(/√\s*\(/g, "sqrt(").replace(/√\s*(\d+\.?\d*)/g, "sqrt($1)");
  s = s.replace(/^(what is|what's|calculate|calc|solve|compute)\s+/, "").replace(/\s*(=|\?)+\s*$/, "");
  s = s.replace(/\bmultiplied by\b|\btimes\b/g, "*").replace(/\bdivided by\b|\bover\b/g, "/");
  s = s.replace(/\bplus\b/g, "+").replace(/\bminus\b/g, "-").replace(/\bto the power of\b/g, "^");
  s = s.replace(/\bsquared\b/g, "^2").replace(/\bcubed\b/g, "^3");
  s = s.replace(/(\d+\.?\d*|\.\d+)\s*%\s*of\s+/g, "$1/100*"); // 15% of 80
  s = s.replace(/(?<=[\d)])\s*x\s*(?=[\d(.])/g, "*"); // 3 x 4
  return s;
}

function tokenize(s) {
  s = s.trim();
  const out = [];
  const re = /\s*(?:((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)|([a-z_][a-z0-9_]*)|(\S))/y;
  while (re.lastIndex < s.length) {
    const m = re.exec(s);
    if (!m) throw new Error("Can't read that");
    if (m[1] !== undefined) out.push({ t: "num", v: parseFloat(m[1]) });
    else if (m[2] !== undefined) out.push({ t: "id", v: m[2] });
    else out.push({ t: "op", v: m[3] });
  }
  return out;
}

function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw new Error("Factorial needs a whole number from 0 to 170");
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

class Parser {
  constructor(tokens, deg) { this.tk = tokens; this.i = 0; this.F = funcs(deg); this.sawOperation = false; }
  peek() { return this.tk[this.i]; }
  isOp(v) { const t = this.peek(); return t && t.t === "op" && t.v === v; }
  next() { return this.tk[this.i++]; }

  parse() {
    if (!this.tk.length) throw new Error("Type a sum");
    const r = this.expr();
    if (this.i < this.tk.length) throw new Error("Can't read that");
    return r.v;
  }
  // + and -   (200 + 10% means 200 plus 10% of 200)
  expr() {
    let left = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.next().v;
      this.sawOperation = true;
      const right = this.term();
      const rv = right.pct ? left.v * right.v : right.v;
      left = { v: op === "+" ? left.v + rv : left.v - rv, pct: false };
    }
    return left;
  }
  // * / mod, and "2(3+4)", "2pi"
  term() {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t) break;
      const prev = this.tk[this.i - 1];
      if (t.t === "op" && (t.v === "*" || t.v === "/")) {
        this.next(); this.sawOperation = true;
        const right = this.unary();
        if (t.v === "/" && right.v === 0) throw new Error("Can't divide by zero");
        left = { v: t.v === "*" ? left.v * right.v : left.v / right.v, pct: false };
      } else if (t.t === "id" && t.v === "mod") {
        this.next(); this.sawOperation = true;
        const right = this.unary();
        if (right.v === 0) throw new Error("Can't divide by zero");
        left = { v: ((left.v % right.v) + right.v) % right.v, pct: false };
      } else if (
        (t.t === "op" && t.v === "(" && prev && (prev.t === "num" || (prev.t === "op" && (prev.v === ")" || prev.v === "!" || prev.v === "%")) || (prev && prev.t === "id" && prev.v in CONSTS))) ||
        (t.t === "id" && t.v !== "mod" && prev && (prev.t === "num" || (prev.t === "op" && prev.v === ")") || (prev.t === "id" && prev.v in CONSTS))) ||
        (t.t === "num" && prev && prev.t === "op" && prev.v === ")")
      ) {
        this.sawOperation = true;
        const right = this.unary();
        left = { v: left.v * right.v, pct: false };
      } else break;
    }
    return left;
  }
  unary() {
    if (this.isOp("-")) { this.next(); this.sawOperation = true; const u = this.unary(); return { v: -u.v, pct: u.pct }; }
    if (this.isOp("+")) { this.next(); return this.unary(); }
    return this.power();
  }
  // right to left:  2^3^2 = 2^9
  power() {
    const base = this.postfix();
    if (this.isOp("^")) {
      this.next(); this.sawOperation = true;
      const exp = this.unary();
      return { v: Math.pow(base.v, exp.v), pct: false };
    }
    return base;
  }
  postfix() {
    let x = this.primary();
    for (;;) {
      if (this.isOp("!")) { this.next(); this.sawOperation = true; x = { v: factorial(x.v), pct: false }; }
      else if (this.isOp("%")) { this.next(); this.sawOperation = true; x = { v: x.v / 100, pct: true }; }
      else break;
    }
    return x;
  }
  primary() {
    const t = this.next();
    if (!t) throw new Error("The sum is unfinished");
    if (t.t === "num") return { v: t.v, pct: false };
    if (t.t === "op" && t.v === "(") {
      const r = this.expr();
      if (!this.isOp(")")) throw new Error("A bracket isn't closed");
      this.next();
      return { v: r.v, pct: false };
    }
    if (t.t === "id") {
      if (t.v in CONSTS) return { v: CONSTS[t.v], pct: false };
      const f = this.F[t.v];
      if (!f) throw new Error(`Don't know "${t.v}"`);
      if (!this.isOp("(")) throw new Error(`${t.v} needs brackets, like ${t.v}(9)`);
      this.next();
      this.sawOperation = true;
      const args = [];
      if (!this.isOp(")")) {
        args.push(this.expr().v);
        while (this.isOp(",")) { this.next(); args.push(this.expr().v); }
      }
      if (!this.isOp(")")) throw new Error("A bracket isn't closed");
      this.next();
      if (f[0] >= 0 && args.length !== f[0]) throw new Error(`${t.v} needs ${f[0]} number${f[0] === 1 ? "" : "s"}`);
      if (f[0] < 0 && !args.length) throw new Error(`${t.v} needs at least one number`);
      return { v: f[1](args), pct: false };
    }
    throw new Error(`Can't read "${t.v}"`);
  }
}

/** Works out a sum. Returns { value, plain } or throws an Error with a friendly message. */
export function evaluate(input, { deg = false } = {}) {
  const p = new Parser(tokenize(normalize(input)), deg);
  const value = p.parse();
  if (!Number.isFinite(value)) throw new Error(Number.isNaN(value) ? "That isn't a number" : "Too big to show");
  return { value, plain: plain(value), operation: p.sawOperation };
}

/** Number as plain text with floating-point dust removed (0.1+0.2 -> 0.3). */
export function plain(n) {
  if (Object.is(n, -0)) n = 0;
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return Number(n.toPrecision(12)).toExponential().replace("e+", "e");
  return String(Number(n.toPrecision(12)));
}

/** Number for showing, with thousands separators. */
export function format(n) {
  const p = plain(n);
  if (p.includes("e")) return p;
  const [whole, frac] = p.split(".");
  const neg = whole.startsWith("-");
  const digits = neg ? whole.slice(1) : whole;
  return (neg ? "-" : "") + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? "." + frac : "");
}

/**
 * For the search box: if the search is a sum, returns { expr, text, value }. Otherwise null.
 * A lone number ("8"), a date or an ID like 555-1234 are not sums.
 */
export function tryQuery(q) {
  const raw = String(q).trim();
  if (!raw || raw.length > 120) return null;
  if (/^\d+(-\d+)+$/.test(raw) || /^\d+(\/\d+){2}$/.test(raw)) return null; // dates, phone numbers, IDs
  if (/^(24\/7|24\/365|9\/11)$/.test(raw)) return null; // phrases that look like sums
  if (!/\d/.test(raw) && !/\b(pi|tau)\b|π/.test(raw)) return null;
  try {
    const r = evaluate(raw);
    if (!r.operation) return null;
    return { expr: raw, text: format(r.value), value: r.value, plain: r.plain };
  } catch { return null; }
}

/** True for searches like "calculator" or "online calculator". */
export const wantsCalculator = (q) => /^(an? )?(free )?(online |scientific |basic )?calc(ulator)?( online)?$/i.test(String(q).trim());
