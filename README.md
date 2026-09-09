# Question Bank — API Server

Express + Supabase backend for the Question Bank admin panel. Served on Render,
consumed by the Question Bank frontend (Vite React SPA, deployed on Vercel).

## Stack

| Layer      | Technology                    |
|------------|-------------------------------|
| Runtime    | Node 22, plain ESM JavaScript |
| Framework  | Express 5                     |
| Database   | Supabase (Postgres)           |
| Auth       | JWT (Bearer) + bcryptjs       |
| Email      | Nodemailer (SMTP / Mailtrap)  |

## Getting Started

```bash
npm install
cp .env.example .env   # then fill in your values (or reuse your existing .env)
npm run seed           # roles, permissions, super-admin
npm run seed:master    # standards/subjects/chapters/topics
npm run dev            # http://localhost:4000
```

Health check: `GET http://localhost:4000/api/health`

## Environment Variables

All config is read from `process.env` first, falling back to `.env`. Set these in
the Render dashboard (never commit them):

| Variable                | Notes                                            |
|-------------------------|--------------------------------------------------|
| `PORT`                  | Render injects this; defaults to 4000 locally    |
| `JWT_SECRET`            | strong secret                                    |
| `JWT_EXPIRES_IN`        | e.g. `8h`                                        |
| `SUPER_ADMIN_USERNAME`  | super admin login name (seed only)               |
| `SUPER_ADMIN_EMAIL`     | super admin email (also `MAIL_FROM` fallback)    |
| `SUPABASE_URL`          | Supabase project URL                             |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only, never exposed to the client     |
| `MAIL_ENABLED`          | `true` / `false`                                 |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_SECURE` | SMTP settings                       |
| `MAIL_USER` / `MAIL_PASS` | SMTP credentials                               |
| `MAIL_FROM`             | `Question Bank <no-reply@...>`                   |
| `APP_BASE_URL`          | frontend URL used in password-reset links        |
| `CORS_ORIGINS`          | optional comma-separated allowlist; defaults to open CORS |

## Project Structure

```
server/
  index.js           # Express app + all API routes
  auth.js            # password hashing + JWT
  config.js          # env loading + config
  supabase.js        # data layer (all DB queries)
  mailer.js          # transactional email
  fileRepo.js        # JSON-file fallback storage (offline dev)
  seed.js            # roles/permissions/super-admin seed
  seedMasterData.js  # master data seed
  migrations/        # SQL migrations
  fixtures/          # seed fixtures
  data/              # runtime JSON files (git-ignored)
```

## Deploy (Render)

- Type: Web Service / Node
- Build: `npm ci`
- Start: `npm start`
- Health check: `/api/health`
- Mirror the env vars above in the dashboard; do **not** set `PORT`.

## Related

- Frontend repo (Vite React SPA + admin panel)
- Supabase schema: see `migrations/*.sql`