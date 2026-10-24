"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  writeBatch,
  type QuerySnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { colorFor } from "@/lib/colors";
import { editParagraphs, mergeRemote, planChanges, resolveAnchor, withSegments, type Anchor, type Plan } from "@/lib/doc";
import { mergeSegments, runSegments, sameSegs, segmentsText } from "@/lib/segments";
import type { RunDoc, Segment } from "@/lib/types";

interface Props {
  classId: string;
  groupId: string;
  studentId: string;
  alias: string;
  colorIndex: number;
  /** true for the read-only, enlarged projector rendering */
  projector?: boolean;
  /** true for a read-only, normal-size rendering */
  readOnly?: boolean;
  /** comments to mark in the text (highlighted) */
  anchors?: (Anchor & { id: string })[];
  /**
   * If given, a "Comment" button appears when text is selected. It opens the returned box next
   * to the selection; call `close` to dismiss it.
   */
  renderCommentBox?: (selection: Anchor, close: () => void) => ReactNode;
}

type Run = RunDoc & { id: string; segments: Segment[] };

function toRun(id: string, d: RunDoc): Run {
  return { ...d, id, segments: runSegments(d) };
}

function runData(r: Run): RunDoc {
  return {
    studentId: r.studentId,
    alias: r.alias,
    colorIndex: r.colorIndex,
    text: segmentsText(r.segments),
    segments: r.segments,
    order: r.order,
    updatedAt: Date.now(),
  };
}

/* ---------- DOM helpers (the text box is one editable element holding one <div> per paragraph) ---------- */

function paraLen(el: Element): number {
  return el.textContent?.length ?? 0;
}

function readTexts(root: HTMLElement): string[] {
  return Array.from(root.children).map((c) => c.textContent ?? "");
}

function blankLine(): HTMLElement {
  const div = document.createElement("div");
  div.appendChild(document.createElement("br"));
  return div;
}

/** Makes sure every direct child of the box is a paragraph <div> (browsers sometimes leave loose text behind). */
function normalizeRoot(root: HTMLElement) {
  let current: HTMLElement | null = null;
  for (const node of Array.from(root.childNodes)) {
    if (node instanceof HTMLElement && node.tagName === "DIV") {
      current = null;
      continue;
    }
    if (!current) {
      current = document.createElement("div");
      root.insertBefore(current, node);
    }
    current.appendChild(node);
  }
  if (!root.firstElementChild) root.appendChild(blankLine());
}

/** Position in the whole text (paragraphs joined by one newline each) of a point inside the box. */
function docOffsetOf(root: HTMLElement, node: Node, offset: number): number {
  const kids = Array.from(root.children);
  if (node === root) {
    let total = 0;
    for (let k = 0; k < Math.min(offset, kids.length); k++) total += paraLen(kids[k]) + 1;
    const all = kids.reduce((n, el) => n + paraLen(el), 0) + Math.max(0, kids.length - 1);
    return Math.min(total, all);
  }
  let top: Node | null = node;
  while (top && top.parentNode !== root) top = top.parentNode;
  if (!top) return 0;
  const idx = kids.indexOf(top as Element);
  if (idx === -1) return 0;
  let before = 0;
  for (let k = 0; k < idx; k++) before += paraLen(kids[k]) + 1;
  const range = document.createRange();
  range.selectNodeContents(top);
  range.setEnd(node, offset);
  return before + range.toString().length;
}

function caretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.focusNode || !root.contains(sel.focusNode)) return 0;
  return docOffsetOf(root, sel.focusNode, sel.focusOffset);
}

/** The place in the box (a node and an offset in it) for a position in the whole text. */
function domPoint(root: HTMLElement, offset: number): { node: Node; offset: number } {
  const kids = Array.from(root.children);
  let off = offset;
  for (let k = 0; k < kids.length; k++) {
    const el = kids[k];
    const len = paraLen(el);
    if (off <= len || k === kids.length - 1) {
      let remaining = Math.min(off, len);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const l = n.textContent?.length ?? 0;
        if (remaining <= l) return { node: n, offset: remaining };
        remaining -= l;
      }
      return { node: el, offset: 0 };
    }
    off -= len + 1;
  }
  return { node: root, offset: 0 };
}

