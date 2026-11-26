// The time value of money: interest, equivalent rates, present and future
// values, annuities, and solving for whichever quantity is missing.
import { Rational, RationalInterval } from "@ratmath/core";
import { refuse, amount, ZERO, ONE, Q, power, exp, ln, ends } from "./money.js";
import { rateRoots } from "./solve.js";

const whole = (n, what) => {
  const q = amount(n);
  if (q.denominator !== 1n || q.numerator < 0n) refuse("bad-periods", `${what} is a whole number that is not negative`);
  return Number(q.numerator);
};
const sub1 = (x) => (x instanceof RationalInterval ? new RationalInterval(x.low.subtract(ONE), x.high.subtract(ONE)) : x.subtract(ONE));
const scale = (x, k) => {
  if (!(x instanceof RationalInterval)) return x.multiply(k);
  const [a, b] = [x.low.multiply(k), x.high.multiply(k)];
  return a.compareTo(b) <= 0 ? new RationalInterval(a, b) : new RationalInterval(b, a);
};

/** Simple interest: principal·rate·time. { interest, total }. */
export function simpleInterest(principal, rate, time) {
  const interest = amount(principal).multiply(amount(rate)).multiply(amount(time));
  return { interest, total: amount(principal).add(interest) };
}
/**
 * What a principal grows to in `years` at a nominal annual rate compounded
 * periodsPerYear times a year, or "continuous". Exact when the number of
 * periods is whole; otherwise an interval that contains the value.
 */
export function compound(principal, rate, years, { periodsPerYear = 1, digits = 12 } = {}) {
  const [p, j, t] = [amount(principal), amount(rate), amount(years)];
  if (periodsPerYear === "continuous") return j.multiply(t).numerator === 0n ? p : scale(exp(j.multiply(t), digits), p);
  const m = amount(periodsPerYear);
  return scale(power(ONE.add(j.divide(m)), m.multiply(t), digits), p);
}
/** The effective annual rate of a nominal rate compounded m times a year (or "continuous"). */
export function effectiveRate(nominal, periodsPerYear = 12, { digits = 12 } = {}) {
  const j = amount(nominal);
  if (periodsPerYear === "continuous") return j.numerator === 0n ? ZERO : sub1(exp(j, digits));
  const m = amount(periodsPerYear);
  return sub1(power(ONE.add(j.divide(m)), m, digits));
}
/** The nominal annual rate, compounded m times a year (or "continuous"), that has a given effective annual rate. */
export function nominalRate(effective, periodsPerYear = 12, { digits = 12 } = {}) {
  const i = amount(effective);
  if (periodsPerYear === "continuous") return i.numerator === 0n ? ZERO : ln(ONE.add(i), digits);
  const m = amount(periodsPerYear);
  return scale(sub1(power(ONE.add(i), ONE.divide(m), digits)), m);
}
/** A nominal rate compounded `from` times a year restated as one compounded `to` times a year. */
export function equivalentRate(nominal, from, to, { digits = 12 } = {}) {
  const [j, m, k] = [amount(nominal), amount(from), amount(to)];
  return scale(sub1(power(ONE.add(j.divide(m)), m.divide(k), digits)), k);
}
/** The real rate behind a nominal rate and an inflation rate (Fisher, exactly): (1 + n)/(1 + π) − 1. */
export const realRate = (nominal, inflation) => ONE.add(amount(nominal)).divide(ONE.add(amount(inflation))).subtract(ONE);

/** (1 + rate)^−periods */
export const discountFactor = (rate, periods, opts = {}) => power(ONE.add(amount(rate)), amount(periods).negate(), opts.digits);
export const futureValue = (pv, rate, periods, opts = {}) => scale(power(ONE.add(amount(rate)), amount(periods), opts.digits), amount(pv));
export const presentValue = (fv, rate, periods, opts = {}) => scale(discountFactor(rate, periods, opts), amount(fv));

// Σ_{k=0}^{n−1} x^k, exactly
const geometric = (x, n) => (x.equals(ONE) ? Q(n) : x.pow(n).subtract(ONE).divide(x.subtract(ONE)));

/**
 * A level or growing annuity: `periods` payments, the first of `payment`,
 * each later one (1 + growth) times the one before; at the end of each
 * period (ordinary) or the start (due); starting after `deferred` periods.
 * { presentValue, futureValue, total, payments }, all exact.
 */
export function annuity({ payment = 1, rate, periods, due = false, growth = 0, deferred = 0 } = {}) {
  const [p, i, g] = [amount(payment), amount(rate), amount(growth)];
  const n = whole(periods, "the number of payments");
  const d = whole(deferred, "the deferral");
  if (i.compareTo(Q(-1)) <= 0) refuse("bad-rate", "the rate must be more than −100%");
  const v = ONE.divide(ONE.add(i));
  // payments at times 1..n: p·Σ (1+g)^(k−1) v^k = p·v·Σ ((1+g)v)^(k−1)
  let pv = n === 0 ? ZERO : p.multiply(v).multiply(geometric(ONE.add(g).multiply(v), n));
  if (due) pv = pv.multiply(ONE.add(i));
  pv = pv.multiply(v.pow(d));
  const fv = pv.multiply(ONE.add(i).pow(n + d));
  return { presentValue: pv, futureValue: fv, total: n === 0 ? ZERO : p.multiply(geometric(ONE.add(g), n)), payments: n };
}
/** A perpetuity: payments for ever, level or growing at a rate below the interest rate. Its present value. */
export function perpetuity({ payment = 1, rate, growth = 0, due = false, deferred = 0 } = {}) {
  const [p, i, g] = [amount(payment), amount(rate), amount(growth)];
  if (i.compareTo(g) <= 0) refuse("diverges", "a perpetuity has a present value only when the rate is above the growth rate");
  let pv = p.divide(i.subtract(g));
  if (due) pv = pv.multiply(ONE.add(i));
  return pv.divide(ONE.add(i).pow(whole(deferred, "the deferral")));
}

