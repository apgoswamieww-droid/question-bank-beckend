import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { config } from "./config.js";

/**
 * Legacy JSON-file fallback repository.
 * Used ONLY when Supabase credentials are not configured, so the app keeps
 * working in local/dev mode. Production should always use Supabase.
 */

const ROLES = [
  { code: "super_admin", name: "Super Admin", description: "Full access to all modules and settings" },
  { code: "teacher", name: "Teacher", description: "Manage question banks and their own content" },
  { code: "student", name: "Student", description: "View assigned question banks and take tests" },
];

const PERMISSIONS = [
  { code: "users.view", label: "View users", description: "View the list of users in the admin panel" },
  { code: "users.manage", label: "Manage users", description: "Create, edit and deactivate users" },
  { code: "roles.manage", label: "Manage roles", description: "View and edit role permissions" },
  { code: "question_banks.view", label: "View question banks", description: "View question bank contents" },
  { code: "question_banks.manage", label: "Manage question banks", description: "Create and edit question banks" },
  // Paper Generator (Phase 17) — same codes as supabase.js PERMISSIONS.
  { code: "papers.view", label: "View papers", description: "View papers, structure, versions, analysis and print data in the Paper Generator" },
  { code: "papers.manage", label: "Manage papers", description: "Create, edit, duplicate, validate, archive and restore papers" },
  { code: "papers.delete", label: "Delete papers", description: "Delete papers that are not published" },
  { code: "papers.publish", label: "Publish papers", description: "Validate and publish papers" },
  { code: "papers.generate", label: "Generate papers", description: "Generate paper questions from blueprints and randomization sets" },
  { code: "papers.export", label: "Export paper PDFs", description: "Export papers as PDF files" },
  { code: "papers.templates.manage", label: "Manage paper templates", description: "Create, edit and delete saved paper templates" },
  { code: "papers.translations.manage", label: "Manage paper translations", description: "Manage translation readiness and generate language papers" },
  { code: "papers.reports.view", label: "View paper reports", description: "View paper answer keys and solutions reports" },
  { code: "settings.view", label: "View settings", description: "View platform settings" },
];

const ROLES_FILE = config.rolesFile ?? "data/roles.json";

function loadRoles() {
  try {
    const raw = readFileSync(ROLES_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.roles) ? parsed.roles : [];
  } catch {
    return [];
  }
}

