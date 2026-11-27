import { expect, test, describe } from "bun:test";
import { Rational, RationalInterval } from "@ratmath/core";
import {
  amount, show, portfolio, capm, returnsFrom, strategy, parity, binomialTree, blackScholes, impliedVolatility,
  lifeTable, deMoivre, lifeAnnuity, lifeInsurance, pureEndowment, endowment, netPremium, reserve, FinanceError,
} from "../index.js";

const q = (s) => amount(s);
const inside = (iv, x, slack = 0) => iv.low.toNumber() - slack <= x && x <= iv.high.toNumber() + slack;
const code = (f) => {
  try {
    f();
  } catch (e) {
    return e instanceof FinanceError ? e.code : `other: ${e.message}`;
  }
  return "no error";
};
const sum = (xs) => xs.reduce((a, b) => a.add(b), q(0));

const pf = portfolio({
  names: ["A", "B", "C"],
  means: ["8%", "12%", "15%"],
  covariance: [["4/100", "6/1000", "0"], ["6/1000", "9/100", "1/100"], ["0", "1/100", "16/100"]],
});

describe("portfolios", () => {
  test("the frontier meets its constraints and the closed-form variance", () => {
    const f = pf.frontier("12%");
    expect(sum(f.w).toString()).toBe("1");
    expect(f.expectedReturn.equals(q("12%"))).toBe(true);
    expect(f.variance.equals(pf.variance(f.w))).toBe(true);
    // moving along the constraint line (a direction orthogonal to 1 and μ) only adds variance
    const n = [q("3/100").subtract(q("1/25")), q("8/100").subtract(q("15/100")), q("4/100").subtract(q("1/100"))];
    // cross product of (1,1,1) and μ gives the direction that keeps both sums
    const mu = pf.means;
    const dir = [mu[2].subtract(mu[1]), mu[0].subtract(mu[2]), mu[1].subtract(mu[0])];
    expect(sum(dir).toString()).toBe("0");
    for (const t of ["1/10", "-1/10", "1/1000"]) {
      const w = f.w.map((x, i) => x.add(q(t).multiply(dir[i])));
      expect(pf.variance(w).compareTo(f.variance)).toBeGreaterThan(0);
    }
    expect(n.length).toBe(3);
  });
  test("the minimum-variance portfolio is the bottom of the frontier", () => {
    const m = pf.minimumVariance();
    expect(pf.frontier(m.expectedReturn).variance.equals(m.variance)).toBe(true);
    expect(pf.frontier("10%").variance.compareTo(m.variance)).toBeGreaterThan(0);
  });
  test("long only: KKT certificate, and no feasible mix on a fine grid does better", () => {
    for (const target of ["9%", "11%", "14%"]) {
      const r = pf.frontierLongOnly(target);
      expect(r.certificate).not.toBe(null);
      expect(r.w.every((x) => x.numerator >= 0n)).toBe(true);
      expect(sum(r.w).toString()).toBe("1");
      expect(r.expectedReturn.equals(q(target))).toBe(true);
      // brute force: the feasible set is a segment; walk along it
      const mu = pf.means;
      const dir = [mu[2].subtract(mu[1]), mu[0].subtract(mu[2]), mu[1].subtract(mu[0])];
      for (let k = -400; k <= 400; k++) {
        const w = r.w.map((x, i) => x.add(new Rational(BigInt(k), 1000n).multiply(dir[i])));
        if (w.some((x) => x.numerator < 0n)) continue;
        expect(pf.variance(w).compareTo(r.variance)).toBeGreaterThanOrEqual(0);
      }
    }
    expect(pf.frontierLongOnly("15%").support).toEqual(["C"]);
    expect(code(() => pf.frontierLongOnly("20%"))).toBe("infeasible");
  });
  test("the tangency portfolio has the best Sharpe ratio", () => {
    const t = pf.tangency("3%");
    const rf = q("3%");
    const s2 = (w) => {
      const e = pf.expectedReturn(w).subtract(rf);
      return e.multiply(e).divide(pf.variance(w));
    };
    expect(s2(t.w).equals(t.sharpeSquared)).toBe(true);
    for (const w of [["1/3", "1/3", "1/3"], ["1/2", "1/2", "0"], ["0", "0", "1"], ["2/5", "1/5", "2/5"]]) expect(s2(w.map(q)).compareTo(t.sharpeSquared)).toBeLessThanOrEqual(0);
  });
  test("from returns: sample means and covariances", () => {
    const p = portfolio({ returns: [returnsFrom([100, 110, 99, 120]), returnsFrom([50, 52, 51, 55])] });
    expect(p.means[0].equals(sum(returnsFrom([100, 110, 99, 120])).divide(q(3)))).toBe(true);
    expect(p.covariance[0][1].equals(p.covariance[1][0])).toBe(true);
  });
  test("CAPM beta by the textbook formula", () => {
    const a = ["1/10", "-1/20", "3/20", "1/50"].map(q);
    const m = ["1/20", "-1/50", "1/10", "1/100"].map(q);
    const r = capm({ asset: a, market: m, riskFree: "1%" });
    const ma = sum(a).divide(q(4));
    const mm = sum(m).divide(q(4));
    const cov = sum(a.map((x, i) => x.subtract(ma).multiply(m[i].subtract(mm))));
    const v = sum(m.map((x) => x.subtract(mm).multiply(x.subtract(mm))));
    expect(r.beta.equals(cov.divide(v))).toBe(true);
    expect(r.required.equals(q("1%").add(r.beta.multiply(mm.subtract(q("1%")))))).toBe(true);
  });
});

