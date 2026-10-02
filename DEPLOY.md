# Deploy the Farm Tourism Website

This project builds the Vite site into the Express image. Express serves the site, admin dashboard, and API from one HTTPS origin, while PostgreSQL stores bookings, admin accounts, and sessions. Production startup runs database migrations before starting Express.

## Before deploying

1. Push the project to a GitHub repository. Do not commit `.env`, `.env.production`, database dumps, or Cloudinary secrets. `.env.production` is ignored by Git and Docker on purpose.
2. Choose the platform subdomain before the first successful image build. `VITE_SITE_URL` is embedded into the static build, so it must be the final origin, for example `https://farm-tourism-prod.up.railway.app`, with no trailing slash. Set `CORS_ORIGIN` to that exact same origin. Rebuild after changing the domain.
3. Set production secrets in the platform dashboard, not in source control. The local `.env.production` file contains generated session and Compose database secrets, but its Railway-style domain is an example and its database URL points at the local Compose service. Do not paste the file unchanged into a hosted service.
4. Production requires Cloudinary. Create an account and set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. The server intentionally refuses to start in production without all three.

## Railway (recommended)

Railway builds this repository with its Dockerfile and provides a private PostgreSQL service. Follow the [Railway Express guide](https://docs.railway.com/guides/express), [PostgreSQL guide](https://docs.railway.com/databases/postgresql), and [Docker Compose deployment guide](https://docs.railway.com/guides/docker-compose) for current dashboard labels.

1. Create a Railway project and deploy the GitHub repository as an app service. It detects the root `Dockerfile` automatically.
2. Add a PostgreSQL service to the project. Keep it private. In the app service's Variables tab, set `DATABASE_URL` to a Railway reference to that database's `DATABASE_URL`, for example `${{Postgres.DATABASE_URL}}` (use the actual database service name).
3. In the app service's Settings → Networking, generate a public domain. Copy the exact `https://…up.railway.app` origin.
4. Add the variables below to the app service **before** its first successful build. Railway makes service variables available at build time, and the Dockerfile consumes `VITE_SITE_URL` as a build argument.

   ```text
   NODE_ENV=production
   PORT=3000
   TRUST_PROXY=1
   VITE_SITE_URL=https://<generated-name>.up.railway.app
   CORS_ORIGIN=https://<generated-name>.up.railway.app
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   SESSION_SECRET=<copy the generated value from your private .env.production, or generate a new 64-byte secret>
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<set the fixed admin password you chose>
   CLOUDINARY_CLOUD_NAME=<Cloudinary cloud name>
   CLOUDINARY_API_KEY=<Cloudinary API key>
   CLOUDINARY_API_SECRET=<Cloudinary API secret>
   CLOUDINARY_FOLDER=model-farm/site-images
   ```

   `POSTGRES_PASSWORD` in `.env.production` is for local Docker Compose only. Railway creates and manages its own database credentials; do not set the Compose `DATABASE_URL` on Railway. Leave `DATABASE_SSL` unset unless the selected database connection instructions require it.

5. Deploy. The image runs `node server/src/cli/migrate.js` before starting the app. The app creates or resets the `admin` account to `ADMIN_PASSWORD` on each startup when both `ADMIN_USERNAME` and `ADMIN_PASSWORD` are set. If the first deployment already completed without those variables, add them and redeploy.
6. Wait for deployment health, then open `https://<generated-name>.up.railway.app/` and `/admin`. `GET /api/health` should return `{"ok":true}`.

Railway can deploy a Compose project, but for this app the simpler hosted setup is an app service from the Dockerfile plus Railway's managed PostgreSQL. Railway services and usage may incur charges; a free subdomain does not mean the compute or database is free.

## Render (alternative)

Use a Docker-based [Render Web Service](https://render.com/docs/docker) connected to the repository, plus a Render PostgreSQL database. Render assigns a stable `https://<service-name>.onrender.com` origin based on the service name. Set that exact value for both `VITE_SITE_URL` and `CORS_ORIGIN` before the first image build. Set `PORT=10000` (Render's default web service port), `NODE_ENV=production`, `TRUST_PROXY=1`, `DATABASE_URL` to the database's internal connection URL, `SESSION_SECRET`, the two admin variables, and the three Cloudinary variables listed above. Render passes service environment variables as Docker build arguments, so `VITE_SITE_URL` reaches the build.

Set the service health check path to `/api/health`. Render's free web services spin down after inactivity, and its free Postgres databases expire after 30 days; treat the free database as temporary/testing storage and arrange backups or a paid database before keeping real booking data. See [Render's free instance limits](https://render.com/docs/free).

## Fly.io (alternative)

Install `flyctl`, sign in, then from the repository root run:

```sh
fly launch --dockerfile Dockerfile --no-deploy
```

Choose an app name and region. The app origin will be `https://<app-name>.fly.dev`. Check the generated `fly.toml` and make sure its HTTP service listens on internal port `3000` with HTTPS enabled. Since `VITE_SITE_URL` is public metadata, set it as a Docker build argument in `fly.toml` (it is compiled into the frontend):

```toml
[build.args]
  VITE_SITE_URL = "https://<app-name>.fly.dev"
```

Create a PostgreSQL service (for example, using Fly Managed Postgres) in the same region. Before deploying, set the app's runtime secrets:

```sh
fly secrets set NODE_ENV=production TRUST_PROXY=1 PORT=3000 \
  CORS_ORIGIN=https://<app-name>.fly.dev \
  SESSION_SECRET=<generated-secret> \
  ADMIN_USERNAME=admin ADMIN_PASSWORD=<fixed-admin-password> \
  CLOUDINARY_CLOUD_NAME=<cloud-name> CLOUDINARY_API_KEY=<api-key> \
  CLOUDINARY_API_SECRET=<api-secret> CLOUDINARY_FOLDER=model-farm/site-images
```

Attach the database so Fly sets `DATABASE_URL` for the app; for Managed Postgres, see [Fly's app and Postgres guide](https://fly.io/web-app-with-postgres/). Attaching triggers a deploy. If you need to redeploy after updating settings, run:

```sh
fly deploy
fly apps open
```

Fly's `fly.dev` hostname has HTTPS. Confirm the generated `fly.toml` internal port matches `PORT`. Check Fly's current database and compute pricing before creating resources; the hostname itself does not guarantee free hosting.

## Environment variable reference

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Must be `production` on the hosted app. |
| `PORT` | Port Express listens on; use the platform's expected port. |
| `TRUST_PROXY` | Set to `1` behind the platform's single trusted proxy so secure session cookies work. |
| `VITE_SITE_URL` | Public HTTPS origin; baked into the static build. Rebuild after changing it. |
| `CORS_ORIGIN` | Exact public origin allowed by the API; no path or trailing slash. |
| `DATABASE_URL` | Private PostgreSQL connection URL. Use a platform reference/private URL, not a public database endpoint. |
| `SESSION_SECRET` | At least 32 characters; use the generated 64-byte value from `.env.production` or generate a new one. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | When both are set, the app creates or resets that active admin account every startup. Keep `ADMIN_PASSWORD` private. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Required in production for persistent image storage. |
| `CLOUDINARY_FOLDER` | Optional Cloudinary folder; defaults to `model-farm/site-images`. |
| `VITE_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional bot protection; configure both together if enabling Turnstile. |

Generate replacement secrets locally without printing them into a shell transcript or committing them:

```sh
node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))"  # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"       # URL-safe POSTGRES_PASSWORD for Compose
```

The Compose database password is not used with a platform-managed database. Keep PostgreSQL private. For local production Compose only, set `APP_ENV_FILE=.env.production` (already present in that file) and run `docker compose --env-file .env.production up --build -d` after replacing the example domain and filling Cloudinary credentials. Local development remains on `.env` by default.

## Admin account after first deploy

Set `ADMIN_USERNAME=admin` and `ADMIN_PASSWORD` in the platform's app-service secrets, then redeploy/restart the app. Startup applies migrations first and then writes the active admin account using a bcrypt password hash. The configured password is restored at every startup, so changing it in the database alone will not persist; update the platform secret when you intentionally rotate it.

If you prefer the interactive CLI, run `node server/src/cli/create-admin.js` from a shell in the deployed app container. On Railway, `railway ssh -- node server/src/cli/create-admin.js` runs a command inside the service; the CLI prompts for credentials and requires a TTY for hidden password entry, so use `railway ssh` for an interactive shell and then run the command. Do not put admin credentials in public build arguments.

## Cloudinary and uploaded images

Production requires Cloudinary because hosted containers can be redeployed or replaced. Create a Cloudinary account, copy the cloud name, API key, and API secret into the app's **runtime secrets**, and redeploy. Never put Cloudinary secrets in `VITE_*` variables or Docker build arguments. After login, upload/replace the site's images from the Admin dashboard's Site Images section. If you have local uploads to preserve, use the project's `scripts/migrate-local-images-to-cloudinary.mjs` with a backup first; it supports a dry run before `--apply`.

## Add a custom domain later

1. Add the purchased domain in the platform dashboard and apply the DNS records it provides. Wait for domain verification and its TLS certificate to become active.
2. Set `VITE_SITE_URL=https://your-domain.example` and `CORS_ORIGIN=https://your-domain.example`. On Fly.io, update the `VITE_SITE_URL` value under `[build.args]` in `fly.toml`; on Railway/Render, update the matching build environment variable. If you want both the platform domain and custom domain to work, set `CORS_ORIGIN` to a comma-separated list of the two exact HTTPS origins.
3. Rebuild and redeploy. `VITE_SITE_URL` is compiled into canonical URLs, metadata, sitemap, and robots rules. Confirm the custom domain serves HTTPS and `/api/health` returns `{"ok":true}`.

## Pre-deploy checklist

- [ ] The repository is pushed to GitHub without `.env`, `.env.production`, secrets, or database dumps.
- [ ] The platform's managed PostgreSQL is provisioned and its private `DATABASE_URL` is connected to the app.
- [ ] `VITE_SITE_URL` and `CORS_ORIGIN` exactly match the final HTTPS subdomain before building.
- [ ] `SESSION_SECRET` is strong, `NODE_ENV=production`, and `TRUST_PROXY=1`.
- [ ] Cloudinary runtime credentials are set; uploaded images will not depend on an ephemeral container filesystem.
- [ ] Admin credentials are configured as runtime secrets so startup creates the account.
- [ ] The platform routes to the port configured in `PORT` and uses `/api/health` for health checks where supported.
- [ ] Run `npm run check` and `npm test` locally before release; then confirm the deployed `/api/health`, home page, and `/admin`.
- [ ] Understand the selected platform's current compute/database price, sleep behavior, storage persistence, and backup/retention limits.
