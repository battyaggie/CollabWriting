// "Time's up" matching: every group reviews someone and every group gets reviewed.
// Run with: npx tsx --test server/test/matching.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { planRandomLinks, type MatchGroup } from "../../src/lib/matching";

const make = (n: number, pre: Record<string, string> = {}): MatchGroup[] =>
  Array.from({ length: n }, (_, i) => ({ id: `g${i + 1}`, reviewsGroupId: pre[`g${i + 1}`] ?? null }));

function check(groups: MatchGroup[]) {
  const { links, uncovered } = planRandomLinks(groups);
  const final = new Map(groups.map((g) => [g.id, g.reviewsGroupId ?? null]));
  links.forEach(([r, t]) => {
    assert.equal(final.get(r), null, "a group that already had a link is not changed");
    assert.notEqual(r, t, "no group reviews itself");
    final.set(r, t);
  });
  groups.forEach((g) => assert.ok(final.get(g.id), `${g.id} reviews someone`));
  const reviewed = new Set(final.values());
  return { uncovered, missing: groups.filter((g) => !reviewed.has(g.id)).map((g) => g.id) };
}

test("2 to 9 groups, nothing linked: everyone reviews and is reviewed (many random runs)", () => {
  for (let n = 2; n <= 9; n++)
    for (let k = 0; k < 300; k++) assert.deepEqual(check(make(n)), { uncovered: [], missing: [] }, `n=${n}`);
});

test("5 groups: the odd group is no longer left without feedback", () => {
  for (let k = 0; k < 500; k++) assert.deepEqual(check(make(5)).missing, []);
});

test("groups linked by hand first: the others cover the unreviewed ones", () => {
  // g1 and g2 review each other; g3, g4, g5 are free (g3..g5 must be reviewed too)
  for (let k = 0; k < 500; k++)
    assert.deepEqual(check(make(5, { g1: "g2", g2: "g1" })), { uncovered: [], missing: [] });
  // g1 reviews g2 only: g1 itself and g3..g5 need reviewers; g2 is the only one already reviewed
  for (let k = 0; k < 500; k++) assert.deepEqual(check(make(5, { g1: "g2" })).missing, []);
});

test("too few free groups: says which groups still get no feedback instead of hiding it", () => {
  // g1, g3, g4 all review g2; only g2 and g5 are free, but g1, g3, g4 and g5 all need a reviewer
  const r = check(make(5, { g1: "g2", g3: "g2", g4: "g2" }));
  assert.equal(r.missing.length, 2);
  assert.deepEqual([...r.uncovered].sort(), [...r.missing].sort());
});

test("everything already linked, or a single group: nothing to do", () => {
  assert.deepEqual(planRandomLinks(make(3, { g1: "g2", g2: "g3", g3: "g1" })).links, []);
  assert.deepEqual(planRandomLinks(make(1)).links, []);
});
