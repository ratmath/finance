// Loans: amortisation schedules under a stated rounding rule, with extra
// payments, interest-only periods, balloons and changes of rate; comparing
// and refinancing; revolving credit. Every row is exact to the cent and the
// last payment is whatever clears the balance, shown as such.
import { Rational, RationalInterval } from "@ratmath/core";
import { refuse, amount, ZERO, ONE, Q, rounder, power, format } from "./money.js";
import { tvm } from "./tvm.js";

const sum = (xs) => xs.reduce((a, b) => a.add(b), ZERO);
const pos = (x) => x.numerator > 0n;
const min = (a, b) => (a.compareTo(b) <= 0 ? a : b);
const wholeNumber = (n, what) => (Number.isInteger(n) && n >= 0 ? n : refuse("bad-periods", `${what} is a whole number that is not negative`));

/** the level payment that takes a balance to `balloon` in n periods at a periodic rate, exactly */
export function levelPayment(balance, periodicRate, periods, balloon = 0) {
  const [B, i, F] = [amount(balance), amount(periodicRate), amount(balloon)];
  const n = wholeNumber(periods, "the number of payments");
  if (n === 0) refuse("bad-periods", "a loan has at least one payment");
  if (i.numerator === 0n) return B.subtract(F).divide(Q(n));
  const v = ONE.divide(ONE.add(i).pow(n));
  return B.subtract(F.multiply(v)).multiply(i).divide(ONE.subtract(v));
}

/**
 * A loan and its schedule.
 *   loan({ principal: 250000, rate: "6%", periods: 360 })
 * `rate` is the nominal annual rate; the rate per period is rate/periodsPerYear.
 * Options: payment (fix it yourself; then periods may be left out),
 * rounding ({ places, mode }, a number of places, or false for none),
 * extra (an amount every period, { period: amount }, or (period, balance) => amount),
 * interestOnly (a number of opening periods), balloon (left owing and paid
 * with the last payment), rateChanges ([{ from: period, rate }]; the payment
 * is worked out again from that period unless you fixed it).
 */
