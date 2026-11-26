import { expect, test, describe } from "bun:test";
import { Rational, RationalInterval } from "@ratmath/core";
import { amount, round, format, allocate, power, show, date, daysBetween, dayCount, simpleInterest, compound, effectiveRate, nominalRate, equivalentRate, realRate, presentValue, futureValue, annuity, perpetuity, tvm, FinanceError } from "../index.js";

const q = (s) => new Rational(s);
const has = (iv, x) => iv.low.compareTo(q(x)) <= 0 && iv.high.compareTo(q(x)) >= 0;
const code = (f) => {
  try {
    f();
  } catch (e) {
    return e instanceof FinanceError ? e.code : `other: ${e.message}`;
  }
  return "no error";
};

describe("money", () => {
  test("amounts are read exactly", () => {
    expect(amount("$1,234.56").toString()).toBe("30864/25");
    expect(amount("4.5%").toString()).toBe("9/200");
    expect(amount("-.5").toString()).toBe("-1/2");
    expect(amount("7/8").toString()).toBe("7/8");
    expect(amount(12n).toString()).toBe("12");
    expect(code(() => amount(0.1))).toBe("inexact");
    expect(code(() => amount("abc"))).toBe("bad-number");
    expect(code(() => amount(""))).toBe("bad-number");
  });
  test("rounding rules", () => {
    const r = (x, mode, places = 2) => round(x, { mode, places }).toString();
    expect(r("2.345", "half-even")).toBe("117/50");
    expect(r("2.355", "half-even")).toBe("59/25");
    expect(r("2.345", "half-up")).toBe("47/20");
    expect(r("-2.345", "half-up")).toBe("-47/20");
    expect(r("2.345", "half-down")).toBe("117/50");
    expect(r("2.341", "up")).toBe("47/20");
    expect(r("-2.341", "up")).toBe("-47/20");
    expect(r("2.349", "down")).toBe("117/50");
    expect(r("-2.341", "floor")).toBe("-47/20");
    expect(r("-2.349", "ceil")).toBe("-117/50");
    expect(r("1250", "half-even", -2)).toBe("1200");
    expect(code(() => round(1, { mode: "nearest" }))).toBe("bad-rounding");
  });
  test("formatting", () => {
    expect(format("1234567.891")).toBe("1,234,567.89");
    expect(format("-0.5", { currency: "$" })).toBe("-$0.50");
    expect(format("0.0525", { percent: true, places: 2 })).toBe("5.25%");
    expect(format(1234, { places: 0, separator: " " })).toBe("1 234");
  });
  test("allocation adds up", () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts.map(String)).toEqual(["1667/50", "3333/100", "3333/100"]);
    expect(parts.reduce((a, b) => a.add(b)).toString()).toBe("100");
    expect(allocate("0.05", [3, 7]).map(String)).toEqual(["1/50", "3/100"]);
    expect(code(() => allocate("0.001", [1, 1]))).toBe("bad-total");
  });
  test("powers are exact when they can be", () => {
    expect(power("1.05", 2).toString()).toBe("441/400");
    expect(power("1.21", "1/2").toString()).toBe("11/10");
    expect(power("8/27", "-2/3").toString()).toBe("9/4");
    const r = power(2, "1/2", 20);
    expect(r).toBeInstanceOf(RationalInterval);
    expect(has(r, "1.41421356237309504880")).toBe(false); // truncated digits lie just below
    expect(r.low.multiply(r.low).compareTo(q("2")) <= 0 && r.high.multiply(r.high).compareTo(q("2")) >= 0).toBe(true);
    expect(r.high.subtract(r.low).compareTo(q("1/100000000000000000000")) < 0).toBe(true);
  });
  test("show rounds an interval only when the rounding is certain", () => {
    expect(show(power(2, "1/2"), 6)).toBe("1.414214");
    expect(show(new RationalInterval(q("0.1249"), q("0.1251")), 2)).toBe("[0.12, 0.13]");
  });
});

describe("dates", () => {
  test("calendar", () => {
    expect(daysBetween("2000-01-01", "2027-03-15")).toBe(9935);
    expect(String(date("2027-01-31").addMonths(1))).toBe("2027-02-28");
    expect(String(date("2028-02-29").addMonths(12))).toBe("2029-02-28");
    expect(String(date("2027-02-28").addMonths(1, { endOfMonth: true }))).toBe("2027-03-31");
    expect(String(date("2027-12-31").addDays(1))).toBe("2028-01-01");
    expect(code(() => date("2027-02-30"))).toBe("bad-date");
  });
  test("day counts", () => {
    expect(dayCount("2027-01-31", "2027-03-31", "30/360").days).toBe(60);
    expect(dayCount("2027-01-30", "2027-03-31", "30E/360").days).toBe(60);
    expect(dayCount("2027-01-01", "2027-07-01", "actual/360").yearFraction.toString()).toBe("181/360");
    expect(dayCount("2027-01-01", "2027-07-01", "actual/365").yearFraction.toString()).toBe("181/365");
    // 31 days of 2027 and 60 of leap-year 2028
    expect(dayCount("2027-12-01", "2028-03-01").yearFraction.toString()).toBe(q("31/365").add(q("60/366")).toString());
    expect(dayCount("2027-01-01", "2028-01-01").yearFraction.toString()).toBe("1");
    expect(code(() => dayCount("2027-01-01", "2027-02-01", "weekly"))).toBe("bad-convention");
  });
});