/**
 * The equation that ties together a present value, a level payment, a
 * future value, a rate per period and a number of periods,
 *   pv + pmt·a + fv·(1 + rate)^−n = 0,   a = (1 − (1 + rate)^−n)/rate  (×(1 + rate) when due),
 * with money received positive and money paid negative. Leave out exactly
 * one of pv, fv, pmt, rate, n and it is solved for:
 * pv, fv and pmt exactly; n as an exact number or an interval; rate as the
 * list of every rate that works (`rates`), each proven.
 */
export function tvm({ pv, fv, pmt, rate, n, due = false, digits = 12 } = {}) {
  const given = { pv, fv, pmt, rate, n };
  const missing = Object.keys(given).filter((k) => given[k] === undefined);
  if (missing.length !== 1) refuse("bad-problem", "leave out exactly one of pv, fv, pmt, rate, n");
  const what = missing[0];
  const val = (k) => amount(given[k]);
  if (what === "rate") {
    const N = whole(n, "n");
    if (N === 0) refuse("bad-problem", "with no periods there is no rate to find");
    // times x^n with x = 1 + rate: pv·x^n + pmt·(x^(n−1) + … + 1)·(x if due) + fv = 0
    const c = Array.from({ length: N + 1 }, () => ZERO);
    c[N] = c[N].add(val("pv"));
    c[0] = c[0].add(val("fv"));
    for (let k = 0; k < N; k++) c[k + (due ? 1 : 0)] = c[k + (due ? 1 : 0)].add(val("pmt"));
    const rates = rateRoots(c, { digits });
    return { solved: "rate", rates, rate: rates.length === 1 ? rates[0].rate : null, count: rates.length };
  }
  const i = val("rate");
  if (i.compareTo(Q(-1)) <= 0) refuse("bad-rate", "the rate must be more than −100%");
  const x = ONE.add(i);
  const dueFactor = due ? x : ONE;
  if (what === "n") {
    const [P, F, M] = [val("pv"), val("fv"), val("pmt")];
    let exact = null;
    let ratio = null;
    if (i.numerator === 0n) {
      if (M.numerator === 0n) refuse("no-solution", "with no interest and no payment the balance never changes");
      exact = P.add(F).negate().divide(M);
    } else {
      // x^−n = (pv + c)/(c − fv), c = pmt·dueFactor/rate
      const c = M.multiply(dueFactor).divide(i);
      if (c.subtract(F).numerator === 0n) refuse("no-solution", "no number of periods balances these amounts");
      ratio = c.subtract(F).divide(P.add(c)); // = x^n
      if (P.add(c).numerator === 0n || ratio.numerator <= 0n) refuse("no-solution", "no number of periods balances these amounts: the payment does not cover the interest, or the signs are the same");
      const guess = Math.round(Math.log(ratio.toNumber()) / Math.log(x.toNumber()));
      if (Number.isFinite(guess) && Math.abs(guess) < 100000 && (guess >= 0 ? x.pow(guess) : ONE.divide(x.pow(-guess))).equals(ratio)) exact = Q(guess);
    }
    if (exact !== null) {
      if (exact.numerator < 0n) refuse("no-solution", "the amounts balance only at a negative number of periods");
      return { solved: "n", n: exact, exact: true, whole: Number((exact.numerator + exact.denominator - 1n) / exact.denominator) };
    }
    const [a, b] = [ln(ratio, digits + 4), ln(x, digits + 4)];
    const q = [a.low.divide(b.low), a.low.divide(b.high), a.high.divide(b.low), a.high.divide(b.high)].sort((u, w) => u.compareTo(w));
    if (q[3].numerator < 0n) refuse("no-solution", "the amounts balance only at a negative number of periods");
    const hi = q[3];
    return { solved: "n", n: new RationalInterval(q[0], hi), exact: false, whole: Number((hi.numerator + hi.denominator - 1n) / hi.denominator) };
  }
  const N = whole(n, "n");
  const vN = ONE.divide(x.pow(N));
  const a = (i.numerator === 0n ? Q(N) : ONE.subtract(vN).divide(i)).multiply(dueFactor);
  if (what === "pv") return { solved: "pv", pv: val("pmt").multiply(a).add(val("fv").multiply(vN)).negate(), exact: true };
  if (what === "fv") return { solved: "fv", fv: val("pv").add(val("pmt").multiply(a)).divide(vN).negate(), exact: true };
  if (a.numerator === 0n) refuse("no-solution", "with no periods a payment cannot balance the amounts");
  return { solved: "pmt", pmt: val("pv").add(val("fv").multiply(vN)).divide(a).negate(), exact: true };
}
export { ends };
