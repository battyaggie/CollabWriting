/**
 * True in the container build (BACKEND=local, see next.config.mjs): teachers there do not create
 * their own accounts but ask an administrator for access. The Vercel version uses Firebase sign-in.
 */
export const isLocalBackend = process.env.NEXT_PUBLIC_BACKEND === "local";
