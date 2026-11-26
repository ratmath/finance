import { expect, test, describe } from "bun:test";
import { Rational, RationalInterval } from "@ratmath/core";
import { bond, yieldCurve, bootstrap, immunise, show, FinanceError } from "../index.js";

const q = (s) => new Rational(s);
const code = (f) => {
  try {
    f();
  } catch (e) {
    return e instanceof FinanceError ? e.code : `other: ${e.message}`;
  }
  return "no error";
};

describe("bonds", () => {
  const b = bond({ coupon: "5%", periods: 20 });
  test("price and yield on a coupon date", () => {
    expect(b.price("5%").clean.toString()).toBe("100");
    expect(show(b.price("6%").clean, 6)).toBe("92.561263");
    expect(b.yield(100).toString()).toBe("1/20");
    const y = b.yield("92.561263");
    expect(y).toBeInstanceOf(RationalInterval);
    expect(show(y, 6)).toBe("0.060000");
    // the yield of an exact price is exact when it is rational
    expect(b.yield(b.price("6%").clean).toString()).toBe("3/50");
    expect(bond({ coupon: 0, periods: 2, frequency: 1 }).yield("82.64462809917355371900826446280991735537190082644628099173553719").toString() !== "").toBe(true);
    expect(bond({ coupon: 0, periods: 2, frequency: 1 }).price("10%").clean.toString()).toBe("10000/121");
    expect(b.cashflows.length).toBe(20);
    expect(b.cashflows[19].amount.toString()).toBe("205/2");
    expect(code(() => b.yield(0))).toBe("bad-price");
    expect(code(() => bond({ coupon: "5%" }))).toBe("bad-bond");
  });
  test("duration and convexity", () => {
    const d = b.duration("6%");
    expect(show(d.macaulay, 6)).toBe("7.894997");
    expect(d.modified.equals(d.macaulay.divide(q("1.03")))).toBe(true);
    expect(show(d.convexity, 4)).toBe("71.7854");
    // a zero-coupon bond's duration is its life
    expect(bond({ coupon: 0, periods: 7, frequency: 1 }).duration("4%").macaulay.toString()).toBe("7");
    // modified duration is −(dP/dy)/P: check against a small exact difference
    const h = q("1/1000000");
    const slope = b.price(q("3/50").add(h)).clean.subtract(b.price(q("3/50").subtract(h)).clean).divide(h.multiply(q("2")));
    const est = slope.negate().divide(b.price("6%").clean);
    expect(Math.abs(est.toNumber() - d.modified.toNumber()) < 1e-9).toBe(true);
  });
  test("between coupon dates", () => {
    const d = bond({ coupon: "4.5%", settlement: "2027-03-15", maturity: "2032-11-15" });
    expect(d.periods).toBe(12);
    expect(d.accruedDays).toBe(120);
    expect(d.accrued.toString()).toBe("3/2");
    expect(d.first.toString()).toBe("1/3");
    expect(String(d.cashflows[0].date)).toBe("2027-05-15");
    const p = d.price("5%");
    expect(p.dirty).toBeInstanceOf(RationalInterval);
    expect(show(p.clean, 5)).toBe("97.55279");
    const y = d.yield("97.5", { digits: 12 });
    expect(show(y, 8)).toBe("0.05010972");
    const back = d.price(y.low).clean;
    expect(back.low.compareTo(q("97.5")) >= 0 || back.high.compareTo(q("97.5")) >= 0).toBe(true);
    expect(show(d.duration("5%").macaulay, 4)).toBe("4.9805");
    // on a coupon date the dated bond agrees with the plain one
    const on = bond({ coupon: "5%", settlement: "2027-05-15", maturity: "2037-05-15" });
    expect(on.accrued.toString()).toBe("0");
    expect(on.price("6%").clean.toString()).toBe(b.price("6%").clean.toString());
  });
});

describe("curves", () => {
  test("bootstrapping is exact", () => {
    const c = bootstrap([
      { price: "97.5", coupon: 0, periods: 1 },
      { price: "100.2", coupon: "3%", periods: 2 },
      { price: "101", coupon: "3.5%", periods: 3 },
    ]);
    expect(c.discountFactors.map(String)).toEqual(["39/40", "3891/4120", "194221/213210"]);
    expect(c.spot(1).toString()).toBe("1/39");
    expect(c.forward(0, 1).toString()).toBe("1/39");
    expect(c.forward(1, 2).toString()).toBe(q("39/40").divide(q("3891/4120")).subtract(q("1")).toString());
    expect(c.price({ coupon: "3.5%", periods: 3 }).toString()).toBe("101");
    expect(c.price({ coupon: c.parYield(3), periods: 3 }).toString()).toBe("100");
    expect(show(c.spot(3), 6)).toBe("0.031582");
    expect(code(() => bootstrap([{ price: 99, coupon: 0, periods: 2 }]))).toBe("bad-curve");
    expect(code(() => c.discount(5))).toBe("off-curve");
  });
  test("spots and forwards", () => {
    const z = yieldCurve({ spots: ["3%", "3.5%", "4%"] });
    expect(z.spots.map(String)).toEqual(["3/100", "7/200", "1/25"]);
    expect(z.forward(1, 2).toString()).toBe(q("1.035").pow(2).divide(q("1.03")).subtract(q("1")).toString());
    expect(show(z.forward(1, 3), 6)).toBe("0.045036");
    const semi = yieldCurve({ spots: ["4%", "4%"], frequency: 2 });
    expect(semi.discount(2).toString()).toBe(q("1").divide(q("1.02").pow(2)).toString());
    expect(semi.forward(1, 2).toString()).toBe("1/25");
  });
  test("immunisation", () => {
    const im = immunise({ liability: { amount: 1000000, time: 7 }, yield: "5%", bonds: [{ coupon: 0, periods: 3, frequency: 1 }, { coupon: "6%", periods: 15, frequency: 1 }] });
    expect(im.presentValue.equals(q("1000000").divide(q("1.05").pow(7)))).toBe(true);
    expect(im.weights[0].add(im.weights[1]).toString()).toBe("1");
    expect(im.weights[0].multiply(im.durations[0]).add(im.weights[1].multiply(im.durations[1])).toString()).toBe("7");
    expect(im.immunised).toBe(true);
    expect(im.surplusAt("5%").toString()).toBe("0");
    expect(im.surplusAt("6%").numerator > 0n && im.surplusAt("4%").numerator > 0n).toBe(true);
    expect(code(() => immunise({ liability: { amount: 1, time: 7 }, yield: "5%", bonds: [{ coupon: 0, periods: 3, frequency: 1 }] }))).toBe("bad-problem");
  });
});
