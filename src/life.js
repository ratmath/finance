// Life contingencies: a life table and the present values built on it. With
// a rational table and a rational interest rate every value is exact, so the
// classical identities (A = 1 − d·ä, a reserve that starts at zero) hold
// exactly rather than to rounding, and the tests check them that way.
//
// No published table is built in: the caller supplies the numbers, or uses
// de Moivre's law (a straight-line l_x) for teaching.
import { refuse, amount, ZERO, ONE, Q } from "./money.js";

export class LifeTable {
  /**
   * { l: [l at startAge, l at startAge + 1, …] } or { q: [q at startAge, …],
   * radix = 100000 }, with startAge (default 0). The table closes: everyone
   * alive at the last age dies within the year.
   */
  constructor({ l, q, radix = 100000, startAge = 0 } = {}) {
    if (!Number.isInteger(startAge) || startAge < 0) refuse("bad-table", "startAge is a whole number");
    let L;
    if (l) {
      L = l.map(amount);
      if (!L.length || L[0].numerator <= 0n) refuse("bad-table", "l starts with a positive number of lives");
      for (let k = 1; k < L.length; k++) if (L[k].compareTo(L[k - 1]) > 0 || L[k].numerator < 0n) refuse("bad-table", "l never increases and is not negative");
    } else if (q) {
      const Qs = q.map(amount);
      if (Qs.some((x) => x.numerator < 0n || x.compareTo(ONE) > 0)) refuse("bad-table", "each q is a probability");
      L = [amount(radix)];
      for (const x of Qs) L.push(L[L.length - 1].multiply(ONE.subtract(x)));
    } else refuse("bad-table", "a life table needs l or q");
    while (L.length > 1 && L[L.length - 1].numerator === 0n && L[L.length - 2].numerator === 0n) L.pop();
    if (L[L.length - 1].numerator !== 0n) L.push(ZERO);
    this.startAge = startAge;
    this.lives = L;
    this.lastAge = startAge + L.length - 2;
  }
  _age(x) {
    if (!Number.isInteger(x)) refuse("bad-age", "ages are whole numbers");
    if (x < this.startAge) refuse("bad-age", `the table starts at age ${this.startAge}`);
    return x - this.startAge;
  }
  /** lives at age x (0 past the end) */
  l(x) {
    const k = this._age(x);
    return k < this.lives.length ? this.lives[k] : ZERO;
  }
  /** deaths between x and x + 1 */
  d(x) {
    return this.l(x).subtract(this.l(x + 1));
  }
  /** probability that a life aged x survives t more years, tPx */
  p(x, t = 1) {
    const lx = this.l(x);
    if (lx.numerator === 0n) refuse("bad-age", `no one in the table is alive at ${x}`);
    return this.l(x + t).divide(lx);
  }
  /** probability that a life aged x dies within t years, tQx */
  q(x, t = 1) {
    return ONE.subtract(this.p(x, t));
  }
  /** probability of surviving u years and then dying within the next t: u|tQx */
  deferredQ(x, u, t = 1) {
    return this.l(x + u).subtract(this.l(x + u + t)).divide(this.l(x));
  }
  /** curtate expectation of life e_x = Σ_{k≥1} kPx (whole years lived) */
  curtateExpectation(x) {
    let s = ZERO;
    for (let k = 1; x + k <= this.lastAge + 1; k++) s = s.add(this.p(x, k));
    return s;
  }
  /** complete expectation under a uniform distribution of deaths within each year: e_x + 1/2 */
  completeExpectation(x) {
    return this.curtateExpectation(x).add(Q(1, 2));
  }
  /** rows { age, l, d, q, p, e } for printing */
  rows() {
    const out = [];
    for (let x = this.startAge; x <= this.lastAge; x++) out.push({ age: x, l: this.l(x), d: this.d(x), q: this.q(x), p: this.p(x), e: this.curtateExpectation(x) });
    return out;
  }
}
export const lifeTable = (spec) => new LifeTable(spec);
/** de Moivre's law: l_x = ω − x, so deaths are uniform up to the limiting age ω. */
export const deMoivre = (omega, { startAge = 0 } = {}) => {
  if (!Number.isInteger(omega) || omega <= startAge) refuse("bad-table", "ω is a whole number above the start age");
  return new LifeTable({ l: Array.from({ length: omega - startAge + 1 }, (_, k) => omega - startAge - k), startAge });
};

