/**
 * Teacher accounts in the container build: asking for access, choosing a password from a link, and
 * the administrator's tools (approve, import a list, reset, switch off). Only used when the app is
 * built with BACKEND=local (see src/lib/backend.ts); the Vercel version uses Firebase sign-in instead.
 */
import { connection, type UserInfo } from "./connection";

export interface AccessRequest {
  id: string;
  email: string;
  name: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  decidedAt: number | null;
}

export interface AccountInfo {
  uid: string;
  email: string;
  name: string;
  isAdmin: boolean;
  disabled: boolean;
  hasPassword: boolean;
  createdAt: number;
}

/** A one-time link that lets a lecturer choose a password. */
export interface SetupLink {
  email: string;
  name: string;
  token: string;
  expiresAt: number;
}

export interface ImportRow {
  name: string;
  email: string;
  status: "created" | "link-renewed" | "exists" | "duplicate" | "invalid";
  token?: string;
  expiresAt?: number;
}

export async function requestAccess(email: string, name: string): Promise<void> {
  await connection.request({ t: "access-request", email, name });
}

/** Uses a link from an administrator: sets the password and signs the lecturer in. */
export async function completePasswordSetup(token: string, password: string): Promise<UserInfo> {
  const r = await connection.request({ t: "set-password", token, password });
  connection.adopt(r.user as UserInfo, r.token as string);
  return r.user as UserInfo;
}

export async function adminOverview(): Promise<{ requests: AccessRequest[]; users: AccountInfo[] }> {
  const r = await connection.request({ t: "admin-overview" });
  return { requests: r.requests as AccessRequest[], users: r.users as AccountInfo[] };
}

export async function adminApprove(id: string): Promise<SetupLink> {
  return (await connection.request({ t: "admin-approve", id })) as unknown as SetupLink;
}

export async function adminReject(id: string): Promise<void> {
  await connection.request({ t: "admin-reject", id });
}

export async function adminReset(uid: string): Promise<SetupLink> {
  return (await connection.request({ t: "admin-reset", uid })) as unknown as SetupLink;
}

export async function adminDisable(uid: string, disabled: boolean): Promise<void> {
  await connection.request({ t: "admin-disable", uid, disabled });
}

export async function adminImport(people: { name: string; email: string }[]): Promise<ImportRow[]> {
  const r = await connection.request({ t: "admin-import", people });
  return r.rows as ImportRow[];
}

/** The full address of a setup link, for sending to the lecturer. */
export function setupUrl(token: string): string {
  return `${window.location.origin}/teacher/set-password?token=${encodeURIComponent(token)}`;
}

/** A ready-to-send email (opens the administrator's own mail program) containing the setup link. */
export function mailtoFor(link: { email: string; name: string; token: string; expiresAt: number }): string {
  const greeting = link.name ? `Hello ${link.name},` : "Hello,";
  const until = new Date(link.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const body =
    `${greeting}\n\nYou now have access to the Collaborative Writing App. ` +
    `Please choose your password here (the link works once and is valid until ${until}):\n\n${setupUrl(link.token)}\n\n` +
    `After that you can sign in at ${window.location.origin}/teacher/login with this email address.\n`;
  return `mailto:${encodeURIComponent(link.email)}?subject=${encodeURIComponent("Your access to the Collaborative Writing App")}&body=${encodeURIComponent(body)}`;
}
