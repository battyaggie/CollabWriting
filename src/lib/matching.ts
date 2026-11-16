export interface MatchGroup {
  id: string;
  reviewsGroupId?: string | null;
}

export interface MatchPlan {
  /** [reviewer, reviewed] for every group that had no group to review yet. */
  links: [string, string][];
  /** Groups that still get no feedback from anyone (only possible if too few groups were free to review). */
  uncovered: string[];
}

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Time's up: every group without a group to review gets one, and every group gets reviewed by someone.
 * If nothing is linked yet: pairs that review each other; with an odd number, the last three review in a circle.
 * If some groups were linked by hand: groups nobody reviews yet are served first, then the rest review a group
 * that has the fewest reviewers.
 */
export function planRandomLinks(groups: MatchGroup[]): MatchPlan {
  const links: [string, string][] = [];
  const free = groups.filter((g) => !g.reviewsGroupId);
  if (groups.length < 2 || free.length === 0) return { links, uncovered: [] };

  if (free.length === groups.length && !groups.some((g) => groups.some((o) => o.reviewsGroupId === g.id))) {
    const s = shuffle(groups.map((g) => g.id));
    const circle = s.length % 2 === 1 ? s.splice(s.length - 3, 3) : [];
    for (let i = 0; i < s.length; i += 2) links.push([s[i], s[i + 1]], [s[i + 1], s[i]]);
    circle.forEach((id, i) => links.push([id, circle[(i + 1) % circle.length]]));
    return { links, uncovered: [] };
  }

  const count = new Map<string, number>(groups.map((g) => [g.id, 0]));
  groups.forEach((g) => g.reviewsGroupId && count.set(g.reviewsGroupId, (count.get(g.reviewsGroupId) ?? 0) + 1));
  const freeIds = free.map((g) => g.id);
  const needyAll = groups.map((g) => g.id).filter((id) => count.get(id) === 0);

  // Groups nobody reviews yet come first. A single pass can get stuck (the last needy group may be the only reviewer
  // left), so try again with a different shuffle until every needy group is served, or keep the best try.
  let best: { pairs: [string, string][]; left: string[]; unserved: number } | null = null;
  for (let attempt = 0; attempt < 200 && (!best || best.unserved > 0); attempt++) {
    const rest = shuffle(freeIds);
    const pairs: [string, string][] = [];
    let unserved = 0;
    for (const target of shuffle(needyAll)) {
      const at = rest.findIndex((r) => r !== target);
      if (at === -1) {
        unserved++;
        continue;
      }
      pairs.push([rest.splice(at, 1)[0], target]);
    }
    if (!best || unserved < best.unserved) best = { pairs, left: rest, unserved };
  }
  const reviewers = best ? best.left : freeIds;
  (best?.pairs ?? []).forEach(([r, t]) => {
    links.push([r, t]);
    count.set(t, 1);
  });
  // Everyone left reviews the group with the fewest reviewers (not themselves).
  for (const r of reviewers) {
    const options = shuffle(groups.map((g) => g.id).filter((id) => id !== r));
    options.sort((a, b) => (count.get(a) ?? 0) - (count.get(b) ?? 0));
    links.push([r, options[0]]);
    count.set(options[0], (count.get(options[0]) ?? 0) + 1);
  }
  return { links, uncovered: groups.map((g) => g.id).filter((id) => !count.get(id)) };
}
