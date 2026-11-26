// Cash flows: net present value, every internal rate of return, the
// modified rate, payback; inflation; depreciation; and taxes as brackets
// that the caller supplies.
import { Rational, RationalInterval } from "@ratmath/core";
import { zeros } from "@ratmath/analytic";
import { refuse, amount, ZERO, ONE, Q, rounder, power, date, dayCount } from "./money.js";
import { rateRoots, signChanges } from "./solve.js";

/** the sum of exact numbers and intervals: exact when every term is */
export function total(xs) {
  let [lo, hi, exact] = [ZERO, ZERO, true];
  for (const x of xs) {
    if (x instanceof RationalInterval) {
      [lo, hi, exact] = [lo.add(x.low), hi.add(x.high), false];
    } else [lo, hi] = [lo.add(x), hi.add(x)];
  }
  return exact ? lo : new RationalInterval(lo, hi);
}
const times = (x, k) => {
  if (!(x instanceof RationalInterval)) return x.multiply(k);
  const [a, b] = [x.low.multiply(k), x.high.multiply(k)];
  return a.compareTo(b) <= 0 ? new RationalInterval(a, b) : new RationalInterval(b, a);
};
/** flows as [{ t, amount }]: an array of amounts is taken at times 0, 1, 2, … */
const timed = (flows) => {
  if (!Array.isArray(flows) || !flows.length) refuse("bad-flows", "give the cash flows as a list");
  return flows.map((f, k) => (f !== null && typeof f === "object" && !(f instanceof Rational) && "amount" in f ? { t: amount(f.t ?? f.time ?? k), amount: amount(f.amount) } : { t: Q(k), amount: amount(f) }));
};
/** dated flows as times in years from the first date */
const dated = (flows, convention) => {
  if (!Array.isArray(flows) || !flows.length) refuse("bad-flows", "give the cash flows as a list of { date, amount }");
  const rows = flows.map((f) => ({ date: date(f.date), amount: amount(f.amount) })).sort((a, b) => a.date.compareTo(b.date));
  return rows.map((f) => ({ ...f, t: dayCount(rows[0].date, f.date, convention).yearFraction }));
};

/**
 * Net present value at a rate per period. `flows` is a list of amounts at
 * times 0, 1, 2, … (money in positive, money out negative), or of
 * { t, amount } at any exact times. Exact when the times are whole.
 */
export function npv(rate, flows, { digits = 12 } = {}) {
  const x = ONE.add(amount(rate));
  if (x.numerator <= 0n) refuse("bad-rate", "the rate must be more than −100%");
  return total(timed(flows).map((f) => times(power(x, f.t.negate(), digits + 4), f.amount)));
}
/** Net present value of dated flows at an annual rate, time measured from the first date by a day-count convention. */
export function xnpv(rate, flows, { dayCount: convention = "actual/365", digits = 12 } = {}) {
  return npv(rate, dated(flows, convention), { digits });
}

/**
 * Every internal rate of return of a list of amounts at times 0, 1, 2, …:
 * each rate above −100% at which the net present value is zero.
 * { rates: [{ rate, exact, text }], count, signChanges, rate (when there is
 * exactly one, else null), note }. The count is proven, so "more than one"
 * and "none" are answers too.
 */
export function irr(flows, { digits = 12 } = {}) {
  const f = timed(flows);
  if (f.some((c) => c.t.denominator !== 1n || c.t.numerator < 0n)) refuse("bad-flows", "irr takes flows at whole periods; use xirr for dated flows");
  const n = Number(f.reduce((m, c) => (c.t.compareTo(m) > 0 ? c.t : m), ZERO).numerator);
  // Σ a_t (1 + r)^(−t) = 0, times (1 + r)^n
  const coeffs = Array.from({ length: n + 1 }, () => ZERO);
  for (const c of f) coeffs[n - Number(c.t.numerator)] = coeffs[n - Number(c.t.numerator)].add(c.amount);
  const inOrder = coeffs.slice().reverse();
  const changes = signChanges(inOrder);
  const rates = rateRoots(coeffs, { digits });
  const note = rates.length === 0 ? (changes === 0 ? "the flows never change sign, so no rate makes them balance" : "no rate above −100% makes these flows balance") : rates.length === 1 ? "one rate" : `${rates.length} rates make these flows balance; none of them is "the" return`;
  return { rates, count: rates.length, signChanges: changes, rate: rates.length === 1 ? rates[0].rate : null, note };
}

