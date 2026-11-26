// Options: payoffs and strategies (exact, with their break-even prices),
// put–call parity, the binomial tree (exact for rational up, down and rate
// factors, European or American), and Black–Scholes values and
// sensitivities as certified enclosures, with the implied volatility found
// by certified bisection (the price increases with volatility).
import { Rational, RationalInterval } from "@ratmath/core";
import { enclose } from "@ratmath/analytic";
import { refuse, amount, ZERO, ONE, Q, round } from "./money.js";

const isIv = (x) => x instanceof RationalInterval;
const I = (x) => (isIv(x) ? x : new RationalInterval(amount(x), amount(x)));
const add = (a, b) => I(a).add(I(b));
const sub = (a, b) => I(a).subtract(I(b));
const mul = (a, b) => I(a).multiply(I(b));
const div = (a, b) => I(a).divide(I(b));
const tight = (iv) => (iv.low.equals(iv.high) ? iv.low : iv);
const max0 = (x) => (x.numerator < 0n ? ZERO : x);

// ---- payoffs ------------------------------------------------------------------

const LEG_TYPES = new Set(["call", "put", "stock", "bond"]);
/**
 * A strategy: legs { type: "call" | "put" | "stock" | "bond", strike (for an
 * option; the face for a bond), premium (what one unit cost; default 0),
 * quantity (negative for a short position; default 1) }. Returns
 * { payoff(S), profit(S), kinks, breakEvens, maxProfit, maxLoss } with every
 * value exact; max values are null when unbounded.
 */
export function strategy(legs) {
  const L = legs.map((l) => {
    if (!LEG_TYPES.has(l.type)) refuse("bad-leg", `a leg is a call, put, stock or bond, not ${l.type}`);
    return { type: l.type, strike: l.strike === undefined ? null : amount(l.strike), premium: amount(l.premium ?? 0), quantity: amount(l.quantity ?? 1) };
  });
  for (const l of L) if ((l.type === "call" || l.type === "put" || l.type === "bond") && l.strike === null) refuse("bad-leg", `a ${l.type} needs a strike`);
  const one = (l, S) => (l.type === "call" ? max0(S.subtract(l.strike)) : l.type === "put" ? max0(l.strike.subtract(S)) : l.type === "stock" ? S : l.strike);
  const payoff = (s) => {
    const S = amount(s);
    return L.reduce((acc, l) => acc.add(l.quantity.multiply(one(l, S))), ZERO);
  };
  const cost = L.reduce((acc, l) => acc.add(l.quantity.multiply(l.premium)), ZERO);
  const profit = (s) => payoff(s).subtract(cost);
  const kinks = [...new Set(L.filter((l) => l.type === "call" || l.type === "put").map((l) => l.strike.toString()))].map(amount).sort((a, b) => a.compareTo(b));
  // profit is linear between kinks: find each zero exactly
  const pts = [ZERO, ...kinks.filter((k) => k.numerator > 0n)];
  const breakEvens = [];
  const slopeAfter = (x) => profit(x.add(ONE)).subtract(profit(x));
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const pa = profit(a);
    if (pa.numerator === 0n && !breakEvens.some((z) => z.equals(a))) breakEvens.push(a);
    const b = pts[i + 1] ?? null;
    const slope = b ? profit(b).subtract(pa).divide(b.subtract(a)) : slopeAfter(a);
    if (slope.numerator === 0n) continue;
    const z = a.subtract(pa.divide(slope));
    if (z.compareTo(a) > 0 && (b === null || z.compareTo(b) < 0)) breakEvens.push(z);
  }
  const values = pts.map(profit);
  const lastSlope = slopeAfter(pts[pts.length - 1]);
  const maxProfit = lastSlope.numerator > 0n ? null : values.reduce((m, v) => (v.compareTo(m) > 0 ? v : m));
  const minV = values.reduce((m, v) => (v.compareTo(m) < 0 ? v : m));
  const maxLoss = lastSlope.numerator < 0n ? null : minV.numerator < 0n ? minV.negate() : ZERO;
  return { legs: L, cost, payoff, profit, kinks, breakEvens: breakEvens.sort((a, b) => a.compareTo(b)), maxProfit, maxLoss };
}

// ---- discounting ----------------------------------------------------------------

