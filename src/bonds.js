// Bonds and interest rates: price, yield, accrued interest, duration and
// convexity; discount factors, spot and forward rates from bond prices;
// immunisation. Yields are nominal annual rates compounded as often as the
// bond pays, the usual quoting convention.
import { Rational, RationalInterval } from "@ratmath/core";
import { refuse, amount, ZERO, ONE, Q, power, date, dayCount } from "./money.js";
import { rateRoots, monotoneZero } from "./solve.js";
import { total } from "./cashflow.js";

const times = (x, k) => {
  if (!(x instanceof RationalInterval)) return x.multiply(k);
  const [a, b] = [x.low.multiply(k), x.high.multiply(k)];
  return a.compareTo(b) <= 0 ? new RationalInterval(a, b) : new RationalInterval(b, a);
};
const minus = (x, k) => (x instanceof RationalInterval ? new RationalInterval(x.low.subtract(k), x.high.subtract(k)) : x.subtract(k));
const sum = (xs) => xs.reduce((a, b) => a.add(b), ZERO);

export class Bond {
  /**
   * { face = 100, coupon (annual rate), frequency = 2, redemption = face }
   * and either `periods` (whole coupon periods left, valued on a coupon
   * date) or `settlement` and `maturity` dates with a day-count convention
   * (default "30/360"), which gives accrued interest.
   */
  constructor({ face = 100, coupon = 0, frequency = 2, redemption, periods, settlement, maturity, dayCount: convention = "30/360" } = {}) {
    this.face = amount(face);
    this.coupon = amount(coupon);
    this.frequency = Number(frequency);
    if (![1, 2, 3, 4, 6, 12].includes(this.frequency)) refuse("bad-bond", "the coupon frequency is 1, 2, 3, 4, 6 or 12 a year");
    this.redemption = amount(redemption ?? face);
    this.couponAmount = this.face.multiply(this.coupon).divide(Q(this.frequency));
    this.dayCount = convention;
    if (maturity !== undefined) {
      if (settlement === undefined) refuse("bad-bond", "give the settlement date with the maturity date");
      const [s, m] = [date(settlement), date(maturity)];
      if (m.compareTo(s) <= 0) refuse("bad-bond", "the bond has already matured at settlement");
      const step = 12 / this.frequency;
      // coupon dates counted back from maturity
      let n = 0;
      while (m.addMonths(-step * (n + 1), { endOfMonth: true }).compareTo(s) > 0) n++;
      const next = m.addMonths(-step * n, { endOfMonth: true });
      const previous = m.addMonths(-step * (n + 1), { endOfMonth: true });
      const whole = dayCount(previous, next, convention).days;
      const gone = dayCount(previous, s, convention).days;
      this.periods = n + 1;
      this.settlement = s;
      this.maturity = m;
      this.accruedDays = gone;
      this.accrued = this.couponAmount.multiply(Q(gone, whole));
      this.first = Q(whole - gone, whole); // periods until the next coupon
      this.dates = Array.from({ length: n + 1 }, (_, k) => m.addMonths(-step * (n - k), { endOfMonth: true }));
    } else {
      if (!Number.isInteger(periods) || periods < 1) refuse("bad-bond", "give the whole number of coupon periods left, or settlement and maturity dates");
      this.periods = periods;
      this.accrued = ZERO;
      this.accruedDays = 0;
      this.first = ONE;
    }
  }
  /** [{ t (coupon periods from settlement), years, amount, date? }] */
  get cashflows() {
    return Array.from({ length: this.periods }, (_, k) => {
      const t = this.first.add(Q(k));
      const flow = { t, years: t.divide(Q(this.frequency)), amount: k === this.periods - 1 ? this.couponAmount.add(this.redemption) : this.couponAmount };
      if (this.dates) flow.date = this.dates[k];
      return flow;
    });
  }
  // Σ cf_k x^−k for k = 0 … n−1: the value one coupon date ahead of the first coupon, exactly
  _core(x) {
    let v = ZERO;
    for (let k = this.periods - 1; k >= 0; k--) v = v.divide(x).add(k === this.periods - 1 ? this.couponAmount.add(this.redemption) : this.couponAmount);
    return v;
  }
  _x(y) {
    const x = ONE.add(amount(y).divide(Q(this.frequency)));
    return x.numerator > 0n ? x : refuse("bad-yield", "the yield per period must be more than −100%");
  }
  /** { dirty, clean, accrued } at a yield: exact on a coupon date, otherwise the dirty and clean prices are intervals that contain them */
  price(y, { digits = 12 } = {}) {
    const x = this._x(y);
    const dirty = times(power(x, this.first.negate(), digits + 4), this._core(x));
    return { dirty, clean: minus(dirty, this.accrued), accrued: this.accrued };
  }
  /**
   * The yield to maturity at a clean price. The price falls as the yield
   * rises, so there is exactly one. A Rational when it is rational (on a
   * coupon date), otherwise an interval proven to contain it.
   */
  yield(cleanPrice, { digits = 12 } = {}) {
    const dirty = amount(cleanPrice).add(this.accrued);
    if (dirty.numerator <= 0n) refuse("bad-price", "the price is positive");
    const f = Q(this.frequency);
    if (this.first.equals(ONE)) {
      const n = this.periods;
      const c = Array.from({ length: n + 1 }, (_, k) => (k === n ? dirty.negate() : k === 0 ? this.couponAmount.add(this.redemption) : this.couponAmount));
      const found = rateRoots(c, { digits: digits + 2 });
      if (found.length !== 1) refuse("no-yield", "no yield above −100% per period gives this price");
      return times(found[0].rate, f);
    }
    const g = (y) => minus(this.price(y, { digits: digits + 6 }).dirty, dirty);
    const sgn = (v) => (v instanceof RationalInterval ? (v.low.numerator > 0n ? 1 : v.high.numerator < 0n ? -1 : 0) : Math.sign(Number(v.numerator)));
    let lo = f.multiply(Q(-1, 2));
    let hi = ONE;
    if (sgn(g(lo)) <= 0) refuse("no-yield", "the price is too high for any yield above −50% per period");
    for (let k = 0; sgn(g(hi)) >= 0; k++) {
      if (k > 40) refuse("no-yield", "the price is too low for any reasonable yield");
      hi = hi.multiply(Q(2));
    }
    return monotoneZero(g, lo, hi, { digits });
  }
  /** At a yield: Macaulay duration (years), modified duration, convexity (years²), all exact, and the price change they predict per 1% of yield. */
  duration(y) {
    const x = this._x(y);
    const f = Q(this.frequency);
    let [p, d, c] = [ZERO, ZERO, ZERO];
    this.cashflows.forEach((cf, k) => {
      const pv = cf.amount.divide(x.pow(k)); // the common factor x^−first cancels in each ratio
      p = p.add(pv);
      d = d.add(pv.multiply(cf.years));
      c = c.add(pv.multiply(cf.years).multiply(cf.years.add(ONE.divide(f))));
    });
    const macaulay = d.divide(p);
    const modified = macaulay.divide(x);
    return { macaulay, modified, convexity: c.divide(p).divide(x.multiply(x)), percentPerPoint: modified.negate() };
  }
}
export const bond = (spec) => (spec instanceof Bond ? spec : new Bond(spec));