const vOf = (rate) => {
  const i = amount(rate);
  if (i.compareTo(ONE.negate()) <= 0) refuse("bad-rate", "the rate is above −100%");
  return ONE.divide(ONE.add(i));
};
const horizon = (table, x, term) => (term === null || term === undefined ? table.lastAge + 1 - x : term);

/**
 * Life annuity of 1 a year for a life aged x: due (payments at the start of
 * each year, ä) or immediate (at the end, a), for `term` years (default for
 * life), after `deferred` years. Exact: Σ v^k · kPx over the payment times.
 */
export function lifeAnnuity(table, { age, rate, term = null, due = true, deferred = 0 }) {
  const v = vOf(rate);
  const n = horizon(table, age + deferred, term);
  let s = ZERO;
  for (let j = 0; j < n; j++) {
    const k = deferred + j + (due ? 0 : 1);
    s = s.add(v.pow(BigInt(k)).multiply(table.p(age, k)));
  }
  return s;
}
/**
 * Life insurance of 1 paid at the end of the year of death, for a life aged
 * x: whole life (term null) or for `term` years, after `deferred` years.
 * Exact: Σ v^{k+1} · k|qx.
 */
export function lifeInsurance(table, { age, rate, term = null, deferred = 0 }) {
  const v = vOf(rate);
  const n = horizon(table, age + deferred, term);
  let s = ZERO;
  for (let j = 0; j < n; j++) {
    const k = deferred + j;
    s = s.add(v.pow(BigInt(k + 1)).multiply(table.deferredQ(age, k)));
  }
  return s;
}
/** pure endowment nEx = v^n · nPx: 1 paid at time n if the life is alive */
export const pureEndowment = (table, { age, rate, term }) => vOf(rate).pow(BigInt(term)).multiply(table.p(age, term));
/** endowment insurance: term insurance plus the pure endowment */
export const endowment = (table, { age, rate, term }) => lifeInsurance(table, { age, rate, term }).add(pureEndowment(table, { age, rate, term }));

const KINDS = new Set(["whole life", "term", "endowment"]);
const benefitValue = (table, kind, age, rate, term) => (kind === "whole life" ? lifeInsurance(table, { age, rate }) : kind === "term" ? lifeInsurance(table, { age, rate, term }) : endowment(table, { age, rate, term }));

/**
 * The level annual net premium (paid at the start of each year while alive,
 * for `payments` years) for a benefit: { kind: "whole life" | "term" |
 * "endowment", benefit = 1, age, rate, term, payments }. Exact, by the
 * equivalence principle: premium · ä = benefit · A.
 */
export function netPremium(table, { kind = "whole life", benefit = 1, age, rate, term = null, payments = null }) {
  if (!KINDS.has(kind)) refuse("bad-argument", 'kind is "whole life", "term" or "endowment"');
  if (kind !== "whole life" && (term === null || term < 1)) refuse("bad-argument", `a ${kind} policy needs a term`);
  const A = benefitValue(table, kind, age, rate, term);
  const ann = lifeAnnuity(table, { age, rate, term: payments ?? term });
  return amount(benefit).multiply(A).divide(ann);
}
/**
 * The prospective net reserve after t years: the value then of the benefit
 * still to come less the value of the premiums still to come. Zero at t = 0
 * by construction of the net premium.
 */
export function reserve(table, { kind = "whole life", benefit = 1, age, rate, term = null, payments = null, time }) {
  const P = netPremium(table, { kind, benefit, age, rate, term, payments });
  const x = age + time;
  const left = term === null ? null : term - time;
  if (left !== null && left < 0) refuse("bad-argument", "the time is past the term");
  const A = kind === "whole life" ? lifeInsurance(table, { age: x, rate }) : left === 0 ? (kind === "endowment" ? ONE : ZERO) : benefitValue(table, kind, x, rate, left);
  const pay = payments ?? term;
  const payLeft = pay === null ? null : Math.max(0, pay - time);
  const ann = payLeft === 0 ? ZERO : lifeAnnuity(table, { age: x, rate, term: payLeft });
  return amount(benefit).multiply(A).subtract(P.multiply(ann));
}