export function loan({ principal, rate, periods, periodsPerYear = 12, payment, rounding, extra = 0, interestOnly = 0, balloon = 0, rateChanges = [] } = {}) {
  const P = amount(principal);
  const F = amount(balloon);
  const m = amount(periodsPerYear);
  const r = rounder(rounding);
  if (!pos(P)) refuse("bad-loan", "the principal is positive");
  if (periods === undefined && payment === undefined) refuse("bad-loan", "give the number of periods, the payment, or both");
  const n = periods === undefined ? null : wholeNumber(periods, "the number of periods");
  wholeNumber(interestOnly, "interestOnly");
  if (n !== null && interestOnly >= n) refuse("bad-loan", "the interest-only periods must end before the loan does");
  const changes = new Map(rateChanges.map((c) => [wholeNumber(c.from, "a rate change's period"), amount(c.rate).divide(m)]));
  const extraAt = typeof extra === "function" ? (k, b) => amount(extra(k, b) ?? 0) : extra !== null && typeof extra === "object" && !(extra instanceof Rational) ? (k) => amount(extra[k] ?? 0) : () => amount(extra);
  const fixed = payment === undefined ? null : r(amount(payment));
  let i = amount(rate).divide(m);
  let balance = P;
  let level = fixed;
  let regular = null;
  const exactPayment = n !== null && interestOnly === 0 ? levelPayment(P, i, n, F) : null;
  const schedule = [];
  if (n === null && pos(F)) refuse("bad-loan", "a balloon needs the number of periods");
  const cap = n ?? 1200;
  for (let k = 1; k <= cap && pos(balance); k++) {
    let recompute = level === null;
    if (changes.has(k)) {
      i = changes.get(k);
      recompute = recompute || fixed === null;
    }
    if (k === interestOnly + 1 && fixed === null) recompute = true;
    const interest = r(balance.multiply(i));
    const owing = balance.subtract(F);
    let final = n !== null && k === n;
    let pay = interest;
    let towards = ZERO;
    if (k > interestOnly) {
      if (recompute) level = r(levelPayment(balance, i, n - k + 1, F));
      regular ??= level;
      towards = level.subtract(interest);
      if (!pos(towards) && !final) refuse("negative-amortisation", `in period ${k} the payment ${format(level)} does not cover the interest ${format(interest)}`);
      if (final || towards.compareTo(owing) >= 0) {
        towards = owing;
        final = true;
      }
      pay = interest.add(towards);
    }
    const room = owing.subtract(towards);
    const wanted = final ? ZERO : r(extraAt(k, balance));
    if (wanted.numerator < 0n) refuse("bad-extra", "an extra payment cannot be negative");
    const more = min(wanted, room);
    if (!final && pos(more) && more.equals(room)) final = true;
    balance = balance.subtract(towards).subtract(more);
    const row = { period: k, rate: i, payment: pay, interest, principal: towards, extra: more, balance };
    if (final) {
      if (pos(balance)) row.balloon = balance;
      balance = ZERO;
      row.balance = ZERO;
    }
    schedule.push(row);
  }
  if (pos(balance)) refuse("not-repaid", `the loan is not repaid after ${cap} periods`);
  const totals = {
    payments: sum(schedule.map((s) => s.payment.add(s.extra).add(s.balloon ?? ZERO))),
    interest: sum(schedule.map((s) => s.interest)),
    principal: sum(schedule.map((s) => s.principal.add(s.extra).add(s.balloon ?? ZERO))),
    extra: sum(schedule.map((s) => s.extra)),
  };
  const lastRow = schedule[schedule.length - 1];
  return { principal: P, periodsPerYear: m, payment: regular ?? fixed ?? schedule[0].payment, exactPayment, schedule, periods: schedule.length, finalPayment: lastRow.payment, balloon: lastRow.balloon ?? ZERO, totals };
}

const asLoan = (x) => (x && x.schedule ? x : loan(x));
/** Two loans side by side: payment, number of payments, interest and total paid, and the differences (b − a). */
export function compareLoans(a, b) {
  const [A, B] = [asLoan(a), asLoan(b)];
  const row = (l) => ({ payment: l.payment, periods: l.periods, interest: l.totals.interest, total: l.totals.payments });
  return { a: row(A), b: row(B), difference: { payment: B.payment.subtract(A.payment), periods: B.periods - A.periods, interest: B.totals.interest.subtract(A.totals.interest), total: B.totals.payments.subtract(A.totals.payments) } };
}
/**
 * Refinancing: keep the current loan (its balance, rate and remaining
 * periods) or replace it with a new one that has costs. `costs` are paid
 * up front unless rollIn is true, when they are added to the new principal.
 * breakEven is the first period at which the payments saved add up to the costs.
 */
export function refinance(current, proposed, { costs = 0, rollIn = false, rounding } = {}) {
  const C = amount(costs);
  const balance = amount(current.balance ?? current.principal);
  const keep = loan({ ...current, principal: balance, rounding: current.rounding ?? rounding });
  const next = loan({ periodsPerYear: current.periodsPerYear, ...proposed, principal: rollIn ? balance.add(C) : balance, rounding: proposed.rounding ?? rounding });
  const upFront = rollIn ? ZERO : C;
  let saved = upFront.negate();
  let breakEven = null;
  const horizon = Math.max(keep.periods, next.periods);
  for (let k = 1; k <= horizon; k++) {
    const paid = (l) => (k <= l.periods ? l.schedule[k - 1].payment.add(l.schedule[k - 1].extra).add(l.schedule[k - 1].balloon ?? ZERO) : ZERO);
    saved = saved.add(paid(keep)).subtract(paid(next));
    if (breakEven === null && saved.numerator >= 0n && k <= next.periods) breakEven = k;
  }
  return { current: keep, proposed: next, costs: C, paymentChange: next.payment.subtract(keep.payment), interestSaved: keep.totals.interest.subtract(next.totals.interest), totalSaved: saved, breakEven, worthIt: saved.numerator > 0n };
}

