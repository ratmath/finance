// Scenarios: accounts, flows of money between them and rates that change,
// projected period by period into a table of balances. The projection is
// exact, so two scenarios can be compared to the cent, and because it is
// an exact rational function of its inputs its derivatives are exact too:
// `sensitivity` carries them through the projection alongside the values.
import { Rational } from "@ratmath/core";
import { refuse, amount, ZERO, ONE, Q, rounder, date } from "./money.js";

/** A value together with its derivative with respect to one chosen input. */
export class Dual {
  constructor(v, d = ZERO) {
    this.v = v;
    this.d = d;
    this.isDual = true;
  }
  add(o) {
    return A.add(this, amount(o));
  }
  subtract(o) {
    return A.sub(this, amount(o));
  }
  multiply(o) {
    return A.mul(this, amount(o));
  }
  divide(o) {
    return A.div(this, amount(o));
  }
  negate() {
    return new Dual(this.v.negate(), this.d.negate());
  }
  pow(n) {
    return A.pow(this, Number(n));
  }
  compareTo(o) {
    return this.v.compareTo(A.val(amount(o)));
  }
  toString() {
    return this.v.toString();
  }
}
const isD = (x) => x instanceof Dual;
const lift = (x) => (isD(x) ? x : new Dual(x, ZERO));
// arithmetic that works on Rationals and carries derivatives when a Dual is involved
const A = {
  val: (x) => (isD(x) ? x.v : x),
  add: (a, b) => (isD(a) || isD(b) ? new Dual(lift(a).v.add(lift(b).v), lift(a).d.add(lift(b).d)) : a.add(b)),
  sub: (a, b) => (isD(a) || isD(b) ? new Dual(lift(a).v.subtract(lift(b).v), lift(a).d.subtract(lift(b).d)) : a.subtract(b)),
  mul(a, b) {
    if (!isD(a) && !isD(b)) return a.multiply(b);
    const [x, y] = [lift(a), lift(b)];
    return new Dual(x.v.multiply(y.v), x.d.multiply(y.v).add(x.v.multiply(y.d)));
  },
  div(a, b) {
    if (!isD(a) && !isD(b)) return a.divide(b);
    const [x, y] = [lift(a), lift(b)];
    return new Dual(x.v.divide(y.v), x.d.multiply(y.v).subtract(x.v.multiply(y.d)).divide(y.v.multiply(y.v)));
  },
  pow(a, n) {
    if (!isD(a)) return a.pow(n);
    return n === 0 ? new Dual(ONE, ZERO) : new Dual(a.v.pow(n), a.d.multiply(a.v.pow(n - 1)).multiply(Q(n)));
  },
  neg: (a) => (isD(a) ? a.negate() : a.negate()),
  sign: (a) => {
    const n = A.val(a).numerator;
    return n > 0n ? 1 : n < 0n ? -1 : 0;
  },
  cmp: (a, b) => A.val(a).compareTo(A.val(b)),
};

