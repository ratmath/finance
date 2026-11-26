import { expect, test, describe } from "bun:test";
import { Rational } from "@ratmath/core";
import { scenario, compare, sensitivity, annuity, loan, show, FinanceError } from "../index.js";

const q = (s) => new Rational(s);
const code = (f) => {
  try {
    f();
  } catch (e) {
    return e instanceof FinanceError ? e.code : `other: ${e.message}`;
  }
  return "no error";
};

describe("scenarios", () => {
  test("a savings account matches the annuity formula exactly", () => {
    const p = scenario({ periods: 24, accounts: [{ name: "pot", balance: 1000, rate: "6%" }], flows: [{ amount: 100, to: "pot" }] }).project();
    const expected = q("1000").multiply(q("1.005").pow(24)).add(annuity({ payment: 100, rate: "0.5%", periods: 24 }).futureValue);
    expect(p.final.pot.equals(expected)).toBe(true);
    expect(p.netWorth.equals(expected)).toBe(true);
    expect(p.rows.length).toBe(24);
    expect(p.rows[0].balances.pot.toString()).toBe("1105");
    expect(p.totals.flows["flow 1"].toString()).toBe("2400");
  });
  test("a debt account matches the loan schedule", () => {
    const l = loan({ principal: 10000, rate: "6%", periods: 36 });
    const p = scenario({ periods: 36, rounding: 2, accounts: [{ name: "bank", balance: 20000 }, { name: "loan", balance: -10000, rate: "6%" }], flows: [{ name: "pay", amount: l.payment, from: "bank", to: "loan", until: "paid" }] }).project();
    expect(p.final.loan.toString()).toBe("0");
    expect(p.totals.flows.pay.equals(l.totals.payments)).toBe(true);
    expect(p.rows[17].balances.loan.negate().equals(l.schedule[17].balance)).toBe(true);
  });
  test("timing, growth, one-off flows and rate changes", () => {
    const s = scenario({
      start: "2027-01",
      periods: 36,
      accounts: [{ name: "a", balance: 0, rate: "12%", rateChanges: [{ from: "2028-01", rate: 0 }] }],
      flows: [
        { name: "pay", amount: 1000, to: "a", growth: "10%" },
        { name: "bonus", amount: 500, to: "a", every: 12, start: 12 },
        { name: "trip", amount: 2000, from: "a", at: "2028-07" },
        { name: "early", amount: 50, from: "a", end: 3 },
      ],
    });
    const p = s.project();
    expect(p.rows[0].date).toBe("2027-01");
    expect(p.rows[35].date).toBe("2029-12");
    expect(p.rows[0].flows.pay.toString()).toBe("1000");
    expect(p.rows[12].flows.pay.toString()).toBe("1100");
    expect(p.rows[24].flows.pay.toString()).toBe("1210");
    expect(Object.keys(p.rows[11].flows)).toContain("bonus");
    expect(Object.keys(p.rows[12].flows)).not.toContain("bonus");
    expect(p.rows[18].flows.trip.toString()).toBe("2000");
    expect(p.totals.flows.early.toString()).toBe("150");
    expect(p.rows[1].interest.a.toString()).toBe(q("950").multiply(q("1/100")).toString());
    expect(p.rows[12].interest.a.toString()).toBe("0");
  });
  test("running short is reported", () => {
    const p = scenario({ periods: 12, accounts: [{ name: "cash", balance: 1000 }], flows: [{ amount: 300, from: "cash" }] }).project();
    expect(p.firstNegative).toEqual({ account: "cash", period: 4, date: null });
    expect(p.minimum.cash.balance.toString()).toBe("-2600");
  });
  test("paying off a debt and then redirecting the money", () => {
    const p = scenario({ periods: 12, accounts: [{ name: "bank", balance: 5000 }, { name: "card", balance: -1000 }, { name: "savings" }], flows: [{ name: "pay", amount: 300, from: "bank", to: "card", until: "paid", then: "savings" }] }).project();
    expect(p.final.card.toString()).toBe("0");
    expect(p.rows[3].balances.card.toString()).toBe("0");
    expect(p.rows[3].balances.savings.toString()).toBe("200");
    expect(p.final.savings.toString()).toBe("2600");
    expect(p.netWorth.toString()).toBe("4000");
  });
  test("bad descriptions are refused", () => {
    expect(code(() => scenario({ periods: 12, accounts: [] }))).toBe("bad-scenario");
    expect(code(() => scenario({ periods: 12, accounts: [{ name: "a" }], flows: [{ amount: 1, to: "b" }] }))).toBe("bad-scenario");
    expect(code(() => scenario({ periods: 12, accounts: [{ name: "a" }], flows: [{ amount: 1 }] }))).toBe("bad-scenario");
    expect(code(() => scenario({ periods: 0, accounts: [{ name: "a" }] }))).toBe("bad-scenario");
  });
});