/**
 * A curve of discount factors d_1, d_2, … for whole periods (`frequency`
 * periods a year), with the spot and forward rates they imply.
 */
export class YieldCurve {
  constructor(discountFactors, frequency = 1) {
    this.discountFactors = discountFactors.map(amount);
    this.frequency = Number(frequency);
    if (this.discountFactors.some((d) => d.numerator <= 0n)) refuse("bad-curve", "discount factors are positive");
  }
  get periods() {
    return this.discountFactors.length;
  }
  discount(k) {
    if (k === 0) return ONE;
    return Number.isInteger(k) && k >= 1 && k <= this.periods ? this.discountFactors[k - 1] : refuse("off-curve", `the curve covers periods 1 to ${this.periods}`);
  }
  /** the spot rate for k periods, as a nominal annual rate compounded `frequency` times: d_k = (1 + s/f)^−k */
  spot(k, { digits = 12 } = {}) {
    const root = power(ONE.divide(this.discount(k)), Q(1, k), digits + 2);
    return times(minus(root, ONE), Q(this.frequency));
  }
  /** the forward rate from period a to period b, nominal annual; exact when b = a + 1 */
  forward(a, b = a + 1, { digits = 12 } = {}) {
    if (!(b > a)) refuse("bad-forward", "the forward runs from an earlier period to a later one");
    const root = power(this.discount(a).divide(this.discount(b)), Q(1, b - a), digits + 2);
    return times(minus(root, ONE), Q(this.frequency));
  }
  /** the coupon rate at which a k-period bond is worth its face value, exactly */
  parYield(k) {
    let s = ZERO;
    for (let j = 1; j <= k; j++) s = s.add(this.discount(j));
    return ONE.subtract(this.discount(k)).divide(s).multiply(Q(this.frequency));
  }
  /** the price of a bond (whole periods, same frequency) off the curve, exactly */
  price(spec) {
    const b = spec instanceof Bond ? spec : bond({ frequency: this.frequency, ...spec });
    if (b.frequency !== this.frequency || !b.first.equals(ONE)) refuse("off-curve", "the bond must pay on the curve's dates");
    return sum(b.cashflows.map((cf, k) => cf.amount.multiply(this.discount(k + 1))));
  }
  get spots() {
    return this.discountFactors.map((_, k) => this.spot(k + 1));
  }
  get forwards() {
    return this.discountFactors.map((_, k) => this.forward(k, k + 1));
  }
}
/**
 * A curve from spot rates (nominal annual, compounded `frequency` times a
 * year) for 1, 2, 3, … periods, or from discount factors.
 */
