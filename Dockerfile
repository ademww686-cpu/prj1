FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_SITE_URL
ARG ALLOW_INSECURE_SITE_URL_BUILD=false
ARG VITE_TURNSTILE_SITE_KEY=
ENV VITE_SITE_URL=$VITE_SITE_URL VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY ALLOW_INSECURE_SITE_URL_BUILD=$ALLOW_INSECURE_SITE_URL_BUILD
COPY package*.json ./
RUN npm ci
COPY . .
RUN if [ "$ALLOW_INSECURE_SITE_URL_BUILD" != "true" ]; then \
      case "$VITE_SITE_URL" in https://* ) ;; *) echo "VITE_SITE_URL must be an https:// origin for production builds." >&2; exit 1 ;; esac; \
    fi
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/database ./database
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/.env.example ./.env.example
RUN mkdir -p /app/storage/uploads && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["sh","-c","node server/src/cli/migrate.js && node server/src/app.js"]
