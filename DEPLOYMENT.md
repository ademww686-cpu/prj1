# Production deployment

Use this order for a new production server. Replace the documented `example.com` placeholder with the apex domain you own. Never commit `.env`; the checked-in `.env.example` contains placeholders only.

## Ordered deployment steps

1. **Environment.** Install Node.js 22+, PostgreSQL 17 (or Docker Compose), Docker Compose, Nginx, Certbot, and OpenSSL. Copy `.env.example` to `.env`. Set a unique `SESSION_SECRET`, URL-safe `POSTGRES_PASSWORD`, Cloudinary cloud name/API key/API secret, `CORS_ORIGIN` as one or more comma-separated public HTTPS origins without paths or trailing slashes, and `VITE_SITE_URL` to the apex HTTPS origin. Production requires `NODE_ENV=production`, `TRUST_PROXY=1` behind the configured one-hop Nginx proxy, and Cloudinary credentials. Set `POSTGRES_DB` and `POSTGRES_USER` if desired; keep the Compose password URL-safe because it is interpolated into `DATABASE_URL`.

   Generate values with:

   ```bash
   openssl rand -base64 64  # SESSION_SECRET
   openssl rand -hex 32     # POSTGRES_PASSWORD (URL-safe hexadecimal)
   ```

2. **Build.** Verify `VITE_SITE_URL` is the public `https://` origin, then build the image:

   ```bash
   docker compose build
   ```

   A production Docker build rejects missing or non-HTTPS `VITE_SITE_URL`. Local-only HTTP builds may explicitly pass `--build-arg ALLOW_INSECURE_SITE_URL_BUILD=true`; never use that opt-out for deployment.

3. **Database backup.** Start PostgreSQL, then save a backup before migrations:

   ```bash
   docker compose up -d postgres
   docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > farm_tourism-before-migration.sql
   ```

4. **Migrate.** Apply pending migrations before starting the web service:

   ```bash
   docker compose run --rm --entrypoint node app server/src/cli/migrate.js
   ```

   The app entrypoint also runs migrations on startup; that is idempotent after this explicit backup-and-migrate step.

5. **Create the administrator.** Use the CLI interactively after migrations:

   ```bash
   docker compose run --rm --entrypoint node app server/src/cli/create-admin.js
   ```

6. **DNS.** Point the apex A/AAAA records to the server. If using the optional `www` alias, point it to the same server and request a certificate that covers both names.

7. **Bootstrap Nginx.** Replace `example.com` in `nginx/nginx.bootstrap.conf` with the apex hostname, install it as the active site, create `/var/www/certbot`, and reload Nginx. This temporary HTTP-only configuration serves the ACME challenge.

8. **Certbot.** Request the certificate using the webroot challenge:

   ```bash
   certbot certonly --webroot -w /var/www/certbot -d example.com
   ```

   Add `-d www.example.com` only when the DNS alias exists and the optional redirect block is configured for that name.

9. **Full Nginx.** Replace `example.com` in `nginx/nginx.conf`, enable the full config, and run `nginx -t` before reloading. It keeps `listen 443 ssl http2;` for compatibility with older Nginx; Nginx 1.25.1+ reports that the separate `http2` parameter is deprecated. Node/Helmet owns security headers, so the proxy does not repeat them. The optional www redirect block is commented until enabled.

   If the site is proxied through Cloudflare, uncomment the `set_real_ip_from` CIDRs and `real_ip_header CF-Connecting-IP` only after refreshing ranges from [Cloudflare's IP API](https://api.cloudflare.com/client/v4/ips). Without real client IP restoration, visitors share one proxy IP and the booking limit (5 per hour) and login limit (8 attempts) apply to everyone together. Restrict origin access to Cloudflare ranges when enabling this mode.

10. **Smoke test.** Start the app and verify its health and production behavior:

    ```bash
    docker compose up -d app
    curl --fail https://example.com/api/health
    ```

    For an isolated test deployment, run the suite with `TEST_BASE_URL=https://example.com TEST_PRODUCTION=1 npm test` and `CORS_ORIGIN` matching the configured public origin. Do not run destructive or cleanup tests against real customer data.

11. **Upload images.** Visit `https://example.com/admin` and re-upload images using Site Images. The 19 legacy files in `storage/uploads` are deliberately preserved in the project but omitted from the container build; production reads image records from Cloudinary. Alternatively, preview a one-time migration with `node scripts/migrate-local-images-to-cloudinary.mjs` (dry-run by default), then explicitly upload and update records with `node scripts/migrate-local-images-to-cloudinary.mjs --apply` after setting database and Cloudinary environment variables. It never runs automatically and does not delete local files.

## Migration and runtime notes

## Cloudflare Turnstile

Set `VITE_TURNSTILE_SITE_KEY` before the frontend image build and `TURNSTILE_SECRET_KEY` in the runtime environment. Configure both keys or leave both unset.

## Direct Node deployment (without Docker)

Install Node.js 22+ and PostgreSQL, configure the production environment, then run these commands from the project directory. Set `NODE_ENV=production`, `VITE_SITE_URL=https://example.com`, and `CORS_ORIGIN=https://example.com` (or the exact comma-separated public origins) in the environment. Set `TRUST_PROXY=1` only when the app is behind exactly one trusted Nginx hop.

```bash
npm ci
VITE_SITE_URL=https://example.com npm run build
pg_dump "$DATABASE_URL" > farm_tourism-before-migration.sql
npm run db:migrate
npm run admin:create
npm start
```

`GET /api/health` returns `{"ok":true}`. PostgreSQL and the app port are not publicly exposed; bind them to loopback/private networking and expose traffic through Nginx.

Migration `002_production_hardening.sql` now drops the old booking status check before converting legacy `cancelled` rows to `rejected`, then installs the new check. Previously applied migrations are skipped by `schema_migrations`; migration 004 scopes booking capacity by type, and migration 005 creates `user_sessions` before the first session is stored.

`VITE_SITE_URL` is embedded in the canonical URL, Open Graph URL/image, sitemap, and robots file at build time. Build again after changing it. Production CORS accepts a comma-separated allowlist only when every entry is a public HTTPS origin with no path or trailing slash; localhost and loopback are refused.

The original local upload files are retained. Re-upload through `/admin` or explicitly use the dry-run migration utility; do not delete local files until the Cloudinary records and site have been checked. Unused source images retained in the project are `client/images/garden.jpg`, `client/images/pool.jpg`, and `client/images/sports.jpg`.

Schedule regular PostgreSQL backups and test restores. Keep `.env`, `node_modules/`, and `client/dist/` out of release archives. Run `npm audit --omit=dev` and review dependency updates separately.