describe("options", () => {
  test("strategies: break-even prices make the profit exactly zero", () => {
    const straddle = strategy([{ type: "call", strike: 100, premium: 5 }, { type: "put", strike: 100, premium: 4 }]);
    expect(straddle.breakEvens.map(String)).toEqual(["91", "109"]);
    expect(straddle.maxProfit).toBe(null);
    expect(straddle.maxLoss.toString()).toBe("9");
    const spread = strategy([{ type: "call", strike: 90, premium: 12 }, { type: "call", strike: 110, premium: 3, quantity: -1 }]);
    for (const b of spread.breakEvens) expect(spread.profit(b).toString()).toBe("0");
    expect([spread.maxProfit, spread.maxLoss].map(String)).toEqual(["11", "9"]);
    const covered = strategy([{ type: "stock", premium: 100 }, { type: "call", strike: 110, premium: 4, quantity: -1 }]);
    expect(covered.breakEvens.map(String)).toEqual(["96"]);
    expect(covered.maxProfit.toString()).toBe("14");
  });
  test("Black–Scholes: the textbook values, and put–call parity inside the enclosures", () => {
    // Hull's example: S = 42, K = 40, r = 10%, σ = 20%, T = 1/2 → c ≈ 4.76, p ≈ 0.81
    const v = blackScholes({ spot: 42, strike: 40, rate: "10%", volatility: "20%", time: "1/2" });
    expect(show(v.call, 2)).toBe("4.76");
    expect(show(v.put, 2)).toBe("0.81");
    const atm = blackScholes({ spot: 100, strike: 100, rate: "5%", volatility: "20%", time: 1 });
    expect(show(atm.call, 4)).toBe("10.4506");
    expect(atm.call.high.subtract(atm.call.low).toNumber()).toBeLessThan(1e-15);
    const gap = parity({ call: atm.call.low, put: atm.put.high, spot: 100, strike: 100, rate: "5%", time: 1 }).gap;
    expect(Math.abs(gap.low.toNumber())).toBeLessThan(1e-12);
    expect(parity({ put: atm.put.low, spot: 100, strike: 100, rate: "5%", time: 1 }).call.low.toNumber()).toBeCloseTo(10.4506, 4);
    // the enclosures blackScholes returns go straight in
    const put = parity({ call: atm.call, spot: 100, strike: 100, rate: "5%", time: 1 }).put;
    expect(put.low.compareTo(atm.put.high) <= 0 && atm.put.low.compareTo(put.high) <= 0).toBe(true);
    expect(put.high.subtract(put.low).toNumber()).toBeLessThan(1e-12);
    const both = parity({ call: atm.call, put: atm.put, spot: 100, strike: 100, rate: "5%", time: 1 });
    expect(both.gap.containsZero()).toBe(true);
    expect(both.holds).toBe(null);
    expect(parity({ call: 10, put: 5, spot: 100, strike: 100, rate: "5%", time: 1, compounding: "annual" }).gap.toString()).toBe(q(10).subtract(q(5)).subtract(q(100).subtract(q(100).divide(q("1.05")))).toString());
  });
  test("sensitivities agree with difference quotients of the price", () => {
    const base = { strike: 100, rate: "5%", volatility: "20%", time: 1 };
    const at = (spot) => blackScholes({ ...base, spot }).call.low.toNumber();
    const v = blackScholes({ ...base, spot: 100 });
    expect(inside(v.delta.call, (at("100.001") - at("99.999")) / 0.002, 1e-6)).toBe(true);
    expect(inside(v.gamma, (at("100.01") - 2 * at(100) + at("99.99")) / 1e-4, 1e-5)).toBe(true);
    expect(v.delta.call.subtract(v.delta.put).low.toNumber()).toBeCloseTo(1, 12);
    const vol = (s) => blackScholes({ ...base, spot: 100, volatility: s }).call.low.toNumber();
    expect(inside(v.vega, (vol("0.20001") - vol("0.19999")) / 0.00002, 1e-4)).toBe(true);
  });
  test("the binomial tree: one step by hand, convergence to Black–Scholes, American at least European", () => {
    const one = binomialTree({ spot: 100, strike: 100, steps: 1, up: "6/5", down: "4/5", growth: "21/20" });
    // p = (1.05 − 0.8)/0.4 = 5/8; value = 5/8 · 20 / 1.05
    expect(one.price.toString()).toBe(q("5/8").multiply(q(20)).divide(q("21/20")).toString());
    expect(one.delta.toString()).toBe("1/2");
    const tree = binomialTree({ spot: 100, strike: 100, steps: 100, volatility: "20%", time: 1, rate: "5%" });
    expect(Math.abs(tree.price.toNumber() - 10.4506)).toBeLessThan(0.03);
    const eu = binomialTree({ spot: 50, strike: 52, steps: 3, up: "6/5", down: "4/5", growth: "21/20", type: "put" });
    const am = binomialTree({ spot: 50, strike: 52, steps: 3, up: "6/5", down: "4/5", growth: "21/20", type: "put", style: "american" });
    expect(am.price.compareTo(eu.price)).toBeGreaterThan(0);
    expect(am.earlyExercise.length).toBeGreaterThan(0);
    const amCall = binomialTree({ spot: 50, strike: 52, steps: 3, up: "6/5", down: "4/5", growth: "21/20", style: "american" });
    const euCall = binomialTree({ spot: 50, strike: 52, steps: 3, up: "6/5", down: "4/5", growth: "21/20" });
    expect(amCall.price.equals(euCall.price)).toBe(true);
    expect(code(() => binomialTree({ spot: 1, strike: 1, steps: 1, up: "11/10", down: "9/10", growth: "6/5" }))).toBe("arbitrage");
    const quick = binomialTree({ spot: 100, strike: 100, steps: 100, volatility: "20%", time: 1, rate: "5%", float: true });
    expect(quick.approximate).toBe(true);
    expect(Math.abs(quick.price - tree.price.toNumber())).toBeLessThan(1e-9);
  });
  test("implied volatility recovers the volatility that made the price", () => {
    const price = blackScholes({ spot: 100, strike: 110, rate: "3%", volatility: "27%", time: "3/4" }).call.low;
    const iv = impliedVolatility({ price, spot: 100, strike: 110, rate: "3%", time: "3/4", digits: 7 });
    expect(inside(iv, 0.27, 1e-12)).toBe(true);
    expect(iv.high.subtract(iv.low).toNumber()).toBeLessThan(1e-7);
    expect(code(() => impliedVolatility({ price: 200, spot: 100, strike: 110, rate: "3%", time: 1 }))).toBe("out-of-range");
  });
});

