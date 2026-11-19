export interface MatchGroup {
  id: string;
  /** Position in the class (the group number); groups are taken in this order. Missing: the order of the list. */
  order?: number;
  /** A group without students takes no part: it neither gives nor gets feedback. */
  empty?: boolean;
  reviewsGroupId?: string | null;
}

export interface MatchPlan {
  /** [reviewer, reviewed] for every group that had no group to review yet. */
  links: [string, string][];
  /** Groups that still get no feedback from anyone (only possible if too few groups were free to review). */
  uncovered: string[];
  /** Groups left out because they have no students. */
  skippedEmpty: string[];
  /** Groups that had to share a reviewer with another group (only if the links set by hand left no other way). */
  doubled: string[];
}

/** The number of a group from its id ("group-3") or its name ("Group 3"), or null. */
export function groupNumber(id: string, name?: string): number | null {
  const fromId = /^group-(\d+)$/.exec(id);
  if (fromId) return parseInt(fromId[1], 10);
  const fromName = name ? /(\d+)\s*$/.exec(name) : null;
  return fromName ? parseInt(fromName[1], 10) : null;
}

/**
 * Time's up: every group that is not yet linked reviews the next group "above" it (by group number) that nobody
 * reviews yet; the highest group wraps around to the lowest. With nothing linked beforehand that is a plain circle
 * (1 reviews 2, 2 reviews 3, 3 reviews 1) and every group reviews one group and is reviewed by exactly one.
 * Links set by hand stay as they are, and the groups they already cover are skipped. Empty groups are left out.
 */
export function planRoundRobin(groups: MatchGroup[]): MatchPlan {
  const skippedEmpty = groups.filter((g) => g.empty).map((g) => g.id);
  const active = groups
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => !g.empty)
    .sort((a, b) => (a.g.order ?? a.i) - (b.g.order ?? b.i) || a.i - b.i)
    .map(({ g }) => g);
  const ids = active.map((g) => g.id);
  const n = ids.length;
  const plan: MatchPlan = { links: [], uncovered: [], skippedEmpty, doubled: [] };
  if (n < 2) return plan;

  // Links that point at an empty group (or from one) do not count: that reviewer is free again.
  const active_ = new Set(ids);
  const reviewed = new Set<string>();
  const freeIds: string[] = [];
  for (const g of active) {
    const t = g.reviewsGroupId;
    if (t && active_.has(t) && t !== g.id) reviewed.add(t);
    else freeIds.push(g.id);
  }
  const reviewCount = new Map<string, number>(ids.map((id) => [id, 0]));
  active.forEach((g) => {
    const t = g.reviewsGroupId;
    if (t && active_.has(t) && t !== g.id) reviewCount.set(t, (reviewCount.get(t) ?? 0) + 1);
  });

  const needy = new Set(ids.filter((id) => !reviewed.has(id)));
  const pos = new Map(ids.map((id, i) => [id, i]));
  const pairs: [string, string][] = [];
  for (const r of freeIds) {
    let target: string | null = null;
    for (let step = 1; step < n; step++) {
      const cand = ids[(pos.get(r)! + step) % n];
      if (needy.has(cand)) {
        target = cand;
        break;
      }
    }
    if (target) {
      needy.delete(target);
      pairs.push([r, target]);
      continue;
    }
    // Only this group itself is left unreviewed. Take over the group of the last pair and let that reviewer review us.
    const last = pairs[pairs.length - 1];
    if (last && needy.has(r)) {
      const [r2, t2] = last;
      pairs[pairs.length - 1] = [r, t2];
      pairs.push([r2, r]);
      needy.delete(r);
      continue;
    }
    // No way round it: review the group with the fewest reviewers.
    const options = ids.filter((id) => id !== r).sort((a, b) => (reviewCount.get(a) ?? 0) - (reviewCount.get(b) ?? 0));
    pairs.push([r, options[0]]);
    reviewCount.set(options[0], (reviewCount.get(options[0]) ?? 0) + 1);
    plan.doubled.push(options[0]);
  }
  plan.links = pairs;
  plan.uncovered = Array.from(needy);
  return plan;
}
