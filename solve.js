// A faster drop-in replacement for makefun-diff 1.0.0: the same patch, byte for byte,
// computed by the same greedy Myers search, but on interned line ids in flat
// Int32Array rows instead of per-step path objects.
//
// Rule implemented (from makefun-diff's own header): a text is cut after every
// "\n" (a "\r" stays part of its line); a last line with no "\n" is a line too;
// the empty text has no lines. Lines are equal only as the same code units,
// newline included. The common prefix is kept, then the common suffix of what
// is left; between them Myers's greedy search runs, keeping on each diagonal
// the path furthest into the old text, the deletion winning a tie, never
// moving past either text's end, pruning no edge diagonal, and following every
// run of equal lines as far as it goes. The first path to reach both ends is
// the script. The patch is then formatted exactly as makefun-diff/1 specifies.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;
const CONTEXT = 3;

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function splitLines(text) {
  const parts = text.split('\n');
  const lines = new Array(parts.length);
  const last = parts.length - 1;
  for (let i = 0; i < last; i++) lines[i] = parts[i] + '\n';
  if (parts[last] !== '') lines[last] = parts[last];
  else lines.length = last;
  return lines;
}

/**
 * The edit runs of the middle (id arrays a/b, lengths n/m, read from offsets
 * aOff/bOff) as [{ kind, count }] in order: the greedy Myers search with a
 * full trace, backtracked without a comparison walk-back.
 */
function myersRuns(a, b, aOff, bOff, n, m) {
  // The trace: trace[d] is an Int32Array of length 2d+1; trace[d][k + d] is the
  // old-lines-consumed count x of the furthest d-edit path on diagonal k
  // (k = x - y), or -1 when no such path exists (a real x is always >= 0).
  const trace = [];
  let cur = new Int32Array(1);
  let x = 0;
  let y = 0;
  while (x < n && y < m && a[aOff + x] === b[bOff + y]) {
    x++;
    y++;
  }
  cur[0] = x;
  trace.push(cur);
  if (x === n && y === m) return n > 0 ? [{ kind: KEEP, count: n }] : [];

  let D = -1;
  for (let d = 1; d <= n + m; d++) {
    cur = new Int32Array(2 * d + 1);
    const prev = trace[d - 1];
    for (let k = -d; k <= d; k += 2) {
      const j = k + d;
      // Deletion: from diagonal k-1, one old line further; valid while a line
      // of the old text is left for it to consume.
      let xDel = -1;
      if (k > -d) {
        const v = prev[k + d - 2];
        if (v >= 0 && v < n) xDel = v + 1;
      }
      // Insertion: from diagonal k+1, one new line further; valid while a
      // line of the new text is left for it to consume (y = v - (k + 1)).
      let xIns = -1;
      if (k < d) {
        const v = prev[k + d];
        if (v >= 0 && v - (k + 1) < m) xIns = v;
      }
      // Further into the old text wins; the deletion wins a tie.
      let xx;
      if (xDel >= 0 && (xIns < 0 || xDel >= xIns)) xx = xDel;
      else xx = xIns;
      if (xx >= 0) {
        // The snake: every line equal in both, as far as it goes.
        const bBase = bOff - k;
        let yy = xx - k;
        while (xx < n && yy < m && a[aOff + xx] === b[bBase + xx]) {
          xx++;
          yy++;
        }
      }
      cur[j] = xx;
      if (xx === n && xx - k === m) {
        D = d;
        break;
      }
    }
    trace.push(cur);
    if (D >= 0) break;
  }
  if (D < 0) throw new Error('diff: the search ended without reaching both ends');

  // Backtrack, d = D .. 1, deciding each edit from V_{d-1} with the same rule
  // the forward search used. rev collects, per step, the kept run after the
  // edit and then the edit itself, so reversing it gives forward order.
  const rev = [];
  x = n;
  y = m;
  let k = n - m;
  for (let d = D; d >= 1; d--) {
    const prev = trace[d - 1];
    let effDel = -2;
    let effIns = -2;
    if (k >= -d + 2) {
      const v = prev[k + d - 2];
      if (v >= 0 && v < n) effDel = v;
    }
    if (k <= d - 2) {
      const v = prev[k + d];
      if (v >= 0 && v - (k + 1) < m) effIns = v - 1;
    }
    let x0;
    let y0;
    let kind;
    if (effDel === -2 && effIns === -2) throw new Error('diff: the backtrack lost the path');
    if (effDel >= effIns) {
      // Deletion: the pre-snake point is one old line past V_{d-1}[k-1].
      x0 = effDel + 1;
      y0 = x0 - k;
      kind = DELETE;
    } else {
      // Insertion: the pre-snake point is V_{d-1}[k+1] into the old text.
      x0 = effIns + 1;
      y0 = x0 - k;
      kind = INSERT;
    }
    const kept = x - x0;
    if (kept > 0) rev.push({ kind: KEEP, count: kept });
    rev.push({ kind, count: 1 });
    if (kind === DELETE) {
      x = x0 - 1;
      y = y0;
      k -= 1;
    } else {
      x = x0;
      y = y0 - 1;
      k += 1;
    }
  }
  // The d = 0 snake: what is left from the start is one kept run.
  if (x > 0) rev.push({ kind: KEEP, count: x });
  rev.reverse();
  // Merge runs of one kind that the step-by-step walk left adjacent.
  const runs = [];
  for (const r of rev) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === r.kind) last.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** The makefun-diff/1 patch string for line arrays aLines/bLines and their edit runs. */
function formatPatch(aLines, bLines, runs, N, M) {
  // The change runs: each a stretch of deletions and insertions between two
  // kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`makefun-diff/1 old=${N} new=${M} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, N - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', aLines[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', aLines[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', bLines[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', aLines[at]));
  }
  return out.join('');
}

/** make.fun's own patch of input.old into input.new, as makefun-diff/1 writes it. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('diff: the input is { old, new }, two strings');
  }
  const oldText = input.old;
  const newText = input.new;

  // Tokenize, interning each distinct line to an id (one fresh Map per call,
  // shared by the old and the new text of this case only).
  const aLines = splitLines(oldText);
  const bLines = splitLines(newText);
  const ids = new Map();
  const a = new Int32Array(aLines.length);
  const b = new Int32Array(bLines.length);
  let nextId = 0;
  for (let i = 0; i < aLines.length; i++) {
    const s = aLines[i];
    let id = ids.get(s);
    if (id === undefined) {
      id = nextId++;
      ids.set(s, id);
    }
    a[i] = id;
  }
  for (let i = 0; i < bLines.length; i++) {
    const s = bLines[i];
    let id = ids.get(s);
    if (id === undefined) {
      id = nextId++;
      ids.set(s, id);
    }
    b[i] = id;
  }
  const N = a.length;
  const M = b.length;

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < N && prefix < M && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < N - prefix && suffix < M - prefix && a[N - 1 - suffix] === b[M - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...myersRuns(a, b, prefix, prefix, N - prefix - suffix, M - prefix - suffix));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  return formatPatch(aLines, bLines, runs, N, M);
}