describe("comparison and sensitivity", () => {
  const make = (toLoan, toSavings) => ({
    periods: 120,
    accounts: [{ name: "bank", balance: 0 }, { name: "savings", balance: 0, rate: "4%" }, { name: "loan", balance: -20000, rate: "7%" }],
    flows: [
      { name: "income", amount: 1000, to: "bank" },
      { name: "loan", amount: toLoan, from: "bank", to: "loan", until: "paid", then: "savings" },
      { name: "save", amount: toSavings, from: "bank", to: "savings" },
    ],
  });
  test("pay off the loan or invest", () => {
    const c = compare({ "pay the loan": make(800, 200), invest: make(300, 700) });
    expect(c.best).toBe("pay the loan");
    expect(c.rows[0].difference.toString()).toBe("0");
    expect(c.rows[1].difference.numerator < 0n).toBe(true);
    expect(c.series.invest.length).toBe(121);
    expect(code(() => compare({ only: make(1, 1) }))).toBe("bad-comparison");
  });
  test("derivatives are exact", () => {
    const build = (x) => ({ periods: 2, periodsPerYear: 1, accounts: [{ name: "pot", balance: x.start, rate: x.rate }], flows: [{ amount: x.add, to: "pot" }] });
    // outcome = (start·(1 + r) + add)(1 + r) + add
    const s = sensitivity(build, { start: 1000, rate: "10%", add: 100 });
    expect(s.base.toString()).toBe("1420");
    const by = Object.fromEntries(s.rows.map((r) => [r.input, r]));
    expect(by.start.derivative.toString()).toBe("121/100");
    expect(by.add.derivative.toString()).toBe("21/10");
    expect(by.rate.derivative.toString()).toBe("2300"); // 2·1000·1.1 + 100
    expect(by.rate.perPercent.toString()).toBe("23/10");
    expect(s.most).toBe("start");
    const grow = sensitivity((x) => ({ periods: 36, accounts: [{ name: "p", rate: x.rate.divide(2) }], flows: [{ amount: x.pay.multiply(2), to: "p", growth: x.raise }] }), { rate: "6%", pay: 100, raise: "3%" });
    expect(grow.rows.length).toBe(3);
    // a difference quotient agrees with the exact derivative
    const f = (raise) => scenario({ periods: 36, accounts: [{ name: "p", rate: "3%" }], flows: [{ amount: 200, to: "p", growth: raise }] }).project().netWorth;
    const h = q("1/10000000");
    const est = f(q("3/100").add(h)).subtract(f(q("3/100").subtract(h))).divide(h.multiply(q("2")));
    const exact = grow.rows.find((r) => r.input === "raise").derivative;
    expect(Math.abs(est.toNumber() - exact.toNumber()) < 1e-6).toBe(true);
    expect(code(() => sensitivity((x) => ({ periods: 2, rounding: 2, accounts: [{ name: "p", balance: x.b, rate: "5%" }] }), { b: 100 }))).toBe("bad-scenario");
  });
});