function saveRoles(roles) {
  const dir = path.dirname(ROLES_FILE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(ROLES_FILE, JSON.stringify({ version: 1, roles }, null, 2), "utf-8");
}

const ROLE_PERMISSIONS = {
  super_admin: [
    "users.view", "users.manage", "roles.manage",
    "question_banks.view", "question_banks.manage", "settings.view",
  ],
  // Paper Generator codes mirror migration 014's mapping of the legacy
  // question_banks access so fallback behavior is unchanged.
  teacher: [
    "question_banks.view", "question_banks.manage",
    "papers.view", "papers.manage", "papers.delete", "papers.publish",
    "papers.generate", "papers.export", "papers.templates.manage",
    "papers.translations.manage", "papers.reports.view",
  ],
  student: ["question_banks.view", "papers.view", "papers.export", "papers.reports.view"],
};

function loadUsers() {
  try {
    const raw = readFileSync(config.usersFile, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  // path.dirname (not string slicing): Windows separators made the old slice
  // produce a file-less path like "data\roles.jso" and mkdir a junk directory.
  const dir = path.dirname(config.usersFile);
  mkdirSync(dir, { recursive: true });
  writeFileSync(config.usersFile, JSON.stringify({ version: 1, users }, null, 2), "utf-8");
}

const rowToUser = (row) => ({
  id: row.id,
  email: row.email,
  name: row.full_name ?? row.name,
  role: row.role,
  active: row.active,
  profileImage: row.profileImage ?? row.profile_image ?? null,
  phone: row.phone ?? null,
  gender: row.gender ?? null,
  dateOfBirth: row.dateOfBirth ?? row.date_of_birth ?? null,
  address: row.address ?? null,
  hireDate: row.hireDate ?? row.hire_date ?? null,
  subject: row.subject ?? null,
  qualification: row.qualification ?? null,
  passwordHash: row.passwordHash ?? row.password_hash,
  createdAt: row.createdAt ?? row.created_at,
});

export const fileRepo = {
  listUsers() {
    return loadUsers().map(rowToUser);
  },

  getUserById(id) {
    return loadUsers().find((u) => u.id === id) ?? null;
  },

  createUser({ email, name, password, role, active = true, phone, gender, dateOfBirth, address, hireDate, subject, qualification, profileImage }) {
    const users = loadUsers();
    const user = {
      id: `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      // Legacy username column is kept populated with the email so the schema
      // stays satisfied; username is no longer part of the product.
      username: email,
      email,
      full_name: name,
      password_hash: bcrypt.hashSync(String(password ?? ""), 12),
      role,
      active,
      profileImage: profileImage ?? null,
      phone: phone ?? null,
      gender: gender ?? null,
      dateOfBirth: dateOfBirth ?? null,
      address: address ?? null,
      hireDate: hireDate ?? null,
      subject: subject ?? null,
      qualification: qualification ?? null,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveUsers(users);
    return rowToUser(user);
  },

  updateUser(id, { name, email, password, active, phone, gender, dateOfBirth, address, hireDate, subject, qualification, profileImage }) {
    const users = loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx < 0) return null;
    const u = users[idx];
    if (name !== undefined) u.full_name = name;
    if (email !== undefined) { u.email = email; u.username = email; }
    if (active !== undefined) u.active = active;
    if (profileImage !== undefined) u.profileImage = profileImage || null;
    if (phone !== undefined) u.phone = phone || null;
    if (gender !== undefined) u.gender = gender || null;
    if (dateOfBirth !== undefined) u.dateOfBirth = dateOfBirth || null;
    if (address !== undefined) u.address = address || null;
    if (hireDate !== undefined) u.hireDate = hireDate || null;
    if (subject !== undefined) u.subject = subject || null;
    if (qualification !== undefined) u.qualification = qualification || null;
    if (password) u.password_hash = bcrypt.hashSync(String(password), 12);
    saveUsers(users);
    return rowToUser(u);
  },

  deleteUser(id) {
    const users = loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx < 0) return undefined;
    const [removed] = users.splice(idx, 1);
    saveUsers(users);
    return rowToUser(removed);
  },

  setUserRole(id, role) {
    const users = loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx < 0) return null;
    users[idx].role = role;
    saveUsers(users);
    return rowToUser(users[idx]);
  },

  countUsersByRole() {
    const counts = { teacher: 0, student: 0, super_admin: 0 };
    for (const u of loadUsers()) counts[u.role] = (counts[u.role] ?? 0) + 1;
    return counts;
  },

  listRoles() {
    return [...ROLES, ...loadRoles()];
  },

  createRole({ code, name, description }) {
    const custom = loadRoles();
    if (custom.some((r) => r.code === code)) {
      const err = new Error("Role code already exists");
      err.code = "ROLE_EXISTS";
      throw err;
    }
    custom.push({ code, name, description: description || null });
    saveRoles(custom);
    return { code, name, description: description || null };
  },

  deleteRole(code) {
    const custom = loadRoles().filter((r) => r.code !== code);
    saveRoles(custom);
    return true;
  },

  listPermissions() {
    return PERMISSIONS;
  },

  listRolePermissions() {
    return Object.entries(ROLE_PERMISSIONS).flatMap(([role_code, perms]) =>
      perms.map((permission_code) => ({ role_code, permission_code }))
    );
  },

  setRolePermissions(roleCode, permissionCodes) {
    ROLE_PERMISSIONS[roleCode] = [...new Set(permissionCodes)];
    return ROLE_PERMISSIONS[roleCode];
  },
};

// ---------------------------------------------------------------------------
// One-time password-reset tokens (JSON fallback storage)
// ---------------------------------------------------------------------------
function loadResets() {
  try {
    if (!existsSync(config.resetsFile)) return {};
    return JSON.parse(readFileSync(config.resetsFile, "utf-8"));
  } catch {
    return {};
  }
}

function saveResets(store) {
  const dir = path.dirname(config.resetsFile);
  mkdirSync(dir, { recursive: true });
  writeFileSync(config.resetsFile, JSON.stringify(store, null, 2), "utf-8");
}

export const resetStore = {
  create(token, { userId, email, expiresAt }) {
    const store = loadResets();
    store[token] = { userId, email, expiresAt };
    saveResets(store);
  },
  get(token) {
    const store = loadResets();
    return store[token] ?? null;
  },
  consume(token) {
    const store = loadResets();
    const entry = store[token];
    if (!entry) return null;
    delete store[token];
    saveResets(store);
    return entry;
  },
  purgeExpired() {
    const store = loadResets();
    const now = Date.now();
    for (const t of Object.keys(store)) {
      if (store[t].expiresAt < now) delete store[t];
    }
    saveResets(store);
  },
};
