// What this package is planned to contain, phase by phase, from the RatMath
// library roadmap. Nothing here is built yet; a phase is removed from this list
// when it ships, and the list goes away when it is empty.

export const plan = Object.freeze([
  {
    "phase": 1,
    "contents": "Money and rounding, day counts, time value, annuities",
    "estimate": "700"
  },
  {
    "phase": 2,
    "contents": "Loans and schedules, cash flows, rates of return",
    "estimate": "800"
  },
  {
    "phase": 3,
    "contents": "Bonds, rates and yield curves",
    "estimate": "700"
  },
  {
    "phase": 4,
    "contents": "Scenarios, exact projection, comparison and sensitivity",
    "estimate": "700"
  },
  {
    "phase": 5,
    "contents": "Uncertain inputs and repeated runs",
    "estimate": "800"
  },
  {
    "phase": 6,
    "contents": "Portfolios, options, life contingencies",
    "estimate": "1,100"
  },
  {
    "phase": 7,
    "contents": "Pictures",
    "estimate": "500 in graphics"
  }
].map(Object.freeze));
