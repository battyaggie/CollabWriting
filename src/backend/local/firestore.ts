/**
 * Stand-in for "firebase/firestore" in the container build: the same function names and behaviour
 * for the parts of Firestore this app uses (documents, collections, where/orderBy queries, live
 * listeners, batches and transactions), talking to the container's own server.
 */
import { connection, LocalBackendError, type WireDoc } from "./connection";

export type DocumentData = { [field: string]: any };

export interface Firestore {
  readonly type: "firestore";
}

const theDb: Firestore = { type: "firestore" };

export function getFirestore(_app?: unknown): Firestore {
  return theDb;
}

/* ---------- references ---------- */

export class CollectionReference {
  readonly type = "collection";
  constructor(readonly path: string) {}
  get id(): string {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }
  get parent(): DocumentReference | null {
    const i = this.path.lastIndexOf("/");
    return i < 0 ? null : new DocumentReference(this.path.slice(0, i));
  }
}

export class DocumentReference {
  readonly type = "document";
  constructor(readonly path: string) {}
  get id(): string {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }
  get parent(): CollectionReference {
    return new CollectionReference(this.path.slice(0, this.path.lastIndexOf("/")));
  }
}

export interface QueryConstraint {
  readonly kind: "where" | "orderBy";
  readonly field: string;
  readonly op?: string;
  readonly value?: unknown;
  readonly dir?: "asc" | "desc";
}

export class Query {
  readonly type = "query";
  constructor(
    readonly path: string,
    readonly constraints: QueryConstraint[]
  ) {}
}

type Base = Firestore | CollectionReference | DocumentReference;

function segments(parts: string[]): string[] {
  return parts.flatMap((p) => p.split("/")).filter((p) => p !== "");
}

function autoId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function collection(base: Base, ...path: string[]): CollectionReference {
  const parts = segments(path);
  const full = "path" in base ? [...base.path.split("/"), ...parts] : parts;
  if (full.length === 0 || full.length % 2 === 0) throw new Error(`Invalid collection path: ${full.join("/")}`);
  return new CollectionReference(full.join("/"));
}

export function doc(base: Base, ...path: string[]): DocumentReference {
  const parts = segments(path);
  let full: string[];
  if (base instanceof CollectionReference) {
    full = [...base.path.split("/"), parts[0] ?? autoId(), ...parts.slice(1)];
  } else if ("path" in base) {
    full = [...base.path.split("/"), ...parts];
  } else {
    full = parts;
  }
  if (full.length === 0 || full.length % 2 !== 0) throw new Error(`Invalid document path: ${full.join("/")}`);
  return new DocumentReference(full.join("/"));
}

export function where(field: string, op: string, value: unknown): QueryConstraint {
  return { kind: "where", field, op, value };
}

export function orderBy(field: string, dir: "asc" | "desc" = "asc"): QueryConstraint {
  return { kind: "orderBy", field, dir };
}

export function query(base: CollectionReference | Query, ...constraints: QueryConstraint[]): Query {
  return new Query(base.path, [...(base instanceof Query ? base.constraints : []), ...constraints]);
}

function spec(q: CollectionReference | Query) {
  const constraints = q instanceof Query ? q.constraints : [];
  return {
    where: constraints.filter((c) => c.kind === "where").map((c) => ({ field: c.field, op: c.op, value: c.value })),
    order: constraints.filter((c) => c.kind === "orderBy").map((c) => ({ field: c.field, dir: c.dir })),
  };
}

/* ---------- snapshots ---------- */

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export interface SnapshotMetadata {
  readonly hasPendingWrites: boolean;
  readonly fromCache: boolean;
}

const metadata: SnapshotMetadata = { hasPendingWrites: false, fromCache: false };

export class DocumentSnapshot {
  readonly metadata = metadata;
  constructor(
    readonly ref: DocumentReference,
    private readonly raw: WireDoc | null
  ) {}
  get id(): string {
    return this.ref.id;
  }
  exists(): boolean {
    return this.raw !== null;
  }
  data(): DocumentData | undefined {
    return this.raw ? clone(this.raw.data) : undefined;
  }
  /** Version used by transactions to notice that someone else changed the document. */
  get version(): number {
    return this.raw ? this.raw.version : 0;
  }
}

export class QueryDocumentSnapshot extends DocumentSnapshot {
  data(): DocumentData {
    return super.data() as DocumentData;
  }
}

export class QuerySnapshot {
  readonly metadata = metadata;
  readonly docs: QueryDocumentSnapshot[];
  constructor(docs: WireDoc[]) {
    this.docs = docs.map((d) => new QueryDocumentSnapshot(new DocumentReference(d.path), d));
  }
  get size(): number {
    return this.docs.length;
  }
  get empty(): boolean {
    return this.docs.length === 0;
  }
  forEach(cb: (d: QueryDocumentSnapshot) => void): void {
    this.docs.forEach(cb);
  }
}

