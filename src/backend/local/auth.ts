/**
 * Stand-in for "firebase/auth" in the container build. Students get an anonymous identity from the
 * server (kept in the browser, so a reload is still the same student); teacher accounts with
 * e-mail and password arrive in the next stage.
 */
import { connection, type UserInfo } from "./connection";

export type User = UserInfo;

export interface Auth {
  readonly currentUser: User | null;
}

const theAuth: Auth = {
  get currentUser() {
    return connection.user;
  },
};

export function getAuth(_app?: unknown): Auth {
  connection.ensure();
  return theAuth;
}

export function onAuthStateChanged(
  _auth: Auth,
  next: (user: User | null) => void,
  _error?: (err: Error) => void
): () => void {
  return connection.onAuth(next);
}

export async function signInAnonymously(_auth: Auth): Promise<{ user: User }> {
  const r = await connection.request({ t: "anon" });
  connection.adopt(r.user as User, r.token as string);
  return { user: r.user as User };
}

export async function signOut(_auth: Auth): Promise<void> {
  await connection.request({ t: "signout" });
  connection.forgetUser();
}

export async function createUserWithEmailAndPassword(
  _auth: Auth,
  email: string,
  password: string
): Promise<{ user: User }> {
  const r = await connection.request({ t: "signup", email, password });
  connection.adopt(r.user as User, r.token as string);
  return { user: r.user as User };
}

export async function signInWithEmailAndPassword(
  _auth: Auth,
  email: string,
  password: string
): Promise<{ user: User }> {
  const r = await connection.request({ t: "login", email, password });
  connection.adopt(r.user as User, r.token as string);
  return { user: r.user as User };
}
