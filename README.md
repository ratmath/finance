# @ratmath/finance

Money, loans and scenarios for [RatMath](https://ratmath.com/), part of the
[RatMath Shelf](https://ratmath.com/shelf/).

**Status: set up, nothing built yet.** This repository holds the package
skeleton and the docs site. The plan is in the
[library roadmap](https://github.com/ratmath/ratmath/blob/main/docs/design/library-roadmap.md#12-a-finance-package-ratmathfinance).

The mathematics of finance with exact money: time value, loans with schedules that reconcile to the cent, bonds and yield curves, and the commonly needed building blocks for simulating a financial situation over time. A full simulation environment would be an app on top.

## Planned

| Phase | Contents |
|---|---|
| 1 | Money and rounding, day counts, time value, annuities |
| 2 | Loans and schedules, cash flows, rates of return |
| 3 | Bonds, rates and yield curves |
| 4 | Scenarios, exact projection, comparison and sensitivity |
| 5 | Uncertain inputs and repeated runs |
| 6 | Portfolios, options, life contingencies |
| 7 | Pictures |

It will depend on: Core, analytic (roots, exponentials), stats (distributions, the seeded generator) and linalg (portfolios).

## Layout

- `index.js`, `src/`: the library. For now it exports only `plan`, the list
  above, so that the tests and the docs build have something to load.
- `tests/`: `bun run test`.
- `docs/src/*.html`: the docs pages (overview, explore, reference, then one
  page per topic as topics are built). `bun run docs:build` writes `docs/`,
  typesets the mathematics and runs the code box at the end of every page.
  `docs/*.html` and `docs/assets/finance.js` are build output.
- `docs/assets/runbox.js` and `scripts/docs-kit.js` are shared with the other
  RatMath docs sites and should be kept in step with them.

## Development

```sh
bun install
bun run test
bun run docs:build
```

Each topic that is built gets its own docs page with usage, the mathematics
explained, and a runnable code box at the end, and is then listed on the
[Shelf page](https://ratmath.com/shelf/).

MIT licensed.
