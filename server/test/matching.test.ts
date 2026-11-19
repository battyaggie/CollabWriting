// "Time's up" matching: every group gives feedback to the next group above it.
// Run with: npx tsx --test server/test/matching.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { groupNumber, planRoundRobin, type MatchGroup } from "../../src/lib/matching";

const make = (n: number, pre: Record<string, string> = {}, empty: number[] = []): MatchGroup[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `g${i + 1}`,
    order: i + 1,
    empty: empty.includes(i + 1),
    reviewsGroupId: pre[`g${i + 1}`] ?? null,
  }));

test("nothing linked: a circle in number order, the last group reviews the first", () => {
  for (let n = 2; n <= 9; n++) {
    const { links, uncovered } = planRoundRobin(make(n));
    assert.deepEqual(uncovered, []);
    assert.deepEqual(
      links,
      Array.from({ length: n }, (_, i) => [`g${i + 1}`, `g${(i + 1) % n + 1}`])
    );
  }
});

test("3 groups: 1 gives to 2, 2 gives to 3, 3 gives to 1", () => {
  assert.deepEqual(planRoundRobin(make(3)).links, [["g1", "g2"], ["g2", "g3"], ["g3", "g1"]]);
});

test("the list order does not matter, the group number does", () => {
  const shuffled = [...make(4)].reverse();
  assert.deepEqual(planRoundRobin(shuffled).links.sort(), [["g1", "g2"], ["g2", "g3"], ["g3", "g4"], ["g4", "g1"]]);
});

test("an empty group is left out: it neither gives nor gets feedback", () => {
  const plan = planRoundRobin(make(4, {}, [4]));
  assert.deepEqual(plan.skippedEmpty, ["g4"]);
  assert.deepEqual(plan.links, [["g1", "g2"], ["g2", "g3"], ["g3", "g1"]]);
  const plan2 = planRoundRobin(make(5, {}, [2]));
  assert.deepEqual(plan2.links, [["g1", "g3"], ["g3", "g4"], ["g4", "g5"], ["g5", "g1"]]);
});

test("two finished groups linked first: the rest go round among themselves", () => {
  const plan = planRoundRobin(make(6, { g1: "g2", g2: "g1" }));
  assert.deepEqual(plan.links, [["g3", "g4"], ["g4", "g5"], ["g5", "g6"], ["g6", "g3"]]);
});

test("a link set by hand makes the groups above skip the covered group", () => {
  // g2 reviews g4. Free: g1, g3, g4, g5. Needy: g1, g2, g3, g5.
  const plan = planRoundRobin(make(5, { g2: "g4" }));
  const final = new Map<string, string>([["g2", "g4"], ...plan.links]);
  assert.deepEqual(plan.uncovered, []);
  assert.equal(new Set(final.values()).size, 5);
  assert.equal(final.get("g1"), "g2");
  assert.equal(final.get("g3"), "g5");
});

test("a link to an empty group is ignored", () => {
  const plan = planRoundRobin(make(4, { g1: "g4" }, [4]));
  assert.deepEqual(plan.links, [["g1", "g2"], ["g2", "g3"], ["g3", "g1"]]);
});

test("many random situations: nobody reviews themselves, nobody is overwritten, everybody reviews, nobody is left out if it can be avoided", () => {
  for (let k = 0; k < 20000; k++) {
    const n = 1 + Math.floor(Math.random() * 12);
    const empty = Array.from({ length: n }, (_, i) => i + 1).filter(() => Math.random() < 0.15);
    const pre: Record<string, string> = {};
    for (let i = 1; i <= n; i++)
      if (Math.random() < 0.3) {
        const t = 1 + Math.floor(Math.random() * n);
        if (t !== i) pre[`g${i}`] = `g${t}`;
      }
    const groups = make(n, pre, empty);
    const plan = planRoundRobin(groups);
    const active = groups.filter((g) => !g.empty);
    const keep = new Map<string, string>();
    active.forEach((g) => {
      if (g.reviewsGroupId && active.some((o) => o.id === g.reviewsGroupId)) keep.set(g.id, g.reviewsGroupId);
    });
    const final = new Map(keep);
    for (const [r, t] of plan.links) {
      assert.ok(!keep.has(r), "an existing link is not changed");
      assert.notEqual(r, t, "no group reviews itself");
      assert.ok(active.some((g) => g.id === r) && active.some((g) => g.id === t), "empty groups take no part");
      assert.ok(!final.has(r), "one link per group");
      final.set(r, t);
    }
    if (active.length >= 2) active.forEach((g) => assert.ok(final.has(g.id), `${g.id} reviews someone`));
    const reviewed = new Set(final.values());
    if (active.length >= 2)
      assert.deepEqual(
        active.filter((g) => !reviewed.has(g.id)).map((g) => g.id).sort(),
        [...plan.uncovered].sort()
      );
    if (Object.keys(pre).length === 0 && active.length >= 2) {
      assert.deepEqual(plan.uncovered, []);
      assert.deepEqual(plan.doubled, []);
    }
  }
});

test("group numbers from ids and names", () => {
  assert.equal(groupNumber("group-7"), 7);
  assert.equal(groupNumber("x", "Group 12"), 12);
  assert.equal(groupNumber("x", "Blue"), null);
});
