# Security Policy

## Production rules
- Keep `.env`, database migrations, server source, logs and storage outside the public web root.
- Run `npm run db:migrate` and `npm run admin:create` only from a trusted CLI/session.
- Put Nginx or another hardened reverse proxy in front of Node.js.
- Use HTTPS in production.
- Do not expose PostgreSQL publicly.
- Rotate secrets if the project archive was ever shared: `SESSION_SECRET`, `POSTGRES_PASSWORD`, and the Cloudinary API key and secret. Remove old keys from Cloudinary after creating replacements. Never copy old values into source, documentation, tickets, or logs.
- Keep dependencies updated and run security audits before deployment.

## Verification
After deployment, confirm that requests to `/database/`, `/server/`, `/.env`, `/package.json`, `/node_modules/`, and missing `/uploads/*` files return 404. Malformed JSON must return 400, oversized JSON 413, and unknown `/api/*` routes JSON 404. Confirm no-store on `/api/auth/*` and `/api/admin/*`, weak ETags on `/api/images`, HSTS and secure cookies over HTTPS, and that access logs contain neither `farm.sid` nor CSRF tokens.