function placeCaret(root: HTMLElement, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const p = domPoint(root, offset);
  const range = document.createRange();
  range.setStart(p.node, p.offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

type Sig = [string | null, string][];

function mergeSig(parts: Sig): Sig {
  const out: Sig = [];
  for (const [k, t] of parts) {
    if (!t) continue;
    const last = out[out.length - 1];
    if (last && last[0] === k) last[1] += t;
    else out.push([k, t]);
  }
  return out;
}

/** What a paragraph element currently shows: its pieces of text and who each piece is marked as written by. */
function domSig(el: HTMLElement): Sig {
  const parts: Sig = [];
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) parts.push([null, n.textContent ?? ""]);
    else if (n instanceof HTMLElement) parts.push([n.dataset.s ?? null, n.textContent ?? ""]);
  });
  return mergeSig(parts);
}

function segSig(segs: Segment[]): Sig {
  return mergeSig(segs.map((s) => [s.studentId, s.text] as [string, string]));
}

/** Rebuilds a paragraph element as one coloured span per author. */
function renderSegments(el: HTMLElement, segs: Segment[]) {
  el.textContent = "";
  for (const seg of segs) {
    const span = document.createElement("span");
    span.dataset.s = seg.studentId;
    span.title = seg.alias;
    span.style.color = colorFor(seg.colorIndex);
    span.textContent = seg.text;
    el.appendChild(span);
  }
  if (segs.length === 0) el.appendChild(document.createElement("br"));
}

/** Makes the paragraph element show `segs`, rebuilding it only if it differs. Returns true if it was rebuilt. */
function syncElement(el: HTMLElement, segs: Segment[]): boolean {
  if (JSON.stringify(domSig(el)) === JSON.stringify(segSig(segs))) {
    if (segs.length === 0 && el.childNodes.length === 0) {
      el.appendChild(document.createElement("br"));
      return true;
    }
    return false;
  }
  renderSegments(el, segs);
  return true;
}

/* ----- keeping the caret in place when text changes under it ----- */

/** Where a position in `oldText` ends up after the text became `newText` (only the changed stretch moves it). */
function mapOffset(oldText: string, newText: string, off: number): number {
  const max = Math.min(oldText.length, newText.length);
  let head = 0;
  while (head < max && oldText[head] === newText[head]) head++;
  let tail = 0;
  while (tail < max - head && oldText[oldText.length - 1 - tail] === newText[newText.length - 1 - tail]) tail++;
  if (off <= head) return off;
  if (off >= oldText.length - tail) return off + (newText.length - oldText.length);
  return newText.length - tail;
}

interface SelPoint {
  el: HTMLElement;
  off: number;
  text: string;
}

function selPoint(root: HTMLElement, node: Node | null, offset: number): SelPoint | null {
  if (!node || !root.contains(node)) return null;
  let top: Node | null = node;
  while (top && top.parentNode !== root) top = top.parentNode;
  if (!(top instanceof HTMLElement)) return null;
  const range = document.createRange();
  range.selectNodeContents(top);
  range.setEnd(node, offset);
  return { el: top, off: range.toString().length, text: top.textContent ?? "" };
}

function pointIn(el: HTMLElement, off: number): { node: Node; offset: number } {
  let remaining = off;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const l = n.textContent?.length ?? 0;
    if (remaining <= l) return { node: n, offset: remaining };
    remaining -= l;
  }
  return { node: el, offset: 0 };
}

