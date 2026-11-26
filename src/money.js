// Money as exact rationals. An amount is a Core Rational; nothing is rounded
// unless a rounding rule is named, and then the rule says how. Also here:
// calendar dates and day-count conventions, and the certified power that
// the rest of the package uses when an exponent is not a whole number.
import { Rational, RationalInterval } from "@ratmath/core";
import { enclose } from "@ratmath/analytic";

export class FinanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FinanceError";
    this.code = code;
  }
}
export const refuse = (code, message) => {
  throw new FinanceError(code, message);
};

export const ZERO = new Rational(0n);
export const ONE = new Rational(1n);
export const Q = (n, d = 1) => new Rational(BigInt(n), BigInt(d));

/**
 * An exact amount or rate from a whole number, a bigint, a Rational or a
 * string: "1234.56", "1,234.56", "$1,234.56", "7/8", "4.5%" (= 9/200),
 * "-250". A JavaScript number that is not whole is refused, since 0.1 is
 * not one tenth.
 */
export function amount(x) {
  if (x instanceof Rational) return x;
  if (typeof x === "bigint") return new Rational(x);
  if (typeof x === "number") {
    if (Number.isSafeInteger(x)) return new Rational(BigInt(x));
    refuse("inexact", `${x} is a floating-point number; write it as a string ("${x}") so its exact value is the one you typed`);
  }
  if (typeof x === "string") {
    let s = x.trim().replace(/[\s,_]/g, "").replace(/^([-+]?)[$€£¥]/, "$1").replace(/−/g, "-");
    const percent = s.endsWith("%");
    if (percent) s = s.slice(0, -1);
    let q = null;
    const dec = /^([-+]?)(\d*)\.?(\d*)$/.exec(s);
    if (dec && (dec[2] || dec[3])) q = new Rational(BigInt((dec[1] === "-" ? "-" : "") + (dec[2] || "0") + dec[3]), 10n ** BigInt(dec[3].length));
    const frac = /^([-+]?\d+)\/(\d+)$/.exec(s);
    if (frac && BigInt(frac[2]) !== 0n) q = new Rational(BigInt(frac[1]), BigInt(frac[2]));
    if (q) return percent ? q.divide(Q(100)) : q;
  }
  if (x && typeof x === "object" && x.isDual) return x;
  refuse("bad-number", `cannot read ${String(x)} as an exact amount`);
}
/** A rate: the same reading as `amount`, so "5%" and "0.05" are both 1/20. */
export const rate = amount;

const MODES = new Set(["half-even", "half-up", "half-down", "up", "down", "floor", "ceil"]);
/**
 * Round to a number of decimal places under a named rule. half-even is
 * banker's rounding; half-up sends a tie away from zero (the commercial
 * rule) and half-down towards it; up and down are away from and towards
 * zero; floor and ceil are towards −∞ and +∞.
 */
export function round(x, { places = 2, mode = "half-even" } = {}) {
  if (!MODES.has(mode)) refuse("bad-rounding", `the rounding mode is one of ${[...MODES].join(", ")}`);
  if (!Number.isInteger(places) || places < -30 || places > 60) refuse("bad-rounding", "places is a whole number from -30 to 60");
  const q = amount(x);
  const scale = places >= 0 ? Q(10n ** BigInt(places)) : Q(1n, 10n ** BigInt(-places));
  const y = q.multiply(scale);
  const [n, d] = [y.numerator, y.denominator];
  const neg = n < 0n;
  const a = neg ? -n : n;
  let whole = a / d;
  const rem = a % d;
  if (rem !== 0n) {
    const twice = 2n * rem;
    const tie = twice === d;
    let bump;
    if (mode === "up") bump = true;
    else if (mode === "down") bump = false;
    else if (mode === "floor") bump = neg;
    else if (mode === "ceil") bump = !neg;
    else if (twice > d) bump = true;
    else if (!tie) bump = false;
    else bump = mode === "half-up" ? true : mode === "half-down" ? false : whole % 2n === 1n;
    if (bump) whole += 1n;
  }
  return new Rational(neg ? -whole : whole).divide(scale);
}
/** rounding rule from an option: false or "none" for no rounding, a number of places, or { places, mode } */
export function rounder(rule) {
  if (rule === false || rule === null || rule === "none") return (x) => x;
  const r = rule === undefined || rule === true ? {} : typeof rule === "number" ? { places: rule } : typeof rule === "string" ? { mode: rule } : rule;
  round(ZERO, r);
  return (x) => round(x, r);
}