/* ---------- reading ---------- */

export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  const r = await connection.request({ t: "get", kind: "doc", path: ref.path });
  return new DocumentSnapshot(ref, (r.doc as WireDoc | null) ?? null);
}

export async function getDocs(q: CollectionReference | Query): Promise<QuerySnapshot> {
  const r = await connection.request({ t: "get", kind: "query", path: q.path, ...spec(q) });
  return new QuerySnapshot((r.docs as WireDoc[]) ?? []);
}

export function onSnapshot(
  ref: DocumentReference,
  next: (snap: DocumentSnapshot) => void,
  error?: (err: Error) => void
): () => void;
export function onSnapshot(
  ref: CollectionReference | Query,
  next: (snap: QuerySnapshot) => void,
  error?: (err: Error) => void
): () => void;
export function onSnapshot(
  ref: DocumentReference | CollectionReference | Query,
  next: (snap: never) => void,
  error?: (err: Error) => void
): () => void {
  const fail = (code: string, message: string) => {
    if (error) error(new LocalBackendError(code, message));
    else console.error(code, message);
  };
  const deliver = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  };
  if (ref instanceof DocumentReference) {
    return connection.subscribe(
      { kind: "doc", path: ref.path },
      (s) => deliver(() => (next as (s: DocumentSnapshot) => void)(new DocumentSnapshot(ref, s.doc ?? null))),
      fail
    );
  }
  return connection.subscribe(
    { kind: "query", path: ref.path, ...spec(ref) },
    (s) => deliver(() => (next as (s: QuerySnapshot) => void)(new QuerySnapshot(s.docs ?? []))),
    fail
  );
}

/* ---------- writing ---------- */

interface Write {
  op: "set" | "update" | "delete";
  path: string;
  data?: DocumentData;
  merge?: boolean;
}

function commitWrites(writes: Write[], reads: Record<string, number> = {}): Promise<unknown> {
  return connection.request({ t: "commit", writes, reads });
}

export interface SetOptions {
  merge?: boolean;
}

export async function setDoc(ref: DocumentReference, data: DocumentData, options?: SetOptions): Promise<void> {
  await commitWrites([{ op: "set", path: ref.path, data: clone(data), merge: !!options?.merge }]);
}

export async function updateDoc(ref: DocumentReference, data: DocumentData): Promise<void> {
  await commitWrites([{ op: "update", path: ref.path, data: clone(data) }]);
}

export async function deleteDoc(ref: DocumentReference): Promise<void> {
  await commitWrites([{ op: "delete", path: ref.path }]);
}

export async function addDoc(col: CollectionReference, data: DocumentData): Promise<DocumentReference> {
  const ref = doc(col);
  await setDoc(ref, data);
  return ref;
}

export class WriteBatch {
  private writes: Write[] = [];
  set(ref: DocumentReference, data: DocumentData, options?: SetOptions): WriteBatch {
    this.writes.push({ op: "set", path: ref.path, data: clone(data), merge: !!options?.merge });
    return this;
  }
  update(ref: DocumentReference, data: DocumentData): WriteBatch {
    this.writes.push({ op: "update", path: ref.path, data: clone(data) });
    return this;
  }
  delete(ref: DocumentReference): WriteBatch {
    this.writes.push({ op: "delete", path: ref.path });
    return this;
  }
  async commit(): Promise<void> {
    await commitWrites(this.writes);
  }
}

export function writeBatch(_db?: Firestore): WriteBatch {
  return new WriteBatch();
}

export class Transaction {
  readonly reads: Record<string, number> = {};
  readonly writes: Write[] = [];
  async get(ref: DocumentReference): Promise<DocumentSnapshot> {
    const snap = await getDoc(ref);
    this.reads[ref.path] = snap.version;
    return snap;
  }
  set(ref: DocumentReference, data: DocumentData, options?: SetOptions): Transaction {
    this.writes.push({ op: "set", path: ref.path, data: clone(data), merge: !!options?.merge });
    return this;
  }
  update(ref: DocumentReference, data: DocumentData): Transaction {
    this.writes.push({ op: "update", path: ref.path, data: clone(data) });
    return this;
  }
  delete(ref: DocumentReference): Transaction {
    this.writes.push({ op: "delete", path: ref.path });
    return this;
  }
}

/**
 * Runs `fn`, then writes its changes only if every document it read is still unchanged; if
 * someone else got in first, `fn` is simply run again (up to 5 times), exactly as in Firestore.
 */
export async function runTransaction<T>(_db: Firestore, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const tx = new Transaction();
    const result = await fn(tx);
    try {
      await commitWrites(tx.writes, tx.reads);
      return result;
    } catch (err) {
      if ((err as { code?: string }).code === "aborted" && attempt < 5) continue;
      throw err;
    }
  }
}