/** the discount factor over `time` years: (1 + r)^−t for whole t (exact), e^{−rt} for continuous (certified) */
function discount(rate, time, compounding, bits) {
  const r = amount(rate);
  const t = amount(time);
  if (compounding === "continuous") return tight(enclose.exp(I(r.multiply(t).negate()), bits));
  if (compounding !== "annual") refuse("bad-argument", 'compounding is "continuous" or "annual"');
  if (t.denominator !== 1n) refuse("bad-argument", "annual compounding here takes a whole number of years");
  return ONE.divide(ONE.add(r).pow(t.numerator));
}

/**
 * Put–call parity C − P = S − K·DF for European options on a stock without
 * dividends. Give all but one of call, put, spot and strike to get the
 * missing one; give all four to get the `gap` (zero when parity holds, so a
 * nonzero gap is an arbitrage).
 */
export function parity({ call, put, spot, strike, rate, time, compounding = "continuous", bits = 80 }) {
  const df = discount(rate, time, compounding, bits);
  const pv = mul(amount(strike ?? 0), df);
  const missing = ["call", "put", "spot", "strike"].filter((k) => ({ call, put, spot, strike })[k] === undefined);
  if (missing.length > 1) refuse("bad-argument", "give at least three of call, put, spot and strike");
  const [C, P, S] = [call, put, spot].map((x) => (x === undefined ? null : amount(x)));
  if (missing[0] === "call") return { call: tight(add(P, sub(S, pv))) };
  if (missing[0] === "put") return { put: tight(sub(C, sub(S, pv))) };
  if (missing[0] === "spot") return { spot: tight(add(sub(C, P), pv)) };
  if (missing[0] === "strike") return { strike: tight(div(sub(S, sub(C, P)), df)) };
  const gap = tight(sub(sub(C, P), sub(S, pv)));
  const holds = isIv(gap) ? gap.containsZero() ? null : false : gap.numerator === 0n;
  return { gap, holds };
}

// ---- binomial tree ----------------------------------------------------------------

/**
 * Price an option on a recombining binomial tree, exactly.
 * { spot, strike, steps, type: "call" | "put", style: "european" | "american",
 *   up, down, growth }: each step the price is multiplied by `up` or `down`
 * and money grows by `growth` (1 + the rate per step). The risk-neutral
 * probability is p = (growth − down)/(up − down), which needs
 * down < growth < up (otherwise the tree has an arbitrage).
 * Or give { volatility, time, rate } for the Cox–Ross–Rubinstein tree:
 * up = e^{σ√Δt}, down = 1/up, growth = e^{rΔt}, rounded to `places` decimal
 * places (default 8) and then used exactly; `rounded: true` says so.
 * The exact tree's fractions grow with each step (100 steps take about a
 * second, 200 about twenty); `float: true` runs the same induction in
 * floating point for a quick preview, marked `approximate`.
 */
