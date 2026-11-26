import { expect, test, describe } from "bun:test";
import { Rational } from "@ratmath/core";
import { normal } from "@ratmath/stats";
import { amount, scenario, simulate, processes, sequenceRisk, FinanceError } from "../index.js";

const q = (s) => new Rational(s);
const code = (f) => {
  try {
    f();
  } catch (e) {
    return e instanceof FinanceError ? e.code : `other: ${e.message}`;
  }
  return "no error";
};
const yearlySpec = (flows = []) => ({ periods: 3, periodsPerYear: 1, accounts: [{ name: "pot", balance: 1000 }], flows });

describe("processes", () => {
  test("a fixed rate reproduces the exact projection", () => {
    const spec = { periods: 10, periodsPerYear: 1, accounts: [{ name: "pot", balance: 1000, rate: "4%" }], flows: [{ name: "add", amount: 100, to: "pot" }] };
    const exact = scenario(spec).project().netWorth;
    const s = simulate(spec, { returns: { pot: processes.fixed("4%") }, runs: 5, rounding: false });
    for (const x of s.outcomes) expect(x.equals(exact)).toBe(true);
    expect(s.standardError.toString()).toBe("0");
  });
  test("resampling only uses the history, in blocks", () => {
    const hist = ["10%", "-5%", "3%", "7%"].map(amount);
    const p = processes.resample(["10%", "-5%", "3%", "7%"], { block: 2 }).path(3, 12, 1);
    for (const g of p) expect(hist.some((h) => h.add(q("1")).equals(g))).toBe(true);
    // consecutive pairs come from consecutive years of the history
    for (let k = 0; k < 12; k += 2) {
      const i = hist.findIndex((h) => h.add(q("1")).equals(p[k]));
      expect(p[k + 1].equals(hist[i + 1].add(q("1")))).toBe(true);
    }
  });
  test("a seed fixes every run, and a run does not depend on how many there are", () => {
    const spec = { periods: 24, accounts: [{ name: "pot", balance: 5000 }] };
    const opts = { returns: { pot: processes.gbm({ drift: "5%", volatility: "20%" }) }, seed: 11 };
    const a = simulate(spec, { ...opts, runs: 20 });
    const b = simulate(spec, { ...opts, runs: 30 });
    a.outcomes.forEach((x, i) => expect(x.equals(b.outcomes[i])).toBe(true));
    const c = simulate(spec, { ...opts, runs: 20, seed: 12 });
    expect(a.outcomes.some((x, i) => !x.equals(c.outcomes[i]))).toBe(true);
  });
  test("geometric Brownian motion has mean growth e^{μT} (within sampling error)", () => {
    const spec = { periods: 5, periodsPerYear: 1, accounts: [{ name: "pot", balance: 1 }] };
    const s = simulate(spec, { returns: { pot: processes.gbm({ drift: "6%", volatility: "20%" }) }, runs: 2000, seed: 3, rounding: false });
    const want = Math.exp(0.3);
    expect(Math.abs(s.mean.toNumber() - want)).toBeLessThan(4 * s.standardError.high.toNumber());
  });
});

describe("repeated runs against exact enumeration", () => {
  test("ruin probability for two-valued returns matches the enumeration of all eight paths", () => {
    const spec = yearlySpec([{ name: "spend", amount: 380, from: "pot" }]);
    const values = ["30%", "-20%"];
    // exact: every path of three years, each with probability 1/8
    let ruined = 0;
    let total = q("0");
    const possible = new Set();
    for (let m = 0; m < 8; m++) {
      const rates = [0, 1, 2].map((k) => values[(m >> k) & 1]);
      const p = scenario({ ...spec, accounts: [{ name: "pot", balance: 1000, rates }] }).project();
      if (p.firstNegative) ruined++;
      total = total.add(p.netWorth);
      possible.add(p.netWorth.toString());
    }
    const exactRuin = new Rational(BigInt(ruined), 8n);
    expect(ruined).toBeGreaterThan(0);
    expect(ruined).toBeLessThan(8);
    const s = simulate(spec, { returns: { pot: processes.choice(values) }, runs: 600, seed: 5, rounding: false });
    expect(s.ruin.compare(exactRuin)).toBe("inside");
    expect(Math.abs(s.mean.subtract(total.divide(q("8"))).toNumber())).toBeLessThan(4 * s.standardError.high.toNumber());
    // every outcome is one of the eight exact outcomes
    expect(s.outcomes.every((x) => possible.has(x.toString()))).toBe(true);
  });
  test("a certain event happens once and costs exactly its amount", () => {
    const spec = { periods: 12, accounts: [{ name: "cash", balance: 10000 }] };
    const s = simulate(spec, { events: [{ name: "repair", probability: 1, amount: 2500, from: "cash", once: true }], runs: 10 });
    for (const x of s.outcomes) expect(x.toString()).toBe("7500");
  });
  test("indexing to a fixed inflation is the same as a growing flow", () => {
    const spec = { periods: 6, periodsPerYear: 1, accounts: [{ name: "pot", balance: 10000, rate: "5%" }], flows: [{ name: "spend", amount: 1000, from: "pot" }] };
    const s = simulate(spec, { inflation: processes.fixed("3%"), indexed: ["spend"], runs: 2, rounding: false });
    const grown = scenario({ ...spec, flows: [{ name: "spend", amount: 1000, from: "pot", growth: "3%" }] }).project().netWorth;
    expect(s.outcomes[0].equals(grown)).toBe(true);
    expect(s.real.outcomes[0].equals(grown.divide(q("1.03").pow(6)))).toBe(true);
  });
  test("bands and percentiles are taken from the runs", () => {
    const spec = { periods: 12, accounts: [{ name: "pot", balance: 1000 }] };
    const s = simulate(spec, { returns: { pot: processes.independent(normal("5/100", "1/10")) }, runs: 101, seed: 2 });
    expect(s.bands.length).toBe(13);
    expect(s.bands[0]["50"].toString()).toBe("1000");
    expect(s.percentiles["50"].equals(s.sorted[50])).toBe(true);
    expect(s.quantile("1/2").equals(s.sorted[50])).toBe(true);
    expect(String(s)).toContain("101 runs, seed 2");
  });
  test("refusals", () => {
    const spec = { periods: 12, accounts: [{ name: "pot", balance: 1000 }] };
    expect(code(() => simulate(scenario(spec), {}))).toBe("bad-argument");
    expect(code(() => simulate(spec, { returns: { nope: processes.fixed("1%") } }))).toBe("bad-process");
    expect(code(() => simulate(spec, { returns: { pot: "5%" } }))).toBe("bad-process");
    expect(code(() => processes.choice(["1%"], [1, 2]))).toBe("bad-process");
  });
});

describe("sequence of returns", () => {
  test("with no money in or out the order cannot matter", () => {
    const r = sequenceRisk(yearlySpec(), { account: "pot", returns: ["20%", "-30%", "10%"], shuffles: 4 });
    expect(r.orderMatters).toBe(false);
    expect(r.rows[0].outcome.toString()).toBe("924");
  });
  test("withdrawals make bad years early the worst", () => {
    const r = sequenceRisk(yearlySpec([{ name: "w", amount: 300, from: "pot" }]), { account: "pot", returns: ["20%", "-30%", "10%"] });
    expect(r.orderMatters).toBe(true);
    expect(r.worst).toBe("worst first");
    expect(r.best).toBe("best first");
    expect(r.spread.toString()).toBe("315");
  });
});