const frac = (q) => (q.denominator === 1n ? `(${q.numerator})` : `(${q.numerator}/${q.denominator})`);
/**
 * Every internal rate of return of dated flows, as an annual rate with time
 * from the first date by a day-count convention. Searched on `range`
 * (default −99% to 1000%); each rate is an interval proven to contain one.
 */
export function xirr(flows, { dayCount: convention = "actual/365", range = ["-0.99", 10], digits = 10 } = {}) {
  const f = dated(flows, convention).filter((c) => c.amount.numerator !== 0n);
  const changes = signChanges(f.map((c) => c.amount));
  if (changes === 0) return { rates: [], count: 0, signChanges: 0, rate: null, note: "the flows never change sign, so no rate makes them balance" };
  const formula = f.map((c) => (c.t.numerator === 0n ? frac(c.amount) : `${frac(c.amount)}*(1+r)^(-${frac(c.t)})`)).join(" + ");
  const found = zeros(formula, [amount(range[0]), amount(range[1])], { variable: "r", tolerance: 10 ** -Math.min(digits, 30) }).exact();
  const rates = found.map((z) => {
    if (z.kind === "everywhere") refuse("no-equation", "every rate works");
    const exact = z.lo.equals(z.hi);
    const value = exact ? z.lo : new RationalInterval(z.lo, z.hi);
    return { rate: value, exact, text: exact ? z.lo.toString() : `${z.lo.toDecimal(digits)}…`, proven: z.unique !== false && z.kind !== "possible" };
  });
  return { rates, count: rates.length, signChanges: changes, rate: rates.length === 1 ? rates[0].rate : null, formula, note: changes === 1 ? "one change of sign, so at most one rate" : `${changes} changes of sign, so at most ${changes} rates` };
}

/**
 * The modified internal rate of return: money out is financed at one rate
 * and money in is reinvested at another, which gives a single answer:
 * (FV of inflows / −PV of outflows)^(1/n) − 1.
 */
export function mirr(flows, financeRate, reinvestRate, { digits = 12 } = {}) {
  const a = flows.map(amount);
  const n = a.length - 1;
  const [fin, re] = [ONE.add(amount(financeRate)), ONE.add(amount(reinvestRate))];
  let [out, into] = [ZERO, ZERO];
  a.forEach((c, k) => {
    if (c.numerator < 0n) out = out.add(c.divide(fin.pow(k)));
    else into = into.add(c.multiply(re.pow(n - k)));
  });
  if (out.numerator === 0n || into.numerator === 0n) refuse("bad-flows", "the modified rate needs money going out and money coming in");
  const root = power(into.divide(out.negate()), Q(1, n), digits);
  return root instanceof RationalInterval ? new RationalInterval(root.low.subtract(ONE), root.high.subtract(ONE)) : root.subtract(ONE);
}

/**
 * When the money comes back. { period: the first whole period at which the
 * running total is no longer negative (null if never), fractional: the
 * same with the last period split in proportion, cumulative }. With a rate
 * the flows are discounted first.
 */
export function payback(flows, { rate = 0 } = {}) {
  const x = ONE.add(amount(rate));
  const a = flows.map((c, k) => amount(c).divide(x.pow(k)));
  const cumulative = [];
  let run = ZERO;
  let period = null;
  let fractional = null;
  a.forEach((c, k) => {
    const before = run;
    run = run.add(c);
    cumulative.push(run);
    if (period === null && run.numerator >= 0n && (k > 0 || a.length === 1)) {
      period = k;
      fractional = c.numerator === 0n || before.numerator >= 0n ? Q(k) : Q(k - 1).add(before.negate().divide(c));
    }
  });
  return { period, fractional, cumulative };
}

/** What a nominal amount `periods` from now is worth in today's money: amount/(1 + inflation)^periods. */
export const realValue = (nominal, inflation, periods, opts = {}) => times(power(ONE.add(amount(inflation)), amount(periods).negate(), opts.digits), amount(nominal));
/** What today's amount becomes after `periods` of inflation: amount·(1 + inflation)^periods. */
export const nominalValue = (real, inflation, periods, opts = {}) => times(power(ONE.add(amount(inflation)), amount(periods), opts.digits), amount(real));