export function binomialTree({ spot, strike, steps, type = "call", style = "european", up, down, growth, volatility, time, rate, places = 8, keepTree = false, float = false }) {
  const S = amount(spot);
  const K = amount(strike);
  if (!Number.isInteger(steps) || steps < 1 || steps > 100000) refuse("bad-argument", "steps is a whole number from 1 to 100000");
  if (!float && steps > 2000) refuse("too-large", "an exact tree is limited to 2000 steps (its fractions grow with every step); use float: true for a quick preview");
  if (type !== "call" && type !== "put") refuse("bad-argument", 'type is "call" or "put"');
  if (style !== "european" && style !== "american") refuse("bad-argument", 'style is "european" or "american"');
  let rounded = false;
  if (up === undefined) {
    if (volatility === undefined || time === undefined || rate === undefined) refuse("bad-argument", "give up, down and growth, or volatility, time and rate");
    const dt = amount(time).divide(Q(steps));
    const sig = amount(volatility);
    const u = enclose.exp(enclose.sqrt(I(sig.multiply(sig).multiply(dt)), 96), 96);
    up = round(u.low, { places });
    down = ONE.divide(up);
    growth = round(enclose.exp(I(amount(rate).multiply(dt)), 96).low, { places });
    rounded = true;
  }
  const [u, d, g] = [amount(up), amount(down ?? ONE.divide(amount(up))), amount(growth)];
  if (!(d.compareTo(g) < 0 && g.compareTo(u) < 0)) refuse("arbitrage", `the tree needs down < growth < up; here ${d}, ${g}, ${u}`);
  const p = g.subtract(d).divide(u.subtract(d));
  if (float) return floatTree({ S: S.toNumber(), K: K.toNumber(), u: u.toNumber(), d: d.toNumber(), g: g.toNumber(), p: p.toNumber(), steps, type, style, rounded });
  const q = ONE.subtract(p);
  const pay = (s) => (type === "call" ? max0(s.subtract(K)) : max0(K.subtract(s)));
  // price after j ups and i − j downs; powers are computed once
  const upPow = [ONE];
  const downPow = [ONE];
  for (let k = 1; k <= steps; k++) {
    upPow.push(upPow[k - 1].multiply(u));
    downPow.push(downPow[k - 1].multiply(d));
  }
  const priceAt = (i, j) => S.multiply(upPow[j]).multiply(downPow[i - j]);
  let V = Array.from({ length: steps + 1 }, (_, j) => pay(priceAt(steps, j)));
  const tree = keepTree ? [V] : null;
  const exercise = [];
  let delta = null;
  for (let i = steps - 1; i >= 0; i--) {
    const next = new Array(i + 1);
    for (let j = 0; j <= i; j++) {
      let v = p.multiply(V[j + 1]).add(q.multiply(V[j])).divide(g);
      if (style === "american") {
        const now = pay(priceAt(i, j));
        if (now.compareTo(v) > 0) {
          v = now;
          exercise.push({ step: i, ups: j, price: priceAt(i, j) });
        }
      }
      next[j] = v;
    }
    if (i === 0) delta = V[1].subtract(V[0]).divide(priceAt(1, 1).subtract(priceAt(1, 0)));
    V = next;
    if (keepTree) tree.unshift(V);
  }
  return { price: V[0], probability: p, up: u, down: d, growth: g, delta, rounded, earlyExercise: style === "american" ? exercise : null, tree };
}

/** the same backward induction in floating point: fast, and labelled approximate */
function floatTree({ S, K, u, d, g, p, steps, type, style, rounded }) {
  const pay = (x) => Math.max(0, type === "call" ? x - K : K - x);
  let V = Float64Array.from({ length: steps + 1 }, (_, j) => pay(S * u ** j * d ** (steps - j)));
  let delta = null;
  for (let i = steps - 1; i >= 0; i--) {
    if (i === 0) delta = (V[1] - V[0]) / (S * u - S * d);
    for (let j = 0; j <= i; j++) {
      let v = (p * V[j + 1] + (1 - p) * V[j]) / g;
      if (style === "american") v = Math.max(v, pay(S * u ** j * d ** (i - j)));
      V[j] = v;
    }
  }
  return { price: V[0], probability: p, up: u, down: d, growth: g, delta, rounded, approximate: true, earlyExercise: null, tree: null };
}

// ---- Black–Scholes ----------------------------------------------------------------

const KEPT = new Map();
const constant = (name, bits, make) => {
  const k = `${name}|${bits}`;
  if (!KEPT.has(k)) KEPT.set(k, make());
  return KEPT.get(k);
};
const sqrt2 = (bits) => constant("sqrt2", bits, () => enclose.sqrt(I(Q(2)), bits));
const sqrt2pi = (bits) => constant("sqrt2pi", bits, () => enclose.sqrt(mul(Q(8), enclose.atan(I(ONE), bits)), bits));
/** the standard normal distribution function, enclosed: (1 + erf(x/√2))/2 */
export const normalCdf = (x, bits = 80) => div(add(ONE, enclose.erf(div(I(x), sqrt2(bits)), bits)), Q(2));
/** the standard normal density, enclosed */
export const normalPdf = (x, bits = 80) => {
  const v = I(x);
  // x² over an interval that may contain zero
  const hi = v.low.abs().compareTo(v.high.abs()) > 0 ? v.low.abs() : v.high.abs();
  const lo = v.containsZero() ? ZERO : v.low.abs().compareTo(v.high.abs()) < 0 ? v.low.abs() : v.high.abs();
  const sq = new RationalInterval(lo.multiply(lo), hi.multiply(hi));
  return div(enclose.exp(div(sq, Q(-2)), bits), sqrt2pi(bits));
};