/** "1,234.50" from an exact amount: rounded for display only, by the rule given */
export function format(x, { places = 2, mode = "half-even", currency = "", separator = ",", percent = false } = {}) {
  let q = amount(x);
  if (percent) q = q.multiply(Q(100));
  const r = round(q, { places, mode });
  const neg = r.numerator < 0n;
  const scaled = (neg ? -r.numerator : r.numerator) * 10n ** BigInt(Math.max(places, 0)) / r.denominator;
  let digits = scaled.toString().padStart(Math.max(places, 0) + 1, "0");
  const whole = places > 0 ? digits.slice(0, -places) : digits;
  const part = places > 0 ? "." + digits.slice(-places) : "";
  const grouped = separator ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, separator) : whole;
  return `${neg ? "-" : ""}${currency}${grouped}${part}${percent ? "%" : ""}`;
}

/**
 * Split a total into parts in proportion to weights so that the rounded
 * parts add up to the total exactly: each part is rounded down and the
 * units left over go to the parts with the largest remainders.
 */
export function allocate(total, weights, { places = 2 } = {}) {
  const t = amount(total);
  const w = weights.map(amount);
  const sum = w.reduce((a, b) => a.add(b), ZERO);
  if (w.some((x) => x.numerator < 0n) || sum.numerator === 0n) refuse("bad-weights", "weights are non-negative and not all zero");
  const unit = Q(1n, 10n ** BigInt(places));
  if (!round(t, { places, mode: "down" }).equals(t)) refuse("bad-total", `the total has more than ${places} decimal places`);
  const exact = w.map((x) => t.multiply(x).divide(sum));
  const parts = exact.map((x) => round(x, { places, mode: "floor" }));
  let left = t.subtract(parts.reduce((a, b) => a.add(b), ZERO)).divide(unit).numerator;
  const order = exact.map((x, i) => [x.subtract(parts[i]), i]).sort((a, b) => b[0].compareTo(a[0]) || a[1] - b[1]);
  for (let k = 0; left > 0n; k++, left -= 1n) parts[order[k % order.length][1]] = parts[order[k % order.length][1]].add(unit);
  return parts;
}

// ---- certified powers ----------------------------------------------------------

const iroot = (n, k) => {
  // the exact k-th root of a non-negative bigint, or null
  if (n < 2n) return n;
  let lo = 1n;
  let hi = 1n << BigInt(Math.ceil(n.toString(2).length / k) + 1);
  while (lo < hi) {
    const mid = (lo + hi + 1n) >> 1n;
    if (mid ** BigInt(k) <= n) lo = mid;
    else hi = mid - 1n;
  }
  return lo ** BigInt(k) === n ? lo : null;
};
const point = (q) => new RationalInterval(q, q);
const bitsFor = (digits) => Math.ceil(digits * 3.33) + 40;
/** e^x enclosed for a rational or an interval */
export const exp = (x, digits = 12) => enclose.exp(x instanceof RationalInterval ? x : point(amount(x)), bitsFor(digits));
/** ln x enclosed */
export const ln = (x, digits = 12) => enclose.log(x instanceof RationalInterval ? x : point(amount(x)), bitsFor(digits));
/**
 * base^exponent for a positive rational base. Exact (a Rational) when the
 * exponent is whole or the root comes out rational; otherwise an interval
 * proven to contain the value, narrow to about `digits` digits.
 */
export function power(base, exponent, digits = 12) {
  const b = amount(base);
  const e = amount(exponent);
  if (e.denominator === 1n) {
    if (b.numerator === 0n && e.numerator <= 0n) refuse("division", "zero to a power that is not positive");
    return e.numerator >= 0n ? b.pow(e.numerator) : ONE.divide(b.pow(-e.numerator));
  }
  if (b.numerator <= 0n) refuse("domain", "a fractional power needs a positive base");
  if (e.denominator < 4096n) {
    const k = Number(e.denominator);
    const [n, d] = [iroot(b.numerator, k), iroot(b.denominator, k)];
    if (n !== null && d !== null) return power(new Rational(n, d), new Rational(e.numerator), digits);
  }
  const bits = bitsFor(digits) + Math.max(0, e.toNumber() > 0 ? Math.ceil(Math.log2(1 + Math.abs(e.toNumber() * Math.log(b.toNumber())))) * 2 : 0);
  const l = enclose.log(point(b), bits);
  const [u, v] = [l.low.multiply(e), l.high.multiply(e)];
  return enclose.exp(u.compareTo(v) <= 0 ? new RationalInterval(u, v) : new RationalInterval(v, u), bits);
}
/** the low and high ends of an exact number or an interval */
export const ends = (x) => (x instanceof RationalInterval ? [x.low, x.high] : [x, x]);
/**
 * An exact number or an interval as a decimal with `places` places. For an
 * interval both ends are rounded: when they agree, that is the correctly
 * rounded value, proven; when a rounding boundary falls inside it, the two
 * ends are shown.
 */
