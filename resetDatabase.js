import { client } from "./supabase.js";

/**
 * DANGER: Full database reset — wipes ALL data, then re-seeds admin credentials.
 * Run: node resetDatabase.js
 *
 * This deletes every row from every table (FK-safe order) and then runs
 * the admin seed (roles, permissions, super admin user) from seed.js.
 */

// Tables in FK-safe delete order (children before parents).
const TABLES = [
  // Analytics / history (no children)
  "question_usage_log",
  "question_edit_history",
  "question_performance",
  "question_teacher_usage",
  "question_school_usage",

  // Question options & payloads (depend on questions)
  "question_options",
  "question_payloads",
  "question_images",

  // Questions (depend on families, banks, taxonomy)
  "questions",

  // Question families
  "question_families",

  // Tests (depend on questions, taxonomy)
  "test_questions",
  "tests",

  // Question banks (depend on users)
  "question_banks",

  // Paper versioning
  "paper_versions",

  // Paper language artifacts
  "paper_languages",

  // Paper families (depend on papers, question_families)
  "paper_families",

  // Papers (depend on users, taxonomy)
  "papers",

  // Paper templates
  "paper_templates",

  // Standard-subject junction
  "standard_subjects",

  // Taxonomy (depend on each other)
  "topics",
  "chapters",

  // Standalone taxonomy
  "standards",
  "subjects",
  "exam_types",
  "resource_types",
  "languages",
  "question_levels",
  "schools",

  // Auth / roles
  "role_permissions",
  "users",
  "permissions",
  "roles",
];

async function deleteAll(table) {
  // Supabase client requires a WHERE clause — `.not('id','is',null)` matches all rows.
  const { error, count } = await client.from(table).delete({ count: "exact" }).not("id", "is", null);
  if (error) {
    // Silently skip tables that don't exist yet (pre-migration)
    if (error.code === "42P01" || error.message?.includes("does not exist")) {
      return 0;
    }
    console.error(`  ✗ ${table}: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

async function resetAll() {
  if (!client) {
    console.log("Supabase not configured — cannot reset.");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════");
  console.log("  DATABASE RESET");
  console.log("  ⚠  This will DELETE ALL DATA");
  console.log("═══════════════════════════════════════════════\n");

  let totalRows = 0;
  for (const table of TABLES) {
    const deleted = await deleteAll(table);
    if (deleted > 0) {
      console.log(`  ✓ ${table}: ${deleted} rows deleted`);
      totalRows += deleted;
    }
  }

  console.log(`\n  Total: ${totalRows} rows deleted across ${TABLES.length} tables\n`);
}

async function seedAdmin() {
  console.log("── Re-seeding admin credentials ──\n");

  // Inline the admin seed logic from seed.js (roles + permissions + super admin)
  // to avoid importing seed.js which has side effects on import.

  const bcrypt = (await import("bcryptjs")).default;
  const { config } = await import("./config.js");
  const { createUser, listUsers, setRolePermissions } = await import("./supabase.js");

  // 1. Roles
  const ROLES = [
    ["super_admin", "Super Admin", "Full access to all modules and settings"],
    ["teacher", "Teacher", "Manage question banks and their own content"],
    ["student", "Student", "View assigned question banks and take tests"],
  ];
  for (const [code, name, description] of ROLES) {
    const { error } = await client.from("roles").upsert({ code, name, description });
    if (error) throw new Error(`roles: ${error.message}`);
  }
  console.log("  ✓ Roles seeded");

  // 2. Permissions (same set as seed.js)
  const PERMISSIONS = [
    ["users.view", "View users", "View the list of users in the admin panel"],
    ["users.manage", "Manage users", "Create, edit and deactivate users"],
    ["roles.manage", "Manage roles", "Configure roles and their permissions"],
    ["question_banks.view", "View question banks", "Browse and read question banks"],
    ["question_banks.manage", "Manage question banks", "Create, edit, delete questions and banks"],
    ["settings.view", "View settings", "View application settings"],
    ["papers.view", "View papers", "View generated question papers"],
    ["papers.manage", "Manage papers", "Create, edit, and delete papers"],
    ["papers.delete", "Delete papers", "Permanently delete papers"],
    ["papers.publish", "Publish papers", "Publish papers for students"],
    ["papers.generate", "Generate papers", "Auto-generate papers from question banks"],
    ["papers.export", "Export papers", "Export papers to PDF and other formats"],
    ["papers.templates.manage", "Manage paper templates", "Create and edit paper templates"],
    ["papers.translations.manage", "Manage translations", "Manage multi-language paper translations"],
    ["papers.reports.view", "View reports", "View paper reports and answer keys"],
  ];
  for (const [code, label, description] of PERMISSIONS) {
    const { error } = await client.from("permissions").upsert({ code, label, description });
    if (error) throw new Error(`permissions: ${error.message}`);
  }
  console.log("  ✓ Permissions seeded");

  // 3. Role-permission mappings
  const PAPER_PERMS = {
    super_admin: ["papers.view", "papers.manage", "papers.delete", "papers.publish", "papers.generate", "papers.export", "papers.templates.manage", "papers.translations.manage", "papers.reports.view"],
    teacher: ["papers.view", "papers.manage", "papers.delete", "papers.publish", "papers.generate", "papers.export", "papers.templates.manage", "papers.translations.manage", "papers.reports.view"],
    student: ["papers.view", "papers.export", "papers.reports.view"],
  };
  const ROLE_PERMS = {
    super_admin: ["users.view", "users.manage", "roles.manage", "question_banks.view", "question_banks.manage", "settings.view"],
    teacher: ["question_banks.view", "question_banks.manage"],
    student: ["question_banks.view"],
  };
  for (const [role, perms] of Object.entries(ROLE_PERMS)) {
    const allPerms = [...perms, ...(PAPER_PERMS[role] ?? [])];
    await setRolePermissions(role, allPerms);
  }
  console.log("  ✓ Role-permission mappings set");

  // 4. Super admin user
  const existing = await listUsers();
  if (existing.some((u) => u.role === "super_admin")) {
    console.log("  ✓ Super admin already exists");
  } else {
    function randomPassword() {
      const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
      let out = "";
      for (let i = 0; i < 16; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
      return out;
    }
    const password = process.env.SUPER_ADMIN_PASSWORD || randomPassword();
    await createUser({
      email: config.superAdmin.email,
      name: "Super Admin",
      password,
      role: "super_admin",
      active: true,
    });
    const shown = process.env.SUPER_ADMIN_PASSWORD ? "(from SUPER_ADMIN_PASSWORD)" : password;
    console.log(`  ✓ Super admin created: ${config.superAdmin.email} / ${shown}`);
  }
}

async function main() {
  try {
    await resetAll();
    await seedAdmin();

    console.log("\n═══════════════════════════════════════════════");
    console.log("  Reset complete!");
    console.log("  Run 'node seedMasterData.js' to re-seed taxonomy.");
    console.log("  Run 'node seedQuestionBank.js' to re-seed questions.");
    console.log("═══════════════════════════════════════════════");
  } catch (err) {
    console.error("\n✗ Reset failed:", err);
    process.exit(1);
  }
}

main();
