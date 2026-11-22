/**
 * The notice shown to students on the join screen and to teachers on the
 * new-class and waiting-room screens. It is defined once here so every screen
 * says the same thing.
 *
 * A different deployment (for example a container hosted inside the university)
 * can reword it without changing any code by setting these environment
 * variables at build time:
 *   NEXT_PUBLIC_PRIVACY_NOTICE_TITLE
 *   NEXT_PUBLIC_PRIVACY_NOTICE_BODY
 */
import { isLocalBackend } from "./backend";

// Where the tool runs, as students are told: the Vercel/Firebase pilot or the university's own server.
const hostedBy = isLocalBackend
  ? "this tool runs on a server of FH Technikum Wien. "
  : "this tool runs on the internet (hosted by Vercel and Google Firebase). ";

export const privacyNotice = {
  title: process.env.NEXT_PUBLIC_PRIVACY_NOTICE_TITLE || "Before you join:",
  body:
    process.env.NEXT_PUBLIC_PRIVACY_NOTICE_BODY ||
    hostedBy +
      "Please use a nickname instead of your real name, and don't write personal details " +
      "such as your address, phone number or email in your text. " +
      "Your teacher will tell you how your nickname is matched to you for grading.",
};

/**
 * Address that gets a copy (CC) of the "Send email with link" message on the administrator page, so the
 * administrator can forward it if the teacher's mail system blocks it. Set NEXT_PUBLIC_ADMIN_COPY_EMAIL (for example
 * in the Vercel project settings) to the administrator's private address; without it no copy is added.
 */
export const adminCopyEmail = process.env.NEXT_PUBLIC_ADMIN_COPY_EMAIL ?? "";