/** Remembers where the caret / selection is, so it can be put back after paragraphs were rewritten. */
function captureSelection(root: HTMLElement): { anchor: SelPoint; focus: SelPoint } | null {
  const sel = window.getSelection();
  if (document.activeElement !== root || !sel || sel.rangeCount === 0) return null;
  const anchor = selPoint(root, sel.anchorNode, sel.anchorOffset);
  const focus = selPoint(root, sel.focusNode, sel.focusOffset);
  return anchor && focus ? { anchor, focus } : null;
}

function restoreSelection(saved: { anchor: SelPoint; focus: SelPoint } | null) {
  if (!saved) return;
  const sel = window.getSelection();
  if (!sel) return;
  const place = (p: SelPoint) => {
    if (!p.el.isConnected) return null;
    const now = p.el.textContent ?? "";
    if (now === p.text) return null; // untouched: the browser kept the caret there itself
    return pointIn(p.el, mapOffset(p.text, now, p.off));
  };
  const a = place(saved.anchor);
  const f = place(saved.focus);
  if (!a && !f) return;
  const anchorPt = a ?? (saved.anchor.el.isConnected ? pointIn(saved.anchor.el, saved.anchor.off) : null);
  const focusPt = f ?? (saved.focus.el.isConnected ? pointIn(saved.focus.el, saved.focus.off) : null);
  if (!anchorPt || !focusPt) return;
  sel.setBaseAndExtent(anchorPt.node, anchorPt.offset, focusPt.node, focusPt.offset);
}

/** Marks stretches of the text with the browser's highlight feature (no change to the text itself). */
function setHighlight(name: string, ranges: Range[]) {
  const reg = (CSS as unknown as { highlights?: { set(k: string, v: unknown): void; delete(k: string): void } })
    .highlights;
  const HL = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!reg || !HL) return;
  if (ranges.length === 0) reg.delete(name);
  else reg.set(name, new HL(...ranges));
}