describe("time value", () => {
  test("interest and rates", () => {
    expect(simpleInterest(1000, "5%", 3).total.toString()).toBe("1150");
    expect(compound(1000, "10%", 2).toString()).toBe("1210");
    expect(compound(1000, "12%", 1, { periodsPerYear: 12 }).toString()).toBe(q("1000").multiply(q("101/100").pow(12)).toString());
    expect(show(compound(1000, "5%", 10, { periodsPerYear: "continuous" }), 6)).toBe("1648.721271");
    expect(effectiveRate("12%", 12).toString()).toBe(q("101/100").pow(12).subtract(q("1")).toString());
    expect(show(effectiveRate("12%", "continuous"), 8)).toBe("0.12749685");
    expect(show(nominalRate("12.6825030131969720661201%", 12, { digits: 16 }), 10)).toBe("0.1200000000");
    expect(nominalRate("21%", 2).toString()).toBe("1/5");
    expect(show(equivalentRate("6%", 12, 2), 8)).toBe("0.06075502");
    expect(realRate("5%", "2%").toString()).toBe("1/34");
  });
  test("present and future values, annuities", () => {
    expect(futureValue(100, "10%", 3).toString()).toBe("1331/10");
    expect(presentValue("133.1", "10%", 3).toString()).toBe("100");
    const a = annuity({ payment: 100, rate: "5%", periods: 10 });
    expect(show(a.presentValue, 6)).toBe("772.173493");
    expect(show(a.futureValue, 6)).toBe("1257.789254");
    expect(a.total.toString()).toBe("1000");
    const due = annuity({ payment: 100, rate: "5%", periods: 10, due: true });
    expect(due.presentValue.equals(a.presentValue.multiply(q("21/20")))).toBe(true);
    // growing at the interest rate: n payments each worth P/(1 + i) today
    expect(annuity({ payment: 100, rate: "5%", periods: 10, growth: "5%" }).presentValue.toString()).toBe(q("1000").divide(q("21/20")).toString());
    const deferred = annuity({ payment: 100, rate: "5%", periods: 10, deferred: 3 });
    expect(deferred.presentValue.equals(a.presentValue.divide(q("21/20").pow(3)))).toBe(true);
    expect(annuity({ payment: 100, rate: 0, periods: 10 }).presentValue.toString()).toBe("1000");
    expect(perpetuity({ payment: 100, rate: "5%" }).toString()).toBe("2000");
    expect(perpetuity({ payment: 100, rate: "5%", growth: "2%" }).toString()).toBe("10000/3");
    expect(code(() => perpetuity({ payment: 1, rate: "2%", growth: "2%" }))).toBe("diverges");
  });
  test("solving for the missing quantity", () => {
    const pmt = tvm({ pv: 200000, fv: 0, rate: "0.5%", n: 360 }).pmt;
    expect(show(pmt, 6)).toBe("-1199.101050");
    expect(tvm({ pmt, fv: 0, rate: "0.5%", n: 360 }).pv.toString()).toBe("200000");
    expect(tvm({ pv: -1000, pmt: 0, rate: "10%", n: 2 }).fv.toString()).toBe("1210");
    const n = tvm({ pv: -1000, fv: 1210, pmt: 0, rate: "10%" });
    expect(n.exact && n.n.toString() === "2").toBe(true);
    const doubling = tvm({ pv: -1000, fv: 2000, pmt: 0, rate: "7%" });
    expect(doubling.exact).toBe(false);
    expect(show(doubling.n, 8)).toBe("10.24476835");
    expect(doubling.whole).toBe(11);
    const r = tvm({ pv: -1000, pmt: 0, fv: 1210, n: 2 });
    expect(r.count).toBe(1);
    expect(r.rate.toString()).toBe("1/10");
    const loanRate = tvm({ pv: 200000, fv: 0, pmt: pmt, n: 360 });
    expect(loanRate.rates[0].exact && loanRate.rate.toString() === "1/200").toBe(true);
    expect(tvm({ pv: -1000, pmt: -100, fv: 2500, n: 6, due: true }).count).toBe(1);
    expect(code(() => tvm({ pv: 1, fv: 1 }))).toBe("bad-problem");
    expect(code(() => tvm({ pv: 1000, fv: 0, pmt: -10, rate: "5%" }))).toBe("no-solution");
  });
});