export function yieldCurve({ spots, discountFactors, frequency = 1 } = {}) {
  if (discountFactors) return new YieldCurve(discountFactors, frequency);
  if (!Array.isArray(spots)) refuse("bad-curve", "give spots or discountFactors");
  return new YieldCurve(spots.map((s, k) => ONE.divide(ONE.add(amount(s).divide(Q(frequency))).pow(k + 1))), frequency);
}
/**
 * Bootstrapping: discount factors from the prices of bonds maturing in
 * 1, 2, 3, … periods, one for each, each bond's earlier coupons valued
 * with the factors already found. All exact.
 */
export function bootstrap(bonds, { frequency } = {}) {
  const list = bonds.map((b) => ({ price: amount(b.price), bond: bond({ frequency: frequency ?? b.frequency ?? 1, ...b }) })).sort((a, b) => a.bond.periods - b.bond.periods);
  const f = list[0]?.bond.frequency ?? refuse("bad-curve", "give at least one bond");
  const d = [];
  list.forEach(({ price, bond: b }, k) => {
    if (b.periods !== k + 1 || b.frequency !== f || !b.first.equals(ONE)) refuse("bad-curve", `bootstrapping needs one bond maturing at each of periods 1, 2, 3, … with the same coupon dates; bond ${k + 1} has ${b.periods} period(s)`);
    const known = sum(d.map((x) => x.multiply(b.couponAmount)));
    d.push(price.subtract(known).divide(b.couponAmount.add(b.redemption)));
  });
  return new YieldCurve(d, f);
}

/**
 * Immunisation: split the money for a single liability between two bonds
 * so that, at the going yield, the assets have the liability's present
 * value and its duration. { presentValue, weights, amounts, units,
 * durations, convexity, immunised, surplusAt(yield) }: surplusAt shows
 * what is left over if the yield then moves.
 */
export function immunise({ liability, yield: y, bonds } = {}) {
  if (!Array.isArray(bonds) || bonds.length !== 2) refuse("bad-problem", "immunise takes two bonds");
  const [a, b] = bonds.map(bond);
  const f = a.frequency;
  if (b.frequency !== f) refuse("bad-problem", "the two bonds pay with the same frequency");
  const L = amount(liability.amount);
  const T = amount(liability.time);
  const n = T.multiply(Q(f));
  if (n.denominator !== 1n) refuse("bad-problem", "the liability falls on a coupon date (time × frequency is whole)");
  const x = ONE.add(amount(y).divide(Q(f)));
  const pv = L.divide(x.pow(n.numerator));
  const [da, db] = [a.duration(y), b.duration(y)];
  if (da.macaulay.equals(db.macaulay)) refuse("bad-problem", "the two bonds have the same duration, so no mix can change it");
  const wa = T.subtract(db.macaulay).divide(da.macaulay.subtract(db.macaulay));
  const weights = [wa, ONE.subtract(wa)];
  const prices = [a.price(y).dirty, b.price(y).dirty];
  if (prices.some((p) => p instanceof RationalInterval)) refuse("bad-problem", "value the bonds on a coupon date (give periods, not dates)");
  const amounts = weights.map((w) => w.multiply(pv));
  const units = amounts.map((v, k) => v.divide(prices[k]));
  const assets = weights[0].multiply(da.convexity).add(weights[1].multiply(db.convexity));
  const owed = T.multiply(T.add(ONE.divide(Q(f)))).divide(x.multiply(x));
  const surplusAt = (other) => {
    const z = ONE.add(amount(other).divide(Q(f)));
    return units[0].multiply(a.price(other).dirty).add(units[1].multiply(b.price(other).dirty)).subtract(L.divide(z.pow(n.numerator)));
  };
  return { presentValue: pv, weights, amounts, units, durations: [da.macaulay, db.macaulay], convexity: { assets, liability: owed }, immunised: weights.every((w) => w.numerator >= 0n) && assets.compareTo(owed) >= 0, short: weights.some((w) => w.numerator < 0n), surplusAt };
}
export { total };
