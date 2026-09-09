import bcrypt from "bcryptjs";
import { config } from "./config.js";
import {
  client,
  listUsers,
  createUser,
  setRolePermissions,
} from "./supabase.js";

/**
 * Seeds the initial data.
 *
 * When Supabase is configured:
 *   - Ensures the super_admin user exists (creates if missing).
 *   - Ensures roles/permissions/role_permissions rows exist (matches the
 *     schema in server/migrations/001_roles_permissions.sql).
 *
 * When Supabase is NOT configured, falls back to the legacy JSON file.
 */
const ROLE_DEFAULTS = {
  super_admin: [
    "users.view", "users.manage", "roles.manage",
    "question_banks.view", "question_banks.manage", "settings.view",
  ],
  teacher: ["question_banks.view", "question_banks.manage"],
  student: ["question_banks.view"],
};

const PERMISSION_ROWS = [
  ["users.view", "View users", "View the list of users in the admin panel"],
  ["users.manage", "Manage users", "Create, edit and deactivate users"],
  ["roles.manage", "Manage roles", "View and edit role permissions"],
  ["question_banks.view", "View question banks", "View question bank contents"],
  ["question_banks.manage", "Manage question banks", "Create and edit question banks"],
  ["settings.view", "View settings", "View platform settings"],
];

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
  let out = "";
  for (let i = 0; i < 16; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function seedSupabase() {
  // 1. Roles
  for (const [code, name, description] of [
    ["super_admin", "Super Admin", "Full access to all modules and settings"],
    ["teacher", "Teacher", "Manage question banks and their own content"],
    ["student", "Student", "View assigned question banks and take tests"],
  ]) {
    const { error } = await client.from("roles").upsert({ code, name, description });
    if (error) throw new Error(`seed roles: ${error.message}`);
  }

  // 2. Permissions
  for (const [code, label, description] of PERMISSION_ROWS) {
    const { error } = await client.from("permissions").upsert({ code, label, description });
    if (error) throw new Error(`seed permissions: ${error.message}`);
  }

  // 3. Role permissions
  for (const [role, perms] of Object.entries(ROLE_DEFAULTS)) {
    await setRolePermissions(role, perms);
  }

  // 4. Super admin user
  const existing = await listUsers();
  if (existing.some((u) => u.role === "super_admin")) {
    console.log("Super admin already exists in Supabase — skipping user creation.");
    return;
  }

  const password = process.env.SUPER_ADMIN_PASSWORD || randomPassword();
  await createUser({
    email: config.superAdmin.email,
    name: "Super Admin",
    password,
    role: "super_admin",
    active: true,
  });

  const shownPassword = process.env.SUPER_ADMIN_PASSWORD ? "(from SUPER_ADMIN_PASSWORD)" : password;
  console.log(`Seeded super admin: ${config.superAdmin.email} / ${shownPassword}`);
  console.log("Set SUPER_ADMIN_PASSWORD to fix it in production.");
}

async function fallbackSeedJson() {
  // Reuse the original JSON-file seeding logic.
  const { existsSync, writeFileSync, mkdirSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const usersFile = config.usersFile;
  if (existsSync(usersFile)) {
    console.log(`User store already exists: ${path.relative(process.cwd(), usersFile)}`);
    return;
  }
  const password = process.env.SUPER_ADMIN_PASSWORD || randomPassword();
  const passwordHash = bcrypt.hashSync(password, 12);
  mkdirSync(path.dirname(usersFile), { recursive: true });
  writeFileSync(
    usersFile,
    JSON.stringify(
      {
        version: 1,
        users: [
          {
            id: "u_superadmin",
            username: config.superAdmin.username,
            email: config.superAdmin.email,
            passwordHash,
            role: "super_admin",
            name: "Super Admin",
            createdAt: new Date().toISOString(),
            active: true,
          },
        ],
      },
      null,
      2
    )
  );
  const shownPassword = process.env.SUPER_ADMIN_PASSWORD ? "(from SUPER_ADMIN_PASSWORD)" : password;
  console.log(`Seeded super admin: ${config.superAdmin.username} / ${shownPassword}`);
  console.log("DELETE server/data/users.json and re-run to reseed.");
}

async function main() {
  if (client) {
    await seedSupabase();
    console.log("Supabase seed complete.");
  } else {
    await fallbackSeedJson();
    console.log("Supabase not configured — used legacy JSON seed.");
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
