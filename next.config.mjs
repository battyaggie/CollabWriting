import path from "node:path";

// Two builds from one code base:
//   default            -> uses Firebase (the Vercel version)
//   BACKEND=local      -> uses the container's own server: "firebase/*" is replaced by the stand-in
//                         in src/backend/local, so no screen needs to change.
const useLocalBackend = process.env.BACKEND === "local";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BACKEND: useLocalBackend ? "local" : "firebase" },
  webpack(config) {
    if (useLocalBackend) {
      const local = (file) => path.resolve(process.cwd(), "src/backend/local", file);
      config.resolve.alias = {
        ...config.resolve.alias,
        "firebase/firestore": local("firestore.ts"),
        "firebase/auth": local("auth.ts"),
        "firebase/app": local("app.ts"),
      };
    }
    return config;
  },
};

export default nextConfig;