/**
 * European option values under Black–Scholes with continuous compounding:
 * { spot, strike, rate, volatility, time, dividendYield = 0 }. Every output
 * is an enclosure proven to contain the true value (or an exact rational
 * when it happens to be one): call, put, d1, d2 and the sensitivities
 * delta, gamma, vega, theta (per year) and rho for each.
 */
export function blackScholes({ spot, strike, rate, volatility, time, dividendYield = 0, bits = 80 }) {
  const [S, K, r, sig, T, y] = [spot, strike, rate, volatility, time, dividendYield].map(amount);
  if (S.numerator <= 0n || K.numerator <= 0n) refuse("domain", "spot and strike are positive");
  if (sig.numerator <= 0n || T.numerator <= 0n) refuse("domain", "volatility and time are positive");
  const b = bits + 16;
  const sqT = enclose.sqrt(I(T), b);
  const sd = mul(sig, sqT);
  const lnSK = enclose.log(I(S.divide(K)), b);
  const d1 = div(add(lnSK, r.subtract(y).add(sig.multiply(sig).divide(Q(2))).multiply(T)), sd);
  const d2 = sub(d1, sd);
  const Nd1 = normalCdf(d1, b);
  const Nd2 = normalCdf(d2, b);
  const Nm1 = sub(ONE, Nd1);
  const Nm2 = sub(ONE, Nd2);
  const dfr = enclose.exp(I(r.multiply(T).negate()), b);
  const dfy = y.numerator === 0n ? I(ONE) : enclose.exp(I(y.multiply(T).negate()), b);
  const SY = mul(S, dfy);
  const KR = mul(K, dfr);
  const pdf = normalPdf(d1, b);
  const gamma = div(mul(dfy, pdf), mul(S, sd));
  const vega = mul(mul(SY, pdf), sqT);
  const common = div(mul(mul(SY, pdf), sig), mul(Q(2), sqT)).negate();
  const out = {
    call: sub(mul(SY, Nd1), mul(KR, Nd2)),
    put: sub(mul(KR, Nm2), mul(SY, Nm1)),
    d1,
    d2,
    delta: { call: mul(dfy, Nd1), put: mul(dfy, Nd1).subtract(dfy) },
    gamma,
    vega,
    theta: {
      call: add(sub(common, mul(mul(r, KR), Nd2)), mul(mul(y, SY), Nd1)),
      put: sub(add(common, mul(mul(r, KR), Nm2)), mul(mul(y, SY), Nm1)),
    },
    rho: { call: mul(mul(K, T), mul(dfr, Nd2)), put: mul(mul(K, T), mul(dfr, Nm2)).negate() },
  };
  return out;
}

/**
 * The volatility at which Black–Scholes gives a stated price, enclosed to
 * `digits` digits. The price rises with volatility, so certified bisection
 * keeps an interval [lo, hi] with BS(lo) < price < BS(hi), proven at each
 * step. Refused when the price lies outside what any volatility can give.
 */
export function impliedVolatility({ price, type = "call", spot, strike, rate, time, dividendYield = 0, digits = 8, bits = 64 }) {
  const P = amount(price);
  const at = (s) => blackScholes({ spot, strike, rate, time, dividendYield, volatility: s, bits })[type];
  let lo = Q(1, 10000);
  let hi = Q(5);
  if (at(lo).high.compareTo(P) >= 0) refuse("out-of-range", `the price ${P} is at or below what a volatility of 0.01% gives`);
  for (let k = 0; at(hi).low.compareTo(P) <= 0; k++) {
    if (k > 4) refuse("out-of-range", `the price ${P} is above what any volatility gives`);
    hi = hi.multiply(Q(2));
  }
  const tol = new Rational(1n, 10n ** BigInt(digits));
  while (hi.subtract(lo).compareTo(tol) > 0) {
    const mid = lo.add(hi).divide(Q(2));
    const v = at(mid);
    if (v.high.compareTo(P) < 0) lo = mid;
    else if (v.low.compareTo(P) > 0) hi = mid;
    else return refuse("precision", `the value at ${mid} could not be separated from the price at ${bits} bits; raise bits`);
  }
  return new RationalInterval(lo, hi);
}