describe("life contingencies", () => {
  const L = deMoivre(100);
  const i = "5%";
  const d = q("5%").divide(q("105%"));
  test("de Moivre: survival and expectation by formula", () => {
    expect(L.p(40, 10).toString()).toBe("5/6");
    expect(L.curtateExpectation(40).toString()).toBe("59/2");
    expect(L.completeExpectation(40).toString()).toBe("30");
  });
  test("a table from q agrees with the same table from l", () => {
    const fromL = lifeTable({ l: [1000, 900, 700, 400, 0], startAge: 60 });
    const fromQ = lifeTable({ q: ["1/10", "2/9", "3/7", "1"], radix: 1000, startAge: 60 });
    for (let x = 60; x <= 63; x++) expect(fromL.q(x).equals(fromQ.q(x))).toBe(true);
    expect(lifeAnnuity(fromL, { age: 60, rate: i }).equals(lifeAnnuity(fromQ, { age: 60, rate: i }))).toBe(true);
  });
  test("exact identities: A = 1 − d·ä, for whole life and for endowments", () => {
    for (const age of [20, 40, 65, 90]) {
      expect(lifeInsurance(L, { age, rate: i }).equals(q(1).subtract(d.multiply(lifeAnnuity(L, { age, rate: i }))))).toBe(true);
      const n = Math.min(10, 100 - age);
      expect(endowment(L, { age, rate: i, term: n }).equals(q(1).subtract(d.multiply(lifeAnnuity(L, { age, rate: i, term: n }))))).toBe(true);
    }
    // annuity-immediate is the annuity-due less the first payment
    expect(lifeAnnuity(L, { age: 40, rate: i, due: false }).equals(lifeAnnuity(L, { age: 40, rate: i }).subtract(q(1)))).toBe(true);
    // term plus deferred makes whole life
    expect(lifeInsurance(L, { age: 40, rate: i, term: 15 }).add(lifeInsurance(L, { age: 40, rate: i, deferred: 15 })).equals(lifeInsurance(L, { age: 40, rate: i }))).toBe(true);
    expect(pureEndowment(L, { age: 40, rate: i, term: 10 }).equals(q("5/6").divide(q("1.05").pow(10)))).toBe(true);
  });
  test("net premiums and reserves", () => {
    for (const kind of ["whole life", "term", "endowment"]) {
      const spec = { kind, benefit: 100000, age: 40, rate: i, term: kind === "whole life" ? null : 20 };
      expect(reserve(L, { ...spec, time: 0 }).toString()).toBe("0");
    }
    expect(reserve(L, { kind: "endowment", benefit: 1000, age: 40, rate: i, term: 20, time: 20 }).toString()).toBe("1000");
    expect(reserve(L, { kind: "term", benefit: 1000, age: 40, rate: i, term: 20, time: 20 }).toString()).toBe("0");
    // whole life: reserve = 1 − ä_{x+t}/ä_x
    const r10 = reserve(L, { age: 40, rate: i, time: 10 });
    expect(r10.equals(q(1).subtract(lifeAnnuity(L, { age: 50, rate: i }).divide(lifeAnnuity(L, { age: 40, rate: i }))))).toBe(true);
    expect(code(() => netPremium(L, { kind: "term", age: 40, rate: i }))).toBe("bad-argument");
  });
});
