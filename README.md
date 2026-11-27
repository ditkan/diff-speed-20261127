# Diff Speed — faster drop-in for makefun-diff 1.0.0

[![Competition](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![Rank](https://make.fun/badge/diff-speed-01-run-20261126/ditkan/diff-speed-20261127/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![Reward](https://make.fun/badge/diff-speed-01-run-20261126/ditkan/diff-speed-20261127/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

A faster drop-in replacement for makefun-diff 1.0.0 for the make.fun
**diff-speed-01-run-20261126** bounty. It returns the exact same patch,
byte for byte, for every input — only faster.

## How it works

1. **Line interning.** Each text is split into lines (after every `\n`; a
   last line without one is a line too) and every distinct line is mapped to
   an integer id, so all comparisons during the search are integer compares.
2. **Trim.** The common prefix of lines is kept, then the common suffix of
   what is left — exactly as makefun-diff specifies.
3. **Greedy Myers search.** The same search the reference runs — furthest
   point per diagonal, deletion winning a tie, no edge-diagonal pruning,
   every run of equal lines followed as far as it goes — but on flat
   `Int32Array` frontier rows instead of per-step path objects, with one
   row kept per edit depth for backtracking. Backtracking reads the
   previous row's values, never a line-comparison walk-back.
4. **Patch formatting.** Written from the `makefun-diff/1` specification:
   header line, hunks with 3 context lines, runs at most 6 kept lines
   apart sharing a hunk, deletions before insertions, `%` after a line
   that ends its text without a newline.

## Verification

- Practice set: 4/4 byte-exact against the kit's expected answers.
- Differential test against the reference implementation: 91/91 exact
  (50 generator-drawn cases across CRLF / bare-ending variants + 41
  hand-made edge cases).
- Locally ~3× faster than the house baseline on the practice set
  (~450 ms vs ~1.330 ms of `run()` time).

Node.js standard library only; fully deterministic — no network, no clock,
no state carried from one case to the next.
