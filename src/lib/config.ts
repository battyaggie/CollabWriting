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
export const privacyNotice = {
  title: process.env.NEXT_PUBLIC_PRIVACY_NOTICE_TITLE || "Before you join:",
  body:
    process.env.NEXT_PUBLIC_PRIVACY_NOTICE_BODY ||
    "this tool runs on the internet (hosted by Vercel and Google Firebase). " +
      "Please use a nickname instead of your real name, and don't write personal details " +
      "such as your address, phone number or email in your text. " +
      "Your teacher will tell you how your nickname is matched to you for grading.",
};
