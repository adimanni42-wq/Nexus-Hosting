# NEXUS Hosting — Cloudflare starter

This is a working account + dashboard foundation for Cloudflare Workers and D1.

## Included
- Customer registration and sign-in
- Secure, server-side sessions (HttpOnly cookie; password hashing with PBKDF2)
- Customer server records (each customer sees only their own)
- Owner role set only when the signup email matches the server-side `OWNER_EMAIL` setting
- Owner view of all server records, customer list, suspend action, and audit log
- Mobile-first dashboard
- Honest disabled state until a real Minecraft node is connected

## Not included yet
This does **not** run Minecraft servers. Cloudflare Workers cannot host Minecraft Java/Bedrock game processes. Start/stop, console, files, plugins, backups, live player counts, RAM usage, and node management require a separate real hosting machine and a secured node agent/API. Those controls are intentionally disabled rather than simulated.

## Deploy from Cloudflare Dashboard
1. Create a **D1 database** named `nexus-hosting-db`.
2. Open the database's **Console** and run the complete contents of `schema.sql`.
3. Create a **Worker** named `nexus-hosting`.
4. Upload/deploy this project using Wrangler (recommended) or connect a GitHub repository. The project needs the `src/index.js` entry point and `public/` assets folder.
5. In `wrangler.toml`, replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the D1 database ID shown by Cloudflare.
6. Set `OWNER_EMAIL` in Worker Settings → Variables to the email address you will use for the owner account. This is not a password.
7. Deploy the Worker.
8. Open the website, choose **Create account**, and register using that exact owner email. The server assigns the owner role; the browser cannot choose it.
9. Sign out and test a second account. It should only see its own server records.

## Important
- Do not publish node API keys, passwords, or server credentials in frontend files or GitHub.
- Do not create a public node endpoint without authentication, authorization, input validation, rate limits, and audit logging.
- Keep backups of your D1 database.
- Before public launch, add email verification, password reset, login rate limiting, abuse protection, and security review.
- Do not add payment collection until the service's legal, safety, and billing requirements are understood.
