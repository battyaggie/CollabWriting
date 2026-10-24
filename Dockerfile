# Collaborative Writing App, container version: web pages + database + live updates in one image.
# Build:  docker build -t collab-writing .
# Run:    docker run -p 3000:3000 -v collab-data:/data -e ADMIN_EMAIL=you@fh-technikum.at collab-writing
# (settings and the full list of environment variables: server/README.md)

# ---- build stage: needs the internet (npm); the finished image does not ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
# Text shown to students before they join (optional; fixed at build time, see src/lib/config.ts)
ARG NEXT_PUBLIC_PRIVACY_NOTICE_TITLE
ARG NEXT_PUBLIC_PRIVACY_NOTICE_BODY
ENV NEXT_TELEMETRY_DISABLED=1
RUN BACKEND=local npx next build && npm prune --omit=dev

# ---- run stage ----
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/server ./server
COPY --from=build /app/package.json /app/next.config.mjs ./
# The database lives in /data. Back this folder up; it is the only thing that must survive an update.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
