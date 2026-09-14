// ---------------------------------------------------------------------------
// E2E harness (Phase 17 regression) — isolated file-repo mode only.
// NEVER touches Supabase: SUPABASE_URL/SERVICE_ROLE_KEY are blanked in env,
// so the server falls back to backend/data/users.json (gitignored).
// ---------------------------------------------------------------------------
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, copyFileSync, existsSync, rmSync, renameSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PORT = 4150;
export const BASE = `http://127.0.0.1:${PORT}/api`;

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const USERS_BACKUP = path.join(DATA_DIR, "users.e2e-backup.json");

export function seedUsersFile() {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(USERS_FILE)) copyFileSync(USERS_FILE, USERS_BACKUP);
  const hash = bcrypt.hashSync("E2ePass!123", 4);
  const users = [
    { id: "u_sa", username: "sa", email: "sa@e2e.local", passwordHash: hash, role: "super_admin", name: "SA", active: true, createdAt: new Date().toISOString() },
    { id: "u_teacher", username: "t", email: "t@e2e.local", passwordHash: hash, role: "teacher", name: "Teacher", active: true, createdAt: new Date().toISOString() },
    { id: "u_student", username: "s", email: "s@e2e.local", passwordHash: hash, role: "student", name: "Student", active: true, createdAt: new Date().toISOString() },
  ];
  writeFileSync(USERS_FILE, JSON.stringify({ version: 1, users }, null, 2));
}

let server = null;
export async function startServer() {
  server = spawn(process.execPath, ["index.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      JWT_SECRET: "e2e-harness-secret",
      MAIL_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write("[srv] " + d));
  server.stderr.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write("[srv!] " + d));
  server.on("exit", (code) => { if (process.env.E2E_VERBOSE) console.log("[srv exited]", code); });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("E2E server failed to start");
}

export function stopServer() {
  if (server) server.kill();
  server = null;
}

export function restoreUsersFile() {
  if (existsSync(USERS_BACKUP)) {
    rmSync(USERS_FILE);
    renameSync(USERS_BACKUP, USERS_FILE);
  } else {
    rmSync(USERS_FILE, { force: true });
  }
}

// ------------------------------------------------------------------ helpers
let tokens = {};

export async function api(method, url, { role = "sa", body, token, raw } = {}) {
  const headers = { "Content-Type": "application/json" };
  const t = token ?? tokens[role];
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, body: json };
}

export async function login(role) {
  const creds = {
    sa: ["sa@e2e.local", "E2ePass!123"],
    teacher: ["t@e2e.local", "E2ePass!123"],
    student: ["s@e2e.local", "E2ePass!123"],
  }[role];
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: creds[0], password: creds[1] }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`login ${role} failed: ${JSON.stringify(json)}`);
  tokens[role] = json.token;
  return json;
}

export function tokenOf(role) { return tokens[role]; }
export function clearTokens() { tokens = {}; }
