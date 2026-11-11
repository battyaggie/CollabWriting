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

/** Not used in the container version (the Vercel version signs students back in with a custom token). */
export async function signInWithCustomToken(_auth: Auth, _token: string): Promise<{ user: User }> {
  throw new Error("Custom-token sign-in is not available in the container version.");
}

/**
 * Container version of "nickname + PIN gets you your identity back" (see server/pin.mjs). The server checks the
 * PIN and answers with the student's original identity, which this browser then adopts.
 */
export async function signInWithPin(
  scope: string,
  nickname: string,
  pin: string
): Promise<{ user: User; registered: boolean }> {
  const r = await connection.request({ t: "pin-claim", scope, nickname, pin });
  connection.adopt(r.user as User, r.token as string);
  return { user: r.user as User, registered: !!r.registered };
}

/** A teacher forgets all nicknames and PINs of a class (just before the class is deleted). */
export async function releasePins(scope: string): Promise<void> {
  await connection.request({ t: "pin-release", scope });
}