export const DEPRECIATION = Object.freeze(["straight-line", "declining-balance", "sum-of-years-digits", "units-of-production"]);
/**
 * A depreciation schedule: [{ period, depreciation, accumulated, bookValue }].
 * Methods: "straight-line"; "declining-balance" (rate factor/life on the
 * book value, default factor 2, never below salvage, and with
 * switchToStraightLine it changes over when that writes off more);
 * "sum-of-years-digits"; "units-of-production" (units: use in each period,
 * totalUnits: the whole life's use, default their sum).
 */
export function depreciation({ cost, salvage = 0, life, method = "straight-line", factor = 2, switchToStraightLine = false, units, totalUnits, rounding = false } = {}) {
  const [C, S] = [amount(cost), amount(salvage)];
  const r = rounder(rounding);
  const base = C.subtract(S);
  if (base.numerator < 0n) refuse("bad-asset", "salvage is at most the cost");
  const n = method === "units-of-production" ? (Array.isArray(units) ? units.length : refuse("bad-asset", "give the units used in each period")) : life;
  if (!Number.isInteger(n) || n < 1) refuse("bad-asset", "the life is a whole number of periods, at least 1");
  const rows = [];
  let book = C;
  const allUnits = method === "units-of-production" ? amount(totalUnits ?? units.map(amount).reduce((a, b) => a.add(b), ZERO)) : null;
  for (let k = 1; k <= n; k++) {
    const room = book.subtract(S);
    let d;
    if (method === "straight-line") d = base.divide(Q(n));
    else if (method === "sum-of-years-digits") d = base.multiply(Q(n - k + 1)).divide(Q((n * (n + 1)) / 2));
    else if (method === "units-of-production") d = base.multiply(amount(units[k - 1])).divide(allUnits);
    else if (method === "declining-balance") {
      d = book.multiply(amount(factor)).divide(Q(n));
      const line = room.divide(Q(n - k + 1));
      if (switchToStraightLine && line.compareTo(d) > 0) d = line;
    } else refuse("bad-method", `the method is one of ${DEPRECIATION.join(", ")}`);
    d = r(d);
    if (d.compareTo(room) > 0 || (k === n && method !== "declining-balance" && method !== "units-of-production")) d = room; // the last period takes what is left, so the total is exact
    book = book.subtract(d);
    rows.push({ period: k, depreciation: d, accumulated: C.subtract(book), bookValue: book });
  }
  return rows;
}

/**
 * A tax, or any charge, given as brackets: [{ upTo, rate }, …] in
 * increasing order, the last with no upTo. No jurisdiction's table is
 * built in; you supply the numbers. Returns { on(income), brackets }: on()
 * gives { tax, marginalRate, averageRate, parts }.
 */
export function taxSchedule(brackets, { rounding = false } = {}) {
  if (!Array.isArray(brackets) || !brackets.length) refuse("bad-brackets", "give the brackets as a list of { upTo, rate }");
  const r = rounder(rounding);
  const rows = brackets.map((b, k) => ({ upTo: b.upTo === undefined || b.upTo === null || b.upTo === Infinity ? null : amount(b.upTo), rate: amount(b.rate), k }));
  rows.forEach((b, k) => {
    if (b.upTo === null && k !== rows.length - 1) refuse("bad-brackets", "only the last bracket is open-ended");
    if (k > 0 && b.upTo !== null && b.upTo.compareTo(rows[k - 1].upTo) <= 0) refuse("bad-brackets", "the brackets go up");
  });
  if (rows[rows.length - 1].upTo !== null) refuse("bad-brackets", "the last bracket has no upTo, so every income is covered");
  return {
    brackets: rows.map(({ upTo, rate }) => ({ upTo, rate })),
    on(income) {
      const y = amount(income);
      let from = ZERO;
      let tax = ZERO;
      let marginalRate = rows[0].rate;
      const parts = [];
      for (const b of rows) {
        if (y.compareTo(from) <= 0) break;
        const top = b.upTo === null || y.compareTo(b.upTo) < 0 ? y : b.upTo;
        const slice = top.subtract(from);
        const part = slice.multiply(b.rate);
        parts.push({ from, to: top, rate: b.rate, tax: part });
        tax = tax.add(part);
        marginalRate = b.rate;
        if (b.upTo === null) break;
        from = b.upTo;
      }
      tax = r(tax);
      return { tax, marginalRate, averageRate: y.numerator > 0n ? tax.divide(y) : ZERO, parts, afterTax: y.subtract(tax) };
    },
  };
}
