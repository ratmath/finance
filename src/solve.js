// Rates found by solving. Every rate equation here is a polynomial in
// x = 1 + r, so its roots are algebraic numbers: @ratmath/algebraic finds all
// the real ones, each isolated and proven, and tells a rational root from an
// irrational one. Long conventional cash flows (one change of sign) have
// exactly one positive root by Descartes' rule, and it is bracketed by exact
// bisection instead.
import { Rational, RationalInterval } from "@ratmath/core";
import { roots as algebraicRoots, format as algebraicFormat, sub as algebraicSub, fromRational } from "@ratmath/algebraic";
import { refuse, ZERO, ONE, Q } from "./money.js";

const gcd = (a, b) => {
  [a, b] = [a < 0n ? -a : a, b < 0n ? -b : b];
  while (b) [a, b] = [b, a % b];
  return a;
};
/** rational coefficients (constant first) as whole numbers with the same roots */
export function wholeCoefficients(coeffs) {
  const c = coeffs.slice();
  while (c.length && c[c.length - 1].numerator === 0n) c.pop();
  if (!c.length) return [];
  const den = c.reduce((l, q) => (l * q.denominator) / gcd(l, q.denominator), 1n);
  const ints = c.map((q) => (q.numerator * den) / q.denominator);
  const g = ints.reduce(gcd, 0n);
  return ints.map((n) => n / g);
}
export const signChanges = (values) => {
  const s = values.map((v) => (typeof v === "bigint" ? (v > 0n ? 1 : v < 0n ? -1 : 0) : Math.sign(Number(v.numerator)))).filter(Boolean);
  let n = 0;
  for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) n++;
  return n;
};
const horner = (ints, x) => {
  let y = ZERO;
  for (let i = ints.length - 1; i >= 0; i--) y = y.multiply(x).add(new Rational(ints[i]));
  return y;
};

/** the fraction with the smallest denominator in [lo, hi], for 0 ≤ lo < hi */
function simplest(lo, hi) {
  const f = lo.numerator / lo.denominator;
  const whole = new Rational(f);
  if (whole.equals(lo)) return lo;
  if (whole.add(ONE).compareTo(hi) <= 0) return whole.add(ONE);
  return whole.add(ONE.divide(simplest(ONE.divide(hi.subtract(whole)), ONE.divide(lo.subtract(whole)))));
}

/**
 * Every rate r > −1 with Σ coeffs[k]·(1 + r)^k = 0, in increasing order:
 * [{ rate, exact, text, multiplicity }]. `rate` is a Rational when the root
 * is rational and otherwise an interval proven to contain exactly one root.
 */
export function rateRoots(coeffs, { digits = 12, limit = 80 } = {}) {
  let ints = wholeCoefficients(coeffs);
  if (!ints.length) refuse("no-equation", "every amount is zero, so every rate works");
  while (ints.length > 1 && ints[0] === 0n) ints = ints.slice(1); // x = 0 is r = −1, not a rate
  const changes = signChanges(ints);
  if (changes === 0) return [];
  const bits = Math.ceil(digits * 3.33) + 8;
  const degree = ints.length - 1;
  if (degree > limit && changes === 1) {
    // one positive root; the polynomial has the sign of its constant term before it
    const s0 = ints[0] > 0n ? 1 : -1;
    const sign = (x) => Math.sign(Number(horner(ints, x).numerator)) || 0;
    let lo = ZERO;
    let hi = ONE;
    while (sign(hi) === s0) [lo, hi] = [hi, hi.multiply(Q(2))];
    const eps = Q(1n, 1n << BigInt(bits));
    while (hi.subtract(lo).compareTo(eps) > 0) {
      const mid = lo.add(hi).divide(Q(2));
      const s = sign(mid);
      if (s === 0) return [{ rate: mid.subtract(ONE), exact: true, text: mid.subtract(ONE).toString(), multiplicity: 1 }];
      if (s === s0) lo = mid;
      else hi = mid;
    }
    // a rate typed as a decimal is the simplest fraction in the bracket: test it
    const simple = simplest(lo, hi);
    if (sign(simple) === 0) return [{ rate: simple.subtract(ONE), exact: true, text: simple.subtract(ONE).toString(), multiplicity: 1 }];
    const iv = new RationalInterval(lo.subtract(ONE), hi.subtract(ONE));
    return [{ rate: iv, exact: false, text: `${iv.low.toDecimal(digits)}…`, multiplicity: 1 }];
  }
  if (degree > 400) refuse("too-long", "a cash flow with several changes of sign and more than 400 periods is too long to solve for every rate");
  const out = [];
  for (const { value, multiplicity } of algebraicRoots(ints)) {
    if (value.rational ? value.rational[0] <= 0n : value.interval(8)[1].numerator <= 0n) continue;
    const r = algebraicSub(value, fromRational([1n, 1n]));
    const q = r.rational;
    if (q) out.push({ rate: new Rational(q[0], q[1]), exact: true, text: new Rational(q[0], q[1]).toString(), multiplicity });
    else {
      const [lo, hi] = r.interval(bits);
      out.push({ rate: new RationalInterval(lo, hi), exact: false, text: algebraicFormat(r, { digits }).replace(/−/g, "-"), multiplicity });
    }
  }
  return out;
}

/**
 * The zero of a function that is known to be strictly monotone, by exact
 * bisection: f takes a Rational and returns a Rational or an interval; the
 * answer is an interval of width below 10^−digits (or the exact point).
 */
export function monotoneZero(f, lo, hi, { digits = 12 } = {}) {
  const sign = (x) => {
    const y = f(x);
    if (y instanceof RationalInterval) return y.low.numerator > 0n ? 1 : y.high.numerator < 0n ? -1 : null;
    return y.numerator > 0n ? 1 : y.numerator < 0n ? -1 : 0;
  };
  const [sl, sh] = [sign(lo), sign(hi)];
  if (sl === 0) return lo;
  if (sh === 0) return hi;
  if (sl === null || sh === null || sl === sh) refuse("no-bracket", "the two ends do not bracket a solution");
  const eps = Q(1n, 10n ** BigInt(digits));
  // midpoints on a binary grid so the numbers stay short
  const grid = 1n << BigInt(Math.ceil(digits * 3.33) + 8);
  while (hi.subtract(lo).compareTo(eps) > 0) {
    const m = lo.add(hi).divide(Q(2));
    const mid = new Rational((m.numerator * grid) / m.denominator, grid);
    const at = mid.compareTo(lo) > 0 && mid.compareTo(hi) < 0 ? mid : m;
    const s = sign(at);
    if (s === 0) return at;
    if (s === null) break; // the function's own enclosure is as wide as the bracket
    if (s === sl) lo = at;
    else hi = at;
  }
  return new RationalInterval(lo, hi);
}
