import { expect, test } from "bun:test";
import * as lib from "../index.js";

test("the package loads and says what is still planned", () => {
  expect(Array.isArray(lib.plan)).toBe(true);
  expect(lib.plan.map((p) => p.phase)).toEqual([5, 6, 7]);
  lib.plan.forEach((p) => {
    expect(typeof p.contents).toBe("string");
    expect(typeof p.estimate).toBe("string");
  });
  expect(Object.isFrozen(lib.plan)).toBe(true);
});

test("everything named in the index is there", () => {
  for (const name of ["amount", "round", "format", "allocate", "dayCount", "compound", "annuity", "tvm", "loan", "refinance", "revolving", "npv", "irr", "xirr", "mirr", "depreciation", "taxSchedule", "bond", "bootstrap", "immunise", "scenario", "compare", "sensitivity"]) expect(typeof lib[name]).toBe("function");
});