const monthLabel = (start, k) => {
  const d = start.addMonths(k);
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}`;
};

export class Scenario {
  /**
   * { periods, periodsPerYear = 12, start ("2027-01", optional), accounts,
   * flows, rounding = false }.
   * An account: { name, balance = 0, rate = 0 (annual, credited each period
   * as rate/periodsPerYear; a negative balance is a debt and is charged the
   * same way), rateChanges: [{ from: period, rate }], rates (one annual rate
   * per period, overriding the others while it lasts) }.
   * A flow: { name, amount, to, from, start = 1, end, every = 1, at (one
   * period only), growth (a rate applied once a year from the flow's start),
   * until: "paid" (stop when the `to` account is no longer in debt), then
   * (an account that receives the money once that happens), index (one
   * multiplier per period; a zero skips the period) }. A flow with
   * only `to` is money arriving; with only `from`, money leaving.
   * Each period: interest on the opening balances, then the flows in order.
   */
  constructor({ periods, periodsPerYear = 12, start, accounts = [], flows = [], rounding = false, name } = {}) {
    if (!Number.isInteger(periods) || periods < 1 || periods > 2400) refuse("bad-scenario", "periods is a whole number from 1 to 2400");
    this.name = name;
    this.periods = periods;
    this.periodsPerYear = periodsPerYear;
    this.start = start === undefined ? null : date(start);
    if (this.start && periodsPerYear !== 12) refuse("bad-scenario", "a start month needs monthly periods");
    this.rounding = rounding;
    const when = (x, what) => {
      if (x === undefined || x === null) return null;
      if (Number.isInteger(x) && x >= 1) return x;
      if (typeof x === "string" && this.start) {
        const d = date(x);
        return (d.year - this.start.year) * 12 + (d.month - this.start.month) + 1;
      }
      return refuse("bad-scenario", `${what} is a period number${this.start ? ' or a month such as "2028-06"' : ""}`);
    };
    const names = new Set();
    this.accounts = accounts.map((a) => {
      if (typeof a.name !== "string" || names.has(a.name)) refuse("bad-scenario", "each account has its own name");
      names.add(a.name);
      if (a.rates !== undefined && !Array.isArray(a.rates)) refuse("bad-scenario", "rates is a list of annual rates, one per period");
      return { name: a.name, balance: amount(a.balance ?? 0), rate: amount(a.rate ?? 0), rates: a.rates ? a.rates.map(amount) : null, rateChanges: (a.rateChanges ?? []).map((c) => ({ from: when(c.from, "a rate change"), rate: amount(c.rate) })).sort((p, q) => p.from - q.from) };
    });
    if (!this.accounts.length) refuse("bad-scenario", "a scenario has at least one account");
    const known = (n, f) => (n === undefined || n === null ? null : names.has(n) ? n : refuse("bad-scenario", `flow "${f}" names an account "${n}" that does not exist`));
    this.flows = flows.map((f, k) => {
      const label = f.name ?? `flow ${k + 1}`;
      const flow = { name: label, amount: amount(f.amount), to: known(f.to, label), from: known(f.from, label), then: known(f.then, label), start: when(f.at ?? f.start, "a flow's start") ?? 1, end: f.at !== undefined ? when(f.at, "at") : when(f.end, "a flow's end"), every: f.every ?? 1, growth: f.growth === undefined ? null : amount(f.growth), index: f.index ? f.index.map(amount) : null, until: f.until ?? null };
      if (f.index !== undefined && !Array.isArray(f.index)) refuse("bad-scenario", `flow "${label}": index is a list of multipliers, one per period`);
      if (!flow.to && !flow.from) refuse("bad-scenario", `flow "${label}" needs an account to come from or go to`);
      if (!Number.isInteger(flow.every) || flow.every < 1) refuse("bad-scenario", "every is a whole number of periods");
      if (flow.until !== null && (flow.until !== "paid" || !flow.to)) refuse("bad-scenario", 'until is "paid", on a flow into an account that is in debt');
      return flow;
    });
  }
  /** The projection: one row per period. */
  project() {
    const r = this.rounding === false ? (x) => x : ((f) => (x) => (isD(x) ? refuse("bad-scenario", "sensitivity needs an unrounded scenario") : f(x)))(rounder(this.rounding));
    const m = Q(this.periodsPerYear);
    const bal = Object.fromEntries(this.accounts.map((a) => [a.name, a.balance]));
    const rows = [];
    const sums = { interest: Object.fromEntries(this.accounts.map((a) => [a.name, ZERO])), flows: Object.fromEntries(this.flows.map((f) => [f.name, ZERO])) };
    const minimum = Object.fromEntries(this.accounts.map((a) => [a.name, { balance: a.balance, period: 0 }]));
    let firstNegative = null;
    const net = () => Object.values(bal).reduce((s, x) => A.add(s, x), ZERO);
    const opening = { period: 0, date: this.start ? monthLabel(this.start, -1) : null, balances: { ...bal }, interest: {}, flows: {}, netWorth: net() };
    for (let k = 1; k <= this.periods; k++) {
      const row = { period: k, date: this.start ? monthLabel(this.start, k - 1) : null, interest: {}, flows: {} };
      for (const a of this.accounts) {
        let rate = a.rate;
        for (const c of a.rateChanges) if (c.from <= k) rate = c.rate;
        if (a.rates && k <= a.rates.length) rate = a.rates[k - 1];
        const interest = r(A.mul(bal[a.name], A.div(rate, m)));
        bal[a.name] = A.add(bal[a.name], interest);
        row.interest[a.name] = interest;
        sums.interest[a.name] = A.add(sums.interest[a.name], interest);
      }
      for (const f of this.flows) {
        if (k < f.start || (f.end !== null && k > f.end) || (k - f.start) % f.every !== 0) continue;
        let x = f.amount;
        if (f.growth !== null) x = A.mul(x, A.pow(A.add(ONE, f.growth), Math.floor((k - f.start) / this.periodsPerYear)));
        if (f.index && k <= f.index.length) {
          if (f.index[k - 1].numerator === 0n) continue;
          x = A.mul(x, f.index[k - 1]);
        }
        x = r(x);
        let into = f.to;
        let spill = null;
        if (f.until === "paid") {
          const owed = A.neg(bal[f.to]);
          if (A.sign(owed) <= 0) {
            if (!f.then) continue;
            into = f.then;
          } else if (A.cmp(x, owed) > 0) {
            if (f.then) spill = A.sub(x, owed);
            if (!f.then) x = owed;
          }
        }
        if (f.from) bal[f.from] = A.sub(bal[f.from], x);
        if (spill) {
          bal[into] = A.add(bal[into], A.sub(x, spill));
          bal[f.then] = A.add(bal[f.then], spill);
        } else if (into) bal[into] = A.add(bal[into], x);
        row.flows[f.name] = x;
        sums.flows[f.name] = A.add(sums.flows[f.name], x);
      }
      row.balances = { ...bal };
      row.netWorth = net();
      for (const a of this.accounts) {
        if (A.cmp(bal[a.name], minimum[a.name].balance) < 0) minimum[a.name] = { balance: bal[a.name], period: k };
        if (firstNegative === null && A.sign(bal[a.name]) < 0 && A.sign(a.balance) >= 0) firstNegative = { account: a.name, period: k, date: row.date };
      }
      rows.push(row);
    }
    return { name: this.name, opening, rows, final: { ...bal }, netWorth: net(), minimum, firstNegative, totals: sums, accounts: this.accounts.map((a) => a.name) };
  }
}
export const scenario = (spec) => (spec instanceof Scenario ? spec : new Scenario(spec));

/**
 * Scenarios side by side: compare({ rent: {...}, buy: {...} }).
 * { rows: [{ name, netWorth, difference (from the first), minimum }],
 * best, series (net worth by period for each), crossovers (the periods at
 * which the order of two scenarios changes) }. `measure` picks another
 * outcome than final net worth.
 */
export function compare(scenarios, { measure = (p) => p.netWorth } = {}) {
  const entries = Object.entries(scenarios);
  if (entries.length < 2) refuse("bad-comparison", "compare at least two scenarios");
  const runs = entries.map(([name, s]) => ({ name, projection: scenario(s).project() }));
  const rows = runs.map(({ name, projection }) => ({ name, outcome: measure(projection), netWorth: projection.netWorth, firstNegative: projection.firstNegative, lowest: Object.entries(projection.minimum).reduce((m, [account, v]) => (m === null || v.balance.compareTo(m.balance) < 0 ? { account, ...v } : m), null) }));
  rows.forEach((row) => (row.difference = row.outcome.subtract(rows[0].outcome)));
  const best = rows.reduce((b, row) => (row.outcome.compareTo(b.outcome) > 0 ? row : b)).name;
  const series = Object.fromEntries(runs.map(({ name, projection }) => [name, [projection.opening.netWorth, ...projection.rows.map((x) => x.netWorth)]]));
  const crossovers = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const [a, b] = [series[runs[i].name], series[runs[j].name]];
      let last = 0;
      for (let k = 0; k < Math.min(a.length, b.length); k++) {
        const s = a[k].compareTo(b[k]);
        if (s !== 0 && last !== 0 && Math.sign(s) !== last) crossovers.push({ period: k, ahead: s > 0 ? runs[i].name : runs[j].name, behind: s > 0 ? runs[j].name : runs[i].name });
        if (s !== 0) last = Math.sign(s);
      }
    }
  }
  return { rows, best, series, crossovers };
}

/**
 * Which input moves the outcome most. `build` takes the inputs and returns
 * a scenario (or its description); `inputs` gives their values. Each input
 * in turn is carried through the projection with its derivative, so
 * `derivative` is the exact rate of change of the outcome, not a difference
 * quotient. Rows are sorted by `perPercent`, the change in the outcome for
 * a 1% change in the input; `elasticity` is the same as a share of the
 * outcome. Inside `build` do arithmetic on the inputs with .add, .subtract,
 * .multiply and .divide. The scenario must be unrounded.
 */
export function sensitivity(build, inputs, { measure = (p) => p.netWorth } = {}) {
  const names = Object.keys(inputs);
  const values = Object.fromEntries(names.map((n) => [n, amount(inputs[n])]));
  const run = (active) => {
    const duals = Object.fromEntries(names.map((n) => [n, new Dual(values[n], n === active ? ONE : ZERO)]));
    return lift(measure(scenario(build(duals)).project()));
  };
  const base = run(null).v;
  const rows = names.map((n) => {
    const d = run(n).d;
    const perPercent = d.multiply(values[n]).divide(Q(100));
    return { input: n, value: values[n], derivative: d, perPercent, elasticity: base.numerator === 0n ? null : d.multiply(values[n]).divide(base) };
  });
  const abs = (q) => (q.numerator < 0n ? q.negate() : q);
  rows.sort((a, b) => abs(b.perPercent).compareTo(abs(a.perPercent)));
  return { base, rows, most: rows[0]?.input ?? null };
}