export function show(x, places = 6) {
  if (!(x instanceof RationalInterval)) return format(x, { places, separator: "" });
  const [a, b] = [format(x.low, { places, separator: "" }), format(x.high, { places, separator: "" })];
  return a === b ? a : `[${format(x.low, { places, mode: "floor", separator: "" })}, ${format(x.high, { places, mode: "ceil", separator: "" })}]`;
}

// ---- dates and day counts ------------------------------------------------------

// days from 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's algorithm)
const toDays = (y, m, d) => {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
};
const fromDays = (z) => {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
};
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const monthLength = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/** A calendar date, with no time of day and no time zone. */
export class CalendarDate {
  constructor(year, month, day) {
    if (![year, month, day].every(Number.isInteger) || month < 1 || month > 12 || day < 1 || day > monthLength(year, month)) refuse("bad-date", `${year}-${month}-${day} is not a date`);
    Object.assign(this, { year, month, day });
  }
  get serial() {
    return toDays(this.year, this.month, this.day);
  }
  get isEndOfMonth() {
    return this.day === monthLength(this.year, this.month);
  }
  addDays(n) {
    return new CalendarDate(...fromDays(this.serial + n));
  }
  /** n months later; a day past the end of the month becomes its last day, and with endOfMonth a month-end stays a month-end */
  addMonths(n, { endOfMonth = false } = {}) {
    const k = this.year * 12 + (this.month - 1) + n;
    const [y, m] = [Math.floor(k / 12), (((k % 12) + 12) % 12) + 1];
    const last = monthLength(y, m);
    return new CalendarDate(y, m, endOfMonth && this.isEndOfMonth ? last : Math.min(this.day, last));
  }
  compareTo(o) {
    return this.serial - date(o).serial;
  }
  equals(o) {
    return this.compareTo(o) === 0;
  }
  toString() {
    return `${String(this.year).padStart(4, "0")}-${String(this.month).padStart(2, "0")}-${String(this.day).padStart(2, "0")}`;
  }
}
/** A date from "2027-03-15", "2027-03" (the first of the month), [y, m, d] or a CalendarDate. */
export function date(x) {
  if (x instanceof CalendarDate) return x;
  if (Array.isArray(x)) return new CalendarDate(...x);
  const m = typeof x === "string" && /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(x.trim());
  if (!m) refuse("bad-date", `write a date as "2027-03-15", not ${String(x)}`);
  return new CalendarDate(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 1);
}
export const daysBetween = (a, b) => date(b).serial - date(a).serial;

export const DAY_COUNTS = Object.freeze(["30/360", "30E/360", "actual/360", "actual/365", "actual/actual"]);
/**
 * Days and the fraction of a year between two dates under a convention:
 * "30/360" (US bond basis), "30E/360" (Eurobond), "actual/360",
 * "actual/365" (fixed) or "actual/actual" (ISDA: each day counts 1/365 or
 * 1/366 according to the year it falls in). { days, yearFraction }, exact.
 */
export function dayCount(from, to, convention = "actual/actual") {
  const [a, b] = [date(from), date(to)];
  const actual = b.serial - a.serial;
  const thirty = (d1, d2) => 360 * (b.year - a.year) + 30 * (b.month - a.month) + (d2 - d1);
  switch (convention) {
    case "30/360": {
      const d1 = a.day === 31 ? 30 : a.day;
      const d2 = b.day === 31 && d1 === 30 ? 30 : b.day;
      const days = thirty(d1, d2);
      return { days, yearFraction: Q(days, 360) };
    }
    case "30E/360": {
      const days = thirty(Math.min(a.day, 30), Math.min(b.day, 30));
      return { days, yearFraction: Q(days, 360) };
    }
    case "actual/360":
      return { days: actual, yearFraction: Q(actual, 360) };
    case "actual/365":
      return { days: actual, yearFraction: Q(actual, 365) };
    case "actual/actual": {
      if (actual < 0) {
        const r = dayCount(b, a, convention);
        return { days: actual, yearFraction: r.yearFraction.negate() };
      }
      let f = ZERO;
      for (let y = a.year; y <= b.year; y++) {
        const lo = Math.max(a.serial, toDays(y, 1, 1));
        const hi = Math.min(b.serial, toDays(y + 1, 1, 1));
        if (hi > lo) f = f.add(Q(hi - lo, isLeap(y) ? 366 : 365));
      }
      return { days: actual, yearFraction: f };
    }
    default:
      refuse("bad-convention", `the day count is one of ${DAY_COUNTS.join(", ")}`);
  }
}
