import { StoreError } from "./errors.mjs";

/** Reads a (possibly dotted, e.g. "a.b") field from a document's data; undefined if it is missing. */
export function getField(data, field) {
  let cur = data;
  for (const part of String(field).split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

const rank = (v) =>
  v === null ? 0 : typeof v === "boolean" ? 1 : typeof v === "number" ? 2 : typeof v === "string" ? 3 : 4;

/** Orders values the way Firestore does for the types this app uses: null < booleans < numbers < strings < others. */
export function compareValues(a, b) {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 4) {
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** True if a document's data satisfies every "where" condition. A missing field never matches. */
export function matches(data, where) {
  for (const { field, op, value } of where) {
    const v = getField(data, field);
    if (v === undefined) return false;
    let ok;
    switch (op) {
      case "==":
        ok = compareValues(v, value) === 0;
        break;
      case "!=":
        ok = compareValues(v, value) !== 0;
        break;
      case "<":
        ok = rank(v) === rank(value) && compareValues(v, value) < 0;
        break;
      case "<=":
        ok = rank(v) === rank(value) && compareValues(v, value) <= 0;
        break;
      case ">":
        ok = rank(v) === rank(value) && compareValues(v, value) > 0;
        break;
      case ">=":
        ok = rank(v) === rank(value) && compareValues(v, value) >= 0;
        break;
      case "in":
        ok = Array.isArray(value) && value.some((x) => compareValues(v, x) === 0);
        break;
      case "array-contains":
        ok = Array.isArray(v) && v.some((x) => compareValues(x, value) === 0);
        break;
      default:
        throw new StoreError("invalid-argument", `Unsupported query operator: ${op}`);
    }
    if (!ok) return false;
  }
  return true;
}

/** Checks a query description that came from a browser and returns a clean copy of it. */
export function parseSpec(raw) {
  const where = [];
  const order = [];
  for (const w of Array.isArray(raw?.where) ? raw.where : []) {
    if (typeof w?.field !== "string" || typeof w?.op !== "string") {
      throw new StoreError("invalid-argument", "Malformed where condition");
    }
    where.push({ field: w.field, op: w.op, value: w.value === undefined ? null : w.value });
  }
  for (const o of Array.isArray(raw?.order) ? raw.order : []) {
    if (typeof o?.field !== "string") throw new StoreError("invalid-argument", "Malformed orderBy");
    order.push({ field: o.field, dir: o.dir === "desc" ? "desc" : "asc" });
  }
  if (where.length > 10 || order.length > 5) throw new StoreError("invalid-argument", "Query too complex");
  return { where, order };
}

/** Filters and sorts the documents of one collection. Ties are broken by document id, as in Firestore. */
export function runQuery(docs, spec) {
  const { where, order } = spec;
  let out = docs.filter((d) => matches(d.data, where));
  if (order.length) out = out.filter((d) => order.every((o) => getField(d.data, o.field) !== undefined));
  out.sort((a, b) => {
    for (const o of order) {
      const c = compareValues(getField(a.data, o.field), getField(b.data, o.field));
      if (c !== 0) return o.dir === "desc" ? -c : c;
    }
    const byId = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return order.length && order[order.length - 1].dir === "desc" ? -byId : byId;
  });
  return out;
}