/**
 * Revolving credit: interest on the balance each period, then a payment
 * that is a fixed amount or { percent, minimum } of the balance, then any
 * new purchases. Runs until the balance is cleared.
 */
export function revolving({ balance, rate, periodsPerYear = 12, payment, purchases = 0, rounding, maxPeriods = 1200 } = {}) {
  const r = rounder(rounding);
  const i = amount(rate).divide(amount(periodsPerYear));
  let B = amount(balance);
  const buy = typeof purchases === "function" ? (k) => amount(purchases(k) ?? 0) : () => amount(purchases);
  const due = (b) => {
    if (payment !== null && typeof payment === "object" && !(payment instanceof Rational)) {
      const pct = r(b.multiply(amount(payment.percent ?? 0)));
      const floor = amount(payment.minimum ?? 0);
      return pct.compareTo(floor) >= 0 ? pct : floor;
    }
    return r(amount(payment));
  };
  const schedule = [];
  for (let k = 1; pos(B); k++) {
    if (k > maxPeriods) refuse("not-repaid", `the balance is not cleared after ${maxPeriods} periods; the payment barely covers the interest`);
    const interest = r(B.multiply(i));
    const owed = B.add(interest);
    const pay = min(due(owed), owed);
    const bought = buy(k);
    const next = owed.subtract(pay).add(bought);
    if (!pos(pay.subtract(interest).subtract(bought)) && k > 1 && next.compareTo(schedule[schedule.length - 1].balance) >= 0 && typeof purchases !== "function" && !(payment !== null && typeof payment === "object")) refuse("never-repaid", `a payment of ${format(pay)} does not cover the interest of ${format(interest)}${pos(bought) ? " and the new purchases" : ""}, so the balance never falls`);
    schedule.push({ period: k, interest, payment: pay, purchases: bought, balance: next });
    B = next;
  }
  return { schedule, periods: schedule.length, totals: { payments: sum(schedule.map((s) => s.payment)), interest: sum(schedule.map((s) => s.interest)) } };
}

/**
 * The rate a borrower really pays once fees are counted: the borrower
 * receives principal − fees and makes the payments. { periodic, nominal
 * (the APR: periodic × periodsPerYear), effective }, each exact or enclosed.
 */
export function loanAPR({ principal, fees = 0, payment, periods, periodsPerYear = 12, balloon = 0, digits = 12 } = {}) {
  const m = amount(periodsPerYear);
  const solved = tvm({ pv: amount(principal).subtract(amount(fees)), pmt: amount(payment).negate(), fv: amount(balloon).negate(), n: periods, digits: digits + 2 });
  if (solved.count !== 1) refuse("no-rate", `expected one rate, found ${solved.count}`);
  const p = solved.rates[0].rate;
  const times = (x, k) => (x instanceof RationalInterval ? new RationalInterval(x.low.multiply(k), x.high.multiply(k)) : x.multiply(k));
  let effective;
  if (p instanceof RationalInterval) {
    const e = (q) => power(ONE.add(q), m, digits + 2);
    const [lo, hi] = [e(p.low), e(p.high)];
    effective = new RationalInterval((lo instanceof RationalInterval ? lo.low : lo).subtract(ONE), (hi instanceof RationalInterval ? hi.high : hi).subtract(ONE));
  } else {
    const e = power(ONE.add(p), m, digits);
    effective = e instanceof RationalInterval ? new RationalInterval(e.low.subtract(ONE), e.high.subtract(ONE)) : e.subtract(ONE);
  }
  return { periodic: p, nominal: times(p, m), effective, exact: solved.rates[0].exact };
}