function rangeFor(root: HTMLElement, start: number, end: number): Range {
  const a = domPoint(root, start);
  const b = domPoint(root, end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

/* ---------- read-only rendering (projector, plain read-only) ---------- */

function ReadOnlyText({ runs, className, emptyClass }: { runs: Run[]; className: string; emptyClass: string }) {
  return (
    <div className={`cw-text whitespace-pre-wrap break-words ${className}`}>
      {runs.length === 0 && <p className={`m-0 italic ${emptyClass}`}>Nothing written yet&hellip;</p>}
      {runs.map((r) => (
        <div key={r.id}>
          {r.segments.length === 0 ? (
            <br />
          ) : (
            r.segments.map((seg, i) => (
              <span key={i} style={{ color: colorFor(seg.colorIndex) }} title={seg.alias}>
                {seg.text}
              </span>
            ))
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- the component ---------- */

export function GroupWriter(props: Props) {
  const { classId, groupId, studentId, alias, colorIndex, projector, readOnly, anchors, renderCommentBox } = props;
  const editable = !projector && !readOnly;

  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [selBtn, setSelBtn] = useState<{ top: number; left: number } | null>(null);
  const [composing, setComposing] = useState<(Anchor & { top: number }) | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** This browser's up-to-date copy of the paragraphs (updated at once when typing, merged with the server's). */
  const modelRef = useRef<Run[]>([]);
  const dirty = useRef<Set<string>>(new Set());
  /** Last version of each paragraph known to be on the server: the common starting point for merging. */
  const baseRef = useRef<Map<string, Segment[]>>(new Map());
  /** Paragraphs whose save is running right now. */
  const inflightRef = useRef<Set<string>>(new Set());
  /** A server update that arrived while an input method (accents, Asian languages) was composing. */
  const pendingSnapRef = useRef<QuerySnapshot | null>(null);
  const applySnapRef = useRef<(snap: QuerySnapshot) => void>(() => {});
  const pendingCreates = useRef<Set<string>>(new Set());
  const pendingDeletes = useRef<Set<string>>(new Set());
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const loadedRef = useRef(false);
  const imeRef = useRef(false);
  const bulkRef = useRef(false);
  const selRef = useRef<Anchor | null>(null);
  const composingRef = useRef<(Anchor & { top: number }) | null>(null);
  const anchorsRef = useRef(anchors);
  const idsRef = useRef({ classId, groupId });

  idsRef.current = { classId, groupId };
  anchorsRef.current = anchors;
  composingRef.current = composing;

  function runsCol() {
    return collection(db, "classes", idsRef.current.classId, "groups", idsRef.current.groupId, "runs");
  }

  /* ----- keep the text box in line with the model ----- */

  function syncDom() {
    const root = rootRef.current;
    if (!root) return;
    if (!root.firstElementChild) root.appendChild(blankLine());
    const list = modelRef.current;
    const saved = captureSelection(root);

    if (list.length === 0) {
      // Everything was deleted elsewhere: drop stale paragraphs (the one being typed in stays, as a blank line).
      const keep = saved ? saved.focus.el : null;
      Array.from(root.children).forEach((c) => {
        if ((c as HTMLElement).dataset.run && c !== keep) root.removeChild(c);
      });
      if (!root.firstElementChild) root.appendChild(blankLine());
    } else {
      const byId = new Map<string, HTMLElement>();
      Array.from(root.children).forEach((c) => {
        const id = (c as HTMLElement).dataset.run;
        if (id && !byId.has(id)) byId.set(id, c as HTMLElement);
      });
      list.forEach((r, k) => {
        let el = byId.get(r.id);
        if (!el) {
          el = document.createElement("div");
          el.dataset.run = r.id;
          renderSegments(el, r.segments);
        }
        const at = root.children[k] ?? null;
        if (at !== el) root.insertBefore(el, at);
        // Every paragraph is brought up to date, also the one the caret is in: otherwise a change made by
        // someone else never shows up there and this browser and the server drift apart.
        syncElement(el, r.segments);
      });
      while (root.children.length > list.length) root.removeChild(root.lastElementChild as Element);
    }
    restoreSelection(saved);
    refreshHighlights();
  }

  function refreshHighlights() {
    const root = rootRef.current;
    if (!root) return;
    const text = readTexts(root).join("\n");
    const ranges: Range[] = [];
    (anchorsRef.current ?? []).forEach((a) => {
      const r = resolveAnchor(text, a);
      if (r) ranges.push(rangeFor(root, r.start, r.end));
    });
    setHighlight("cw-comment", ranges);
    const c = composingRef.current;
    setHighlight("cw-pending", c ? [rangeFor(root, c.start, c.end)] : []);
  }

  /** Takes in the paragraphs the server just sent and merges them with what this browser has. */
  function applySnapshot(snap: QuerySnapshot) {
    const modelById = new Map(modelRef.current.map((r) => [r.id, r]));
    const own = new Set<string>(); // echoes of this browser's own writes that the server has not confirmed yet
    const remote: Run[] = snap.docs.map((d) => {
      const mine = modelById.get(d.id);
      if (editable && mine && d.metadata.hasPendingWrites) {
        own.add(d.id);
        return mine;
      }
      return toRun(d.id, d.data() as RunDoc);
    });
    const merged = editable
      ? mergeRemote(
          modelRef.current,
          remote,
          dirty.current,
          pendingCreates.current,
          pendingDeletes.current,
          baseRef.current,
          inflightRef.current
        )
      : remote;
    if (editable) {
      remote.forEach((r) => {
        if (!own.has(r.id) && !inflightRef.current.has(r.id)) baseRef.current.set(r.id, r.segments);
      });
    }
    modelRef.current = merged;
    loadedRef.current = true;
    setRuns(merged);
    setLoaded(true);
    setLoadError(false);
    if (editable) syncDom();
  }
  applySnapRef.current = applySnapshot;

  /* ----- listen to the group's paragraphs ----- */

  useEffect(() => {
    modelRef.current = [];
    baseRef.current = new Map();
    inflightRef.current = new Set();
    pendingSnapRef.current = null;
    loadedRef.current = false;
    setLoaded(false);
    setLoadError(false);
    if (rootRef.current) rootRef.current.textContent = "";
    const q = query(
      collection(db, "classes", classId, "groups", groupId, "runs"),
      orderBy("order", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        // While someone is composing a character with an input method, rewriting the text would break it: wait.
        if (editable && imeRef.current) pendingSnapRef.current = snap;
        else applySnapRef.current(snap);
      },
      (err) => {
        console.error(err);
        setLoadError(true);
      }
    );
    const flush = () => {
      Object.values(timers.current).forEach(clearTimeout);
      timers.current = {};
      dirty.current.forEach((id) => {
        const run = modelRef.current.find((r) => r.id === id);
        if (run) setDoc(doc(db, "classes", classId, "groups", groupId, "runs", id), runData(run), { merge: true }).catch(console.error);
      });
      dirty.current.clear();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      unsub();
      flush();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      setHighlight("cw-comment", []);
      setHighlight("cw-pending", []);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, groupId, editable]);

  // One-time browser settings for the text box: new lines are <div>s, and no rich formatting.
  useEffect(() => {
    const root = rootRef.current;
    if (!editable || !root) return;
    try {
      document.execCommand("defaultParagraphSeparator", false, "div");
    } catch {
      /* not supported: fine */
    }
    const onBeforeInput = (e: Event) => {
      const t = (e as InputEvent).inputType ?? "";
      if (t.startsWith("format") || t === "insertFromDrop" || t === "deleteByDrag") {
        e.preventDefault();
      } else if (t === "insertLineBreak") {
        e.preventDefault();
        document.execCommand("insertParagraph");
      }
    };
    root.addEventListener("beforeinput", onBeforeInput);
    return () => root.removeEventListener("beforeinput", onBeforeInput);
  }, [editable]);

  // Marked comments and the "being commented" stretch follow the data.
  useEffect(() => {
    if (editable) refreshHighlights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, composing, runs, editable]);

  // Show a "Comment" button next to selected text.
  useEffect(() => {
    if (!editable || !renderCommentBox) return;
    const onSel = () => {
      if (composingRef.current) return;
      const root = rootRef.current;
      const wrap = wrapRef.current;
      const sel = window.getSelection();
      if (!root || !wrap || !sel || sel.rangeCount === 0 || sel.isCollapsed || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) {
        selRef.current = null;
        setSelBtn(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const a = docOffsetOf(root, range.startContainer, range.startOffset);
      const b = docOffsetOf(root, range.endContainer, range.endOffset);
      const quote = readTexts(root).join("\n").slice(a, b).slice(0, 400);
      if (!quote.trim()) {
        selRef.current = null;
        setSelBtn(null);
        return;
      }
      selRef.current = { start: a, end: a + quote.length, quote };
      const rect = range.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      setSelBtn({ top: rect.bottom - w.top + 6, left: Math.max(0, Math.min(rect.left - w.left, w.width - 140)) });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [editable, renderCommentBox]);

  /* ----- saving ----- */

  function scheduleSave(id: string, delay = 1500) {
    if (timers.current[id]) clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => {
      delete timers.current[id];
      dirty.current.delete(id);
      void saveRun(id);
    }, delay);
  }

  /**
   * Saves one paragraph. The server's current version is read first: if someone else changed the
   * paragraph in the meantime, their change and ours are merged instead of one overwriting the other.
   */
  async function saveRun(id: string) {
    const run = modelRef.current.find((r) => r.id === id);
    if (!run) return;
    const ref = doc(runsCol(), id);
    const startedWith = run.segments;
    let result: Segment[] = startedWith;
    inflightRef.current.add(id);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        result = startedWith;
        if (snap.exists()) {
          const server = runSegments(snap.data() as RunDoc);
          if (sameSegs(server, startedWith)) return; // already saved: nothing to write
          const base = baseRef.current.get(id) ?? server;
          result = sameSegs(server, base) ? startedWith : mergeSegments(base, startedWith, server);
        }
        tx.set(ref, runData({ ...run, segments: result }), { merge: true });
      });
      baseRef.current.set(id, result);
      setSavedAt(new Date());
      setSaveError(false);
    } catch (err) {
      console.error(err);
      inflightRef.current.delete(id);
      dirty.current.add(id);
      setSaveError(true);
      scheduleSave(id, 4000); // try again shortly
      return;
    }
    inflightRef.current.delete(id);

    // If the save pulled in someone else's changes, or the typist kept typing meanwhile, bring the screen in line.
    const cur = modelRef.current.find((r) => r.id === id);
    if (!cur || sameSegs(result, startedWith)) return;
    const next = sameSegs(cur.segments, startedWith) ? result : mergeSegments(startedWith, cur.segments, result);
    modelRef.current = modelRef.current.map((r) => (r.id === id ? withSegments(r, next) : r));
    setRuns(modelRef.current);
    syncDom();
    if (!sameSegs(next, result)) {
      dirty.current.add(id);
      scheduleSave(id);
    }
  }

  function writeStructure(plan: Plan) {
    const batch = writeBatch(db);
    const created: string[] = [];
    const deleted: string[] = [];
    plan.runs.forEach((pr) => {
      if (pr.kind === "same" && !pr.orderChanged) return;
      const run = modelRef.current.find((r) => r.id === pr.id);
      if (!run) return;
      batch.set(doc(runsCol(), pr.id), runData(run), { merge: true });
      baseRef.current.set(pr.id, pr.segments);
      if (timers.current[pr.id]) clearTimeout(timers.current[pr.id]);
      delete timers.current[pr.id];
      dirty.current.delete(pr.id);
      if (pr.kind === "create") {
        pendingCreates.current.add(pr.id);
        created.push(pr.id);
      }
    });
    plan.deletes.forEach((id) => {
      batch.delete(doc(runsCol(), id));
      baseRef.current.delete(id);
      pendingDeletes.current.add(id);
      if (timers.current[id]) clearTimeout(timers.current[id]);
      delete timers.current[id];
      dirty.current.delete(id);
      deleted.push(id);
    });
    batch
      .commit()
      .then(() => {
        setSavedAt(new Date());
        setSaveError(false);
      })
      .catch((err) => {
        console.error(err);
        setSaveError(true);
      })
      .finally(() => {
        created.forEach((id) => pendingCreates.current.delete(id));
        deleted.forEach((id) => pendingDeletes.current.delete(id));
      });
  }

  /* ----- typing ----- */

  /** Called after every change in the box (typing, deleting, pasting, Enter...). */
  function handleInput() {
    const root = rootRef.current;
    if (!root || !loadedRef.current || imeRef.current || bulkRef.current) return;
    normalizeRoot(root);
    const texts = readTexts(root);
    const caret = caretOffset(root);
    const model = modelRef.current;
    if (model.length === 0 && texts.length === 1 && texts[0] === "") return;

    const author = { studentId, alias, colorIndex };
    const nextParas = editParagraphs(
      model.map((r) => r.segments),
      texts.join("\n"),
      caret,
      author
    );
    const newId = () => doc(runsCol()).id;
    const plan = planChanges(model, nextParas, newId);

    const prevById = new Map(model.map((r) => [r.id, r]));
    const next: Run[] = plan.runs.map((pr) => {
      const prev = prevById.get(pr.id);
      return {
        id: pr.id,
        studentId: prev?.studentId ?? author.studentId,
        alias: prev?.alias ?? author.alias,
        colorIndex: prev?.colorIndex ?? author.colorIndex,
        text: segmentsText(pr.segments),
        segments: pr.segments,
        order: pr.order,
        updatedAt: Date.now(),
      };
    });
    modelRef.current = next;
    setRuns(next);

    // Colour each paragraph by who wrote what, and give each its id.
    let rebuilt = false;
    (Array.from(root.children) as HTMLElement[]).forEach((div, k) => {
      const pr = plan.runs[k];
      if (!pr) return;
      div.dataset.run = pr.id;
      if (syncElement(div, pr.segments)) rebuilt = true;
    });
    if (rebuilt) placeCaret(root, caret);
    refreshHighlights();

    const structural = plan.deletes.length > 0 || plan.runs.some((r) => r.kind === "create" || r.orderChanged);
    if (structural) {
      writeStructure(plan);
    } else {
      plan.runs.forEach((pr) => {
        if (pr.kind === "update") {
          dirty.current.add(pr.id);
          scheduleSave(pr.id);
        }
      });
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    if (!text) return;
    bulkRef.current = true;
    try {
      text.split("\n").forEach((line, i) => {
        if (i > 0) document.execCommand("insertParagraph");
        if (line) document.execCommand("insertText", false, line);
      });
    } finally {
      bulkRef.current = false;
    }
    handleInput();
  }

  /* ----- rendering ----- */

  if (readOnly) {
    return (
      <div className="bg-white border border-tw-grey-light rounded-xl p-6 text-[17px] leading-[1.7]">
        <ReadOnlyText runs={runs} className="" emptyClass="text-tw-grey" />
      </div>
    );
  }

  if (projector) {
    return <ReadOnlyText runs={runs} className="text-[23px] leading-[1.75]" emptyClass="text-tw-grey-light" />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 text-xs text-tw-grey">
        <span>
          Click anywhere in the box and type &mdash; it&rsquo;s shared, like a Word document. Press Enter for a new
          line; leave an empty line for a new paragraph.
        </span>
        <span className="flex items-center gap-2 whitespace-nowrap">
          {saveError ? (
            <span className="text-[#C1440E]">Not saved &mdash; check your connection</span>
          ) : (
            savedAt && (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8BB31D" strokeWidth="3">
                  <polyline points="4,13 9,18 20,6" />
                </svg>
                Saved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </>
            )
          )}
        </span>
      </div>
      <div ref={wrapRef} className="relative">
        <div
          ref={rootRef}
          role="textbox"
          aria-multiline="true"
          aria-label="Your group's text"
          className="cw-editor bg-white border border-tw-grey-light rounded-xl p-10 min-h-[400px] text-[17px] leading-[1.7] whitespace-pre-wrap break-words"
          contentEditable={loaded}
          suppressContentEditableWarning
          onInput={(e) => {
            // While an input method (accents, Asian languages) is composing, wait until it finishes.
            if (!(e.nativeEvent as InputEvent).isComposing) handleInput();
          }}
          onCompositionStart={() => {
            imeRef.current = true;
          }}
          onCompositionEnd={() => {
            imeRef.current = false;
            handleInput();
            const waiting = pendingSnapRef.current;
            if (waiting) {
              pendingSnapRef.current = null;
              applySnapRef.current(waiting);
            }
          }}
          onPaste={onPaste}
          onDrop={(e) => e.preventDefault()}
        />
        {!loaded && (
          <p className="absolute left-10 top-10 m-0 text-tw-grey italic">
            {loadError ? "The text could not be loaded. Please reload the page." : "Loading…"}
          </p>
        )}
        {selBtn && renderCommentBox && !composing && (
          <button
            type="button"
            className="absolute z-10 bg-tw-blue text-white text-sm font-bold rounded-lg px-3 py-1.5 shadow-lg border-0 cursor-pointer"
            style={{ top: selBtn.top, left: selBtn.left }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const s = selRef.current;
              if (!s) return;
              setComposing({ ...s, top: selBtn.top });
              setSelBtn(null);
            }}
          >
            Comment on this
          </button>
        )}
        {composing && renderCommentBox && (
          <div className="absolute z-20 left-6 right-6" style={{ top: composing.top }}>
            {renderCommentBox({ start: composing.start, end: composing.end, quote: composing.quote }, () =>
              setComposing(null)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
