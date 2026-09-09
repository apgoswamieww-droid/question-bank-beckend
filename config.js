import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (avoids an extra dependency for the API server).
// Loads the repo-root .env first, then the server-local .env (which takes
// precedence), so Supabase/Mailtrap secrets can live next to the server.
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnv(path.join(__dirname, "..", ".env"));
loadEnv(path.join(__dirname, ".env"));

function int(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const JWT_SECRET =
  process.env.JWT_SECRET || "dev-only-secret-change-me-in-production";

export const config = {
  port: int(process.env.PORT || process.env.ADMIN_API_PORT, 4000),
  jwt: {
    secret: JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
    issuer: "question-bank-admin",
  },
  superAdmin: {
    username: (process.env.SUPER_ADMIN_USERNAME || "admin").trim(),
    email: (process.env.SUPER_ADMIN_EMAIL || "admin@questionbank.local").trim(),
  },
  // Supabase (Postgres) — used as the database for users, roles & permissions.
  // The SERVICE ROLE key stays server-side only and must never reach the client.
  supabase: {
    url: String(process.env.SUPABASE_URL || "").trim(),
    serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  },
  // Email (Mailtrap for testing, SMTP in production).
  mail: {
    enabled: process.env.MAIL_ENABLED === "true",
    host: (process.env.MAIL_HOST || "smtp.mailtrap.io").trim(),
    port: int(process.env.MAIL_PORT, 2525),
    secure: process.env.MAIL_SECURE === "true",
    user: String(process.env.MAIL_USER || "").trim(),
    pass: String(process.env.MAIL_PASS || "").trim(),
    from: String(process.env.MAIL_FROM || process.env.SUPER_ADMIN_EMAIL || "Question Bank <no-reply@questionbank.local>").trim(),
    baseUrl: String(process.env.APP_BASE_URL || "http://localhost:5173").trim(),
  },
  // Loaded at startup from users.json (seeded via seed.js) — fallback only.
  usersFile: path.join(__dirname, "data", "users.json"),
  // One-time password-reset tokens (fallback storage).
  resetsFile: path.join(__dirname, "data", "resets.json"),
};