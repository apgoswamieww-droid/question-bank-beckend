import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { fileRepo, resetStore } from "./fileRepo.js";
import bcrypt from "bcryptjs";

/**
 * Data layer for users, roles & permissions.
 * Primary backend: Supabase (Postgres) via the service-role client.
 * Fallback: the legacy JSON file (server/data/users.json) when Supabase
 * credentials are not configured — keeps local/dev mode working offline.
 */

const supabaseConfigured =
  Boolean(config.supabase.url) && Boolean(config.supabase.serviceRoleKey);

export const client = supabaseConfigured
  ? createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// ---------------------------------------------------------------------------
// Permission constants (shared with frontend)
// ---------------------------------------------------------------------------
export const PERMISSIONS = {
  USERS_VIEW: "users.view",
  USERS_MANAGE: "users.manage",
  SCHOOLS_VIEW: "schools.view",
  SCHOOLS_MANAGE: "schools.manage",
  ROLES_MANAGE: "roles.manage",
  QUESTION_BANKS_VIEW: "question_banks.view",
  QUESTION_BANKS_MANAGE: "question_banks.manage",
  QUESTIONS_DELETE: "questions.delete",
  EDITOR_ACCESS: "editor.access",
  TESTS_VIEW: "tests.view",
  TESTS_MANAGE: "tests.manage",
  TESTS_DELETE: "tests.delete",
  ANALYTICS_VIEW: "analytics.view",
  MASTER_DATA_VIEW: "master_data.view",
  MASTER_DATA_MANAGE: "master_data.manage",
  PAPERS_VIEW: "papers.view",
  PAPERS_MANAGE: "papers.manage",
  PAPERS_DELETE: "papers.delete",
  PAPERS_PUBLISH: "papers.publish",
  PAPERS_GENERATE: "papers.generate",
  PAPERS_EXPORT: "papers.export",
  PAPERS_TEMPLATES_MANAGE: "papers.templates.manage",
  PAPERS_TRANSLATIONS_MANAGE: "papers.translations.manage",
  PAPERS_REPORTS_VIEW: "papers.reports.view",
  SETTINGS_VIEW: "settings.view",
  SETTINGS_MANAGE: "settings.manage",
};

export const PERMISSION_MODULE_MAP = {
  "users.view": "Users Management",
  "users.manage": "Users Management",
  "schools.view": "Schools Management",
  "schools.manage": "Schools Management",
  "question_banks.view": "Question Bank & Editor",
  "question_banks.manage": "Question Bank & Editor",
  "questions.delete": "Question Bank & Editor",
  "editor.access": "Question Bank & Editor",
  "tests.view": "Tests & Exam Papers",
  "tests.manage": "Tests & Exam Papers",
  "tests.delete": "Tests & Exam Papers",
  "analytics.view": "Analytics & Reports",
  "master_data.view": "Academic Hierarchy",
  "master_data.manage": "Academic Hierarchy",
  "papers.view": "Paper Generator",
  "papers.manage": "Paper Generator",
  "papers.delete": "Paper Generator",
  "papers.publish": "Paper Generator",
  "papers.generate": "Paper Generator",
  "papers.export": "Paper Generator",
  "papers.templates.manage": "Paper Generator",
  "papers.translations.manage": "Paper Generator",
  "papers.reports.view": "Paper Generator",
  "settings.view": "System & Settings",
  "settings.manage": "System & Settings",
  "roles.manage": "System & Settings",
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

// ---------------------------------------------------------------------------
// Paper Generator permissions (Phase 17)
// ---------------------------------------------------------------------------
// The Paper Generator previously borrowed question_banks.view/manage. These
// codes give the module its own granularity INSIDE the existing permission
// system (same tables, same middleware, same matrix UI — no new architecture).

/** Read-only paper access: view papers, structure, versions, analysis, print data. */
export const PAPER_VIEW_PERMISSIONS = [
  "papers.view",
  "papers.export",
  "papers.reports.view",
];

/** Full paper authoring access (implies the view permissions). */
export const PAPER_MANAGE_PERMISSIONS = [
  "papers.manage",
  "papers.generate",
  "papers.publish",
  "papers.templates.manage",
  "papers.translations.manage",
  "papers.delete",
];

/**
 * Map legacy effective access onto Paper Generator permissions so existing
 * roles keep exactly the access they had through question_banks.view/manage.
 * Used by seed.js; migration 014 mirrors the same mapping in SQL for roles
 * already in the database (including custom roles).
 */
export function paperPermissionsForLegacy(questionBankPerms = []) {
  const has = new Set(questionBankPerms);
  const out = [];
  // question_banks.manage implies view in the legacy matrix (every role with
  // manage also holds view), so it maps to the full paper permission set —
  // matching migration 014's manage-level grant.
  if (has.has("question_banks.view") || has.has("question_banks.manage")) {
    out.push(...PAPER_VIEW_PERMISSIONS);
  }
  if (has.has("question_banks.manage")) out.push(...PAPER_MANAGE_PERMISSIONS);
  return out;
}

// ---------------------------------------------------------------------------
// User repository
// ---------------------------------------------------------------------------
const rowToUser = (row) => ({
  id: row.id,
  email: row.email,
  name: row.full_name,
  passwordHash: row.password_hash,
  role: row.role,
  active: row.active,
  profileImage: row.profile_image ?? null,
  phone: row.phone ?? null,
  gender: row.gender ?? null,
  dateOfBirth: row.date_of_birth ?? null,
  address: row.address ?? null,
  hireDate: row.hire_date ?? null,
  subject: row.subject ?? null,
  qualification: row.qualification ?? null,
  createdAt: row.created_at,
});

const hashPassword = (plain) => bcrypt.hashSync(String(plain ?? ""), 12);

export async function listUsers() {
  if (client) {
    const { data, error } = await client
      .from("users")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Supabase users.list: ${error.message}`);
    return data.map(rowToUser);
  }
  return fileRepo.listUsers();
}

export async function getUserById(id) {
  if (client) {
    const { data, error } = await client
      .from("users")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Supabase users.getById: ${error.message}`);
    return data ? rowToUser(data) : null;
  }
  return fileRepo.getUserById(id);
}

export async function findUserByLogin(identifier) {
  const needle = String(identifier ?? "").trim().toLowerCase();
  if (!needle) return null;
  const users = await listUsers();
  // Authentication is email-based only (username has been removed).
  return users.find((u) => u.active !== false && u.email.toLowerCase() === needle) || null;
}

export async function createUser({
  email,
  name,
  password,
  role,
  active = true,
  phone,
  gender,
  dateOfBirth,
  address,
  hireDate,
  subject,
  qualification,
  profileImage,
}) {
  if (client) {
    const { error } = await client.from("users").insert({
      // Legacy username column is kept populated with the email so the schema
      // stays satisfied; username is no longer part of the product.
      username: email,
      email,
      full_name: name,
      password_hash: hashPassword(password),
      role,
      active,
      profile_image: profileImage ?? null,
      phone: phone ?? null,
      gender: gender ?? null,
      date_of_birth: dateOfBirth ?? null,
      address: address ?? null,
      hire_date: hireDate ?? null,
      subject: subject ?? null,
      qualification: qualification ?? null,
    });
    if (error) throw new Error(`Supabase users.create: ${error.message}`);
    return findUserByLogin(email);
  }
  return fileRepo.createUser({
    email, name, password, role, active,
    phone, gender, dateOfBirth, address, hireDate, subject, qualification, profileImage,
  });
}

export async function updateUser(id, { name, email, password, active, phone, gender, dateOfBirth, address, hireDate, subject, qualification, profileImage }) {
  const patch = {};
  if (name !== undefined) patch.full_name = name;
  if (email !== undefined) { patch.email = email; patch.username = email; }
  if (active !== undefined) patch.active = active;
  if (profileImage !== undefined) patch.profile_image = profileImage || null;
  if (phone !== undefined) patch.phone = phone || null;
  if (gender !== undefined) patch.gender = gender || null;
  if (dateOfBirth !== undefined) patch.date_of_birth = dateOfBirth || null;
  if (address !== undefined) patch.address = address || null;
  if (hireDate !== undefined) patch.hire_date = hireDate || null;
  if (subject !== undefined) patch.subject = subject || null;
  if (qualification !== undefined) patch.qualification = qualification || null;
  if (password !== undefined && password) patch.password_hash = hashPassword(password);

  if (client) {
    const { error } = await client.from("users").update(patch).eq("id", id);
    if (error) throw new Error(`Supabase users.update: ${error.message}`);
    return getUserById(id);
  }
  return fileRepo.updateUser(id, { name, email, password, active, phone, gender, dateOfBirth, address, hireDate, subject, qualification, profileImage });
}

export async function deleteUser(id) {
  if (client) {
    const { error } = await client.from("users").delete().eq("id", id);
    if (error) throw new Error(`Supabase users.delete: ${error.message}`);
    return true;
  }
  return fileRepo.deleteUser(id);
}

export async function setUserRole(id, role) {
  if (client) {
    const { error } = await client.from("users").update({ role }).eq("id", id);
    if (error) throw new Error(`Supabase users.setRole: ${error.message}`);
    return getUserById(id);
  }
  return fileRepo.setUserRole(id, role);
}

export async function countUsersByRole() {
  if (client) {
    const { data, error } = await client
      .from("users")
      .select("role");
    if (error) throw new Error(`Supabase users.count: ${error.message}`);
    const counts = { teacher: 0, student: 0, super_admin: 0 };
    for (const u of data) counts[u.role] = (counts[u.role] ?? 0) + 1;
    return counts;
  }
  return fileRepo.countUsersByRole();
}

// ---------------------------------------------------------------------------
// Roles & permissions repository
// ---------------------------------------------------------------------------
export async function listRoles() {
  if (client) {
    const { data, error } = await client.from("roles").select("*").order("code");
    if (error) throw new Error(`Supabase roles.list: ${error.message}`);
    return data;
  }
  return fileRepo.listRoles();
}

export async function createRole({ code, name, description }) {
  if (client) {
    const { data, error } = await client
      .from("roles")
      .insert({ code, name, description: description || null })
      .select()
      .single();
    if (error) throw new Error(`Supabase roles.create: ${error.message}`);
    return data;
  }
  return fileRepo.createRole({ code, name, description });
}

export async function deleteRole(code) {
  const SYSTEM_ROLES = new Set(["super_admin", "teacher", "student"]);
  if (SYSTEM_ROLES.has(code)) {
    throw new Error("System roles cannot be deleted");
  }
  if (client) {
    const { error } = await client.from("roles").delete().eq("code", code);
    if (error) throw new Error(`Supabase roles.delete: ${error.message}`);
    return true;
  }
  return fileRepo.deleteRole(code);
}

export async function listPermissions() {
  let rows = [];
  if (client) {
    const { data, error } = await client.from("permissions").select("*").order("code");
    if (error) throw new Error(`Supabase permissions.list: ${error.message}`);
    rows = data || [];
  } else {
    rows = fileRepo.listPermissions();
  }
  return rows.map((p) => ({
    ...p,
    module: PERMISSION_MODULE_MAP[p.code] || "General",
  }));
}

export async function listRolePermissions() {
  if (client) {
    const { data, error } = await client.from("role_permissions").select("*");
    if (error) throw new Error(`Supabase role_permissions.list: ${error.message}`);
    return data;
  }
  return fileRepo.listRolePermissions();
}

export async function permissionsForRole(roleCode) {
  if (roleCode === "super_admin") {
    const all = await listPermissions();
    return all.map((p) => p.code);
  }
  const rows = await listRolePermissions();
  return rows
    .filter((r) => r.role_code === roleCode)
    .map((r) => r.permission_code);
}

export async function hasPermission(roleCode, permission) {
  if (roleCode === "super_admin") return true;
  const perms = await permissionsForRole(roleCode);
  return perms.includes(permission);
}

export async function setRolePermissions(roleCode, permissionCodes) {
  const unique = [...new Set(permissionCodes)];
  if (!client) {
    return fileRepo.setRolePermissions(roleCode, unique);
  }

  // super_admin always keeps full access
  if (roleCode === "super_admin") {
    const all = await listPermissions();
    return all.map((p) => p.code);
  }

  // Replace all rows for the role in a transaction-ish manner.
  const { error: delErr } = await client
    .from("role_permissions")
    .delete()
    .eq("role_code", roleCode);
  if (delErr) throw new Error(`Supabase role_permissions.delete: ${delErr.message}`);

  if (unique.length > 0) {
    const { error: insErr } = await client.from("role_permissions").insert(
      unique.map((permission_code) => ({ role_code: roleCode, permission_code }))
    );
    if (insErr) throw new Error(`Supabase role_permissions.insert: ${insErr.message}`);
  }

  return unique;
}

// One-time password-reset token store (file-backed, works across backends).
export const passwordResetStore = resetStore;

// ---------------------------------------------------------------------------
// Master Data: Standards
// ---------------------------------------------------------------------------
export async function listStandards() {
  if (!client) return [];
  const { data, error } = await client.from("standards").select("*").order("sort_order");
  if (error) throw new Error(`Supabase standards.list: ${error.message}`);
  return data;
}

export async function createStandard({ name, sort_order = 0 }) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("standards").insert({ name, sort_order }).select().single();
  if (error) throw new Error(`Supabase standards.create: ${error.message}`);
  return data;
}

export async function updateStandard(id, { name, sort_order, active }) {
  if (!client) return null;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (sort_order !== undefined) patch.sort_order = sort_order;
  if (active !== undefined) patch.active = active;
  const { data, error } = await client.from("standards").update(patch).eq("id", id).select().single();
  if (error) throw new Error(`Supabase standards.update: ${error.message}`);
  return data;
}

export async function deleteStandard(id) {
  if (!client) return false;
  const { error } = await client.from("standards").delete().eq("id", id);
  if (error) throw new Error(`Supabase standards.delete: ${error.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// Master Data: Subjects
// ---------------------------------------------------------------------------
export async function listSubjects() {
  if (!client) return [];
  const { data, error } = await client.from("subjects").select("*").order("sort_order");
  if (error) throw new Error(`Supabase subjects.list: ${error.message}`);
  return data;
}

export async function createSubject({ name, icon, color, sort_order = 0 }) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("subjects").insert({ name, icon, color, sort_order }).select().single();
  if (error) throw new Error(`Supabase subjects.create: ${error.message}`);
  return data;
}

export async function updateSubject(id, { name, icon, color, sort_order, active }) {
  if (!client) return null;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (icon !== undefined) patch.icon = icon;
  if (color !== undefined) patch.color = color;
  if (sort_order !== undefined) patch.sort_order = sort_order;
  if (active !== undefined) patch.active = active;
  const { data, error } = await client.from("subjects").update(patch).eq("id", id).select().single();
  if (error) throw new Error(`Supabase subjects.update: ${error.message}`);
  return data;
}

export async function deleteSubject(id) {
  if (!client) return false;
  const { error } = await client.from("subjects").delete().eq("id", id);
  if (error) throw new Error(`Supabase subjects.delete: ${error.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// Master Data: Standard ↔ Subject mapping
// ---------------------------------------------------------------------------
export async function listStandardSubjects({ standard_id, subject_id } = {}) {
  if (!client) return [];
  let query = client
    .from("standard_subjects")
    .select("*, subject:subjects(id, name, icon, color, sort_order, active)")
    .order("sort_order");
  if (standard_id) query = query.eq("standard_id", standard_id);
  if (subject_id) query = query.eq("subject_id", subject_id);
  const { data, error } = await query;
  if (error) throw new Error(`Supabase standard_subjects.list: ${error.message}`);
  return data;
}

// Create mappings for a subject (idempotent: skips existing pairs).
export async function linkSubjectToStandards(subjectId, standardIds) {
  if (!client) throw new Error("Supabase not configured");
  const ids = [...new Set((standardIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const rows = ids.map((standard_id, i) => ({ standard_id, subject_id: subjectId, sort_order: i }));
  const { data, error } = await client
    .from("standard_subjects")
    .upsert(rows, { onConflict: "standard_id,subject_id", ignoreDuplicates: true })
    .select();
  if (error) throw new Error(`Supabase standard_subjects.link: ${error.message}`);
  return data || [];
}

// Replace the full standard set for a subject.
export async function replaceSubjectStandards(subjectId, standardIds) {
  if (!client) throw new Error("Supabase not configured");
  const { data: current, error: selErr } = await client
    .from("standard_subjects")
    .select("id, standard_id")
    .eq("subject_id", subjectId);
  if (selErr) throw new Error(`Supabase standard_subjects.select: ${selErr.message}`);

  const nextIds = new Set(standardIds || []);
  const toDelete = (current || []).filter((row) => !nextIds.has(row.standard_id));

  if (toDelete.length) {
    const { error: delErr } = await client
      .from("standard_subjects")
      .delete()
      .in("id", toDelete.map((r) => r.id));
    if (delErr) throw new Error(`Supabase standard_subjects.delete: ${delErr.message}`);
  }
  await linkSubjectToStandards(subjectId, [...nextIds]);
  return listStandardSubjects({ subject_id: subjectId });
}

// ---------------------------------------------------------------------------
// Master Data: Chapters
// ---------------------------------------------------------------------------
export async function listChapters({ subject_id, standard_id, resource_type_ids } = {}) {
  if (!client) return [];
  let query = client.from("chapters").select("*").order("sort_order");
  if (subject_id) query = query.eq("subject_id", subject_id);
  if (standard_id) query = query.eq("standard_id", standard_id);

  // If filtering by resource types, first get matching chapter IDs from junction table
  if (resource_type_ids && resource_type_ids.length) {
    const { data: crtRows, error: crtErr } = await client
      .from("chapter_resource_types")
      .select("chapter_id")
      .in("resource_type_id", resource_type_ids);
    if (crtErr) throw new Error(`Supabase chapters.list (crt): ${crtErr.message}`);
    const chapterIds = [...new Set((crtRows || []).map((r) => r.chapter_id))];
    if (chapterIds.length === 0) return [];
    query = query.in("id", chapterIds);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Supabase chapters.list: ${error.message}`);
  return data;
}

// Get resource type IDs for a set of chapters
export async function getChapterResourceTypes(chapterIds) {
  if (!client || !chapterIds?.length) return {};
  const { data, error } = await client
    .from("chapter_resource_types")
    .select("chapter_id, resource_type_id")
    .in("chapter_id", chapterIds);
  if (error) throw new Error(`Supabase chapter_resource_types.get: ${error.message}`);
  const map = {};
  for (const row of data || []) {
    if (!map[row.chapter_id]) map[row.chapter_id] = [];
    map[row.chapter_id].push(row.resource_type_id);
  }
  return map;
}

// Replace resource types for a chapter
export async function setChapterResourceTypes(chapterId, resourceTypeIds) {
  if (!client) return;
  // Delete existing
  await client.from("chapter_resource_types").delete().eq("chapter_id", chapterId);
  // Insert new
  const ids = [...new Set((resourceTypeIds || []).filter(Boolean))];
  if (!ids.length) return;
  const rows = ids.map((resource_type_id) => ({ chapter_id: chapterId, resource_type_id }));
  const { error } = await client.from("chapter_resource_types").insert(rows);
  if (error) throw new Error(`Supabase chapter_resource_types.set: ${error.message}`);
}

export async function createChapter({ subject_id, standard_id, resource_type_ids, name, number, description, sort_order = 0 }) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("chapters").insert({ subject_id, standard_id, name, number, description, sort_order }).select().single();
  if (error) throw new Error(`Supabase chapters.create: ${error.message}`);
  // Link resource types
  if (Array.isArray(resource_type_ids) && resource_type_ids.length) {
    await setChapterResourceTypes(data.id, resource_type_ids);
  }
  return data;
}

export async function updateChapter(id, { name, number, description, sort_order, active, resource_type_ids }) {
  if (!client) return null;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (number !== undefined) patch.number = number;
  if (description !== undefined) patch.description = description;
  if (sort_order !== undefined) patch.sort_order = sort_order;
  if (active !== undefined) patch.active = active;
  const { data, error } = await client.from("chapters").update(patch).eq("id", id).select().single();
  if (error) throw new Error(`Supabase chapters.update: ${error.message}`);
  // Replace resource types if provided
  if (Array.isArray(resource_type_ids)) {
    await setChapterResourceTypes(id, resource_type_ids);
  }
  return data;
}

export async function deleteChapter(id) {
  if (!client) return false;
  const { error } = await client.from("chapters").delete().eq("id", id);
  if (error) throw new Error(`Supabase chapters.delete: ${error.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// Master Data: Topics
// ---------------------------------------------------------------------------
export async function listTopics({ chapter_id } = {}) {
  if (!client) return [];
  let query = client.from("topics").select("*").order("sort_order");
  if (chapter_id) query = query.eq("chapter_id", chapter_id);
  const { data, error } = await query;
  if (error) throw new Error(`Supabase topics.list: ${error.message}`);
  return data;
}

export async function createTopic({ chapter_id, name, number, description, sort_order = 0 }) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("topics").insert({ chapter_id, name, number, description, sort_order }).select().single();
  if (error) throw new Error(`Supabase topics.create: ${error.message}`);
  return data;
}

export async function updateTopic(id, { name, number, description, sort_order, active }) {
  if (!client) return null;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (number !== undefined) patch.number = number;
  if (description !== undefined) patch.description = description;
  if (sort_order !== undefined) patch.sort_order = sort_order;
  if (active !== undefined) patch.active = active;
  const { data, error } = await client.from("topics").update(patch).eq("id", id).select().single();
  if (error) throw new Error(`Supabase topics.update: ${error.message}`);
  return data;
}

export async function deleteTopic(id) {
  if (!client) return false;
  const { error } = await client.from("topics").delete().eq("id", id);
  if (error) throw new Error(`Supabase topics.delete: ${error.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// Master Data: Question Levels
// ---------------------------------------------------------------------------
export async function listQuestionLevels() {
  if (!client) return [];
  const { data, error } = await client.from("question_levels").select("*").order("sort_order");
  if (error) throw new Error(`Supabase question_levels.list: ${error.message}`);
  return data;
}

export async function createQuestionLevel({ code, name, color, icon, sort_order = 0 }) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("question_levels").insert({ code, name, color, icon, sort_order }).select().single();
  if (error) throw new Error(`Supabase question_levels.create: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Master Data: Exam Types
// ---------------------------------------------------------------------------
export async function listExamTypes() {
  if (!client) return [];
  const { data, error } = await client.from("exam_types").select("*").order("sort_order");
  if (error) throw new Error(`Supabase exam_types.list: ${error.message}`);
  return data;
}

export async function createExamType({ name, category, description, sort_order = 0 }) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("exam_types").insert({ name, category, description, sort_order }).select().single();
  if (error) throw new Error(`Supabase exam_types.create: ${error.message}`);
  return data;
}

export async function updateExamType(id, { name, category, description, sort_order, active }) {
  if (!client) return null;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (category !== undefined) patch.category = category;
  if (description !== undefined) patch.description = description;
  if (sort_order !== undefined) patch.sort_order = sort_order;
  if (active !== undefined) patch.active = active;
  const { data, error } = await client.from("exam_types").update(patch).eq("id", id).select().single();
  if (error) throw new Error(`Supabase exam_types.update: ${error.message}`);
  return data;
}

export async function deleteExamType(id) {
  if (!client) return false;
  const { error } = await client.from("exam_types").delete().eq("id", id);
  if (error) throw new Error(`Supabase exam_types.delete: ${error.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// Master Data: Resource Types
// ---------------------------------------------------------------------------
export async function listResourceTypes() {
  if (!client) return [];
  const { data, error } = await client.from("resource_types").select("*").order("sort_order");
  if (error) throw new Error(`Supabase resource_types.list: ${error.message}`);
  return data;
}

export async function createResourceType({ name, code, description, sort_order = 0 }) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("resource_types").insert({ name, code, description, sort_order }).select().single();
  if (error) throw new Error(`Supabase resource_types.create: ${error.message}`);
  return data;
}

export async function updateResourceType(id, { name, code, description, sort_order, active }) {
  if (!client) return null;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (code !== undefined) patch.code = code;
  if (description !== undefined) patch.description = description;
  if (sort_order !== undefined) patch.sort_order = sort_order;
  if (active !== undefined) patch.active = active;
  const { data, error } = await client.from("resource_types").update(patch).eq("id", id).select().single();
  if (error) throw new Error(`Supabase resource_types.update: ${error.message}`);
  return data;
}

export async function deleteResourceType(id) {
  if (!client) return false;
  const { error } = await client.from("resource_types").delete().eq("id", id);
  if (error) throw new Error(`Supabase resource_types.delete: ${error.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// Tags: distinct tags across all questions
// ---------------------------------------------------------------------------
export async function listDistinctTags() {
  if (!client) return [];
  const { data, error } = await client.from("questions").select("tags");
  if (error) throw new Error(`Supabase tags.list: ${error.message}`);
  const tagSet = new Set();
  for (const row of data || []) {
    if (Array.isArray(row.tags)) {
      for (const t of row.tags) tagSet.add(t);
    }
  }
  return [...tagSet].sort();
}

// ---------------------------------------------------------------------------
// Master Data: Languages
// ---------------------------------------------------------------------------
export async function listLanguages() {
  if (!client) return [];
  const { data, error } = await client.from("languages").select("*").order("name");
  if (error) throw new Error(`Supabase languages.list: ${error.message}`);
  return data;
}

export async function createLanguage({ code, name, native_name }) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("languages").insert({ code, name, native_name }).select().single();
  if (error) throw new Error(`Supabase languages.create: ${error.message}`);
  return data;
}

export async function updateLanguage(id, { code, name, native_name, active }) {
  if (!client) return null;
  const patch = {};
  if (code !== undefined) patch.code = code;
  if (name !== undefined) patch.name = name;
  if (native_name !== undefined) patch.native_name = native_name;
  if (active !== undefined) patch.active = active;
  const { data, error } = await client.from("languages").update(patch).eq("id", id).select().single();
  if (error) throw new Error(`Supabase languages.update: ${error.message}`);
  return data;
}

export async function deleteLanguage(id) {
  if (!client) return false;
  const { error } = await client.from("languages").delete().eq("id", id);
  if (error) throw new Error(`Supabase languages.delete: ${error.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// Master Data: Schools
// ---------------------------------------------------------------------------
export async function listSchools() {
  if (!client) return [];
  const { data, error } = await client.from("schools").select("*").order("name");
  if (error) throw new Error(`Supabase schools.list: ${error.message}`);
  return data;
}

export async function createSchool({ name, code, district, city, state, board, type, contact_email, contact_phone, address }) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("schools").insert({ name, code, district, city, state, board, type, contact_email, contact_phone, address }).select().single();
  if (error) throw new Error(`Supabase schools.create: ${error.message}`);
  return data;
}

export async function updateSchool(id, { name, code, district, city, state, board, type, contact_email, contact_phone, address, active }) {
  if (!client) return null;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (code !== undefined) patch.code = code;
  if (district !== undefined) patch.district = district;
  if (city !== undefined) patch.city = city;
  if (state !== undefined) patch.state = state;
  if (board !== undefined) patch.board = board;
  if (type !== undefined) patch.type = type;
  if (contact_email !== undefined) patch.contact_email = contact_email;
  if (contact_phone !== undefined) patch.contact_phone = contact_phone;
  if (address !== undefined) patch.address = address;
  if (active !== undefined) patch.active = active;
  const { data, error } = await client.from("schools").update(patch).eq("id", id).select().single();
  if (error) throw new Error(`Supabase schools.update: ${error.message}`);
  return data;
}

export async function deleteSchool(id) {
  if (!client) return false;
  const { error } = await client.from("schools").delete().eq("id", id);
  if (error) throw new Error(`Supabase schools.delete: ${error.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// Questions CRUD
// ---------------------------------------------------------------------------
const rowToQuestion = (row) => ({
  id: row.id,
  bank_id: row.bank_id,
  created_by: row.created_by,
  standard_id: row.standard_id,
  subject_id: row.subject_id,
  chapter_id: row.chapter_id,
  topic_id: row.topic_id,
  type: row.type,
  exam_type_id: row.exam_type_id,
  language_id: row.language_id,
  difficulty: row.difficulty,
  level_id: row.level_id,
  exam_year: row.exam_year,
  content: row.content,
  explanation: row.explanation,
  image_url: row.image_url,
  marks: row.marks,
  negative_marks: row.negative_marks,
  time_limit_sec: row.time_limit_sec,
  quality_score: row.quality_score,
  status: row.status,
  sort_order: row.sort_order,
  family_id: row.family_id || null,
  translation_status: row.translation_status ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export async function createQuestion({
  bank_id, created_by, standard_id, subject_id, chapter_id, topic_id,
  type, exam_type_id, language_id, difficulty, level_id, exam_year,
  content, explanation, image_url, marks, negative_marks, time_limit_sec,
  tags, status, sort_order, family_id,
}) {
  if (!client) throw new Error("Supabase not configured");

  // Every question belongs to a family so papers can resolve translations.
  // If no family is provided, auto-create one and attach this question to it.
  let resolvedFamilyId = family_id || null;
  if (!resolvedFamilyId) {
    const family = await createQuestionFamily(created_by);
    resolvedFamilyId = family.id;
  }

  const { data, error } = await client.from("questions")
    .insert({
      bank_id: bank_id || null,
      created_by,
      standard_id: standard_id || null,
      subject_id: subject_id || null,
      chapter_id: chapter_id || null,
      topic_id: topic_id || null,
      type,
      exam_type_id: exam_type_id || null,
      language_id: language_id || null,
      difficulty: difficulty || null,
      level_id: level_id || null,
      exam_year: exam_year || null,
      content,
      explanation: explanation || null,
      image_url: image_url || null,
      marks: marks ?? 1,
      negative_marks: negative_marks ?? 0,
      time_limit_sec: time_limit_sec || null,
      tags: tags ?? [],
      status: status || "draft",
      sort_order: sort_order ?? 0,
      family_id: resolvedFamilyId,
    })
    .select()
    .single();
  if (error) throw new Error(`Supabase questions.create: ${error.message}`);
  return rowToQuestion(data);
}

export async function getQuestionById(id) {
  if (!client) return null;
  const { data, error } = await client.from("questions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Supabase questions.getById: ${error.message}`);
  return data ? rowToQuestion(data) : null;
}

// Shared filter application for the questions table. Works with both a
// Supabase query builder (list/count) and with raw rows (aggregate counts).
function applyQuestionFilters(query, filters = {}) {
  const {
    bank_id, standard_id, subject_id, chapter_id, topic_id,
    type, difficulty, level_id, exam_type_id, language_id, exam_year,
    status, tags, created_by,
    search, q,
    min_marks, max_marks, min_negative_marks, max_negative_marks,
    created_from, created_to, updated_from, updated_to,
    family_id,
  } = filters;

  if (family_id) query = query.eq("family_id", family_id);
  if (bank_id) query = query.eq("bank_id", bank_id);
  if (standard_id) query = query.eq("standard_id", standard_id);
  if (subject_id) query = query.eq("subject_id", subject_id);
  if (chapter_id) query = query.eq("chapter_id", chapter_id);
  if (topic_id) query = query.eq("topic_id", topic_id);
  if (type) query = query.eq("type", type);
  if (difficulty) query = query.eq("difficulty", difficulty);
  if (level_id) query = query.eq("level_id", level_id);
  if (exam_type_id) query = query.eq("exam_type_id", exam_type_id);
  if (language_id) query = query.eq("language_id", language_id);
  if (exam_year) query = query.eq("exam_year", Number(exam_year));
  if (status) query = query.eq("status", status);
  if (created_by) query = query.eq("created_by", created_by);
  if (tags && tags.length > 0) query = query.overlaps("tags", tags);

  // Note: full-text keyword search (`search`/`q`) is applied in JavaScript
  // inside listQuestions/countQuestions (see matchQuestionSearch) because
  // Supabase's JS client does not reliably chained-filter on JSON casts.

  // Scoring ranges.
  if (min_marks !== undefined && min_marks !== null && min_marks !== "") query = query.gte("marks", Number(min_marks));
  if (max_marks !== undefined && max_marks !== null && max_marks !== "") query = query.lte("marks", Number(max_marks));
  if (min_negative_marks !== undefined && min_negative_marks !== null && min_negative_marks !== "") query = query.gte("negative_marks", Number(min_negative_marks));
  if (max_negative_marks !== undefined && max_negative_marks !== null && max_negative_marks !== "") query = query.lte("negative_marks", Number(max_negative_marks));

  // Date ranges.
  if (created_from) query = query.gte("created_at", created_from);
  if (created_to) query = query.lte("created_at", created_to);
  if (updated_from) query = query.gte("updated_at", updated_from);
  if (updated_to) query = query.lte("updated_at", updated_to);

  return query;
}

// Apply the same filters to an in-memory array of already-mapped question rows.
// Kept as a reusable helper for non-SQL paths (e.g. the file-backed fallback).
function questionMatchesSearch(row, filters = {}) {
  const needle = ((filters.search ?? filters.q) || "").trim().toLowerCase();
  if (!needle) return true;
  const hay = JSON.stringify(row.content || {}).toLowerCase();
  return hay.includes(needle);
}

// Cap on rows fetched for in-memory search filtering — bounds memory/latency
// on very large question banks. Results are identical below the cap; above it,
// matching rows beyond the cap are not scanned (same search semantics, bounded).
const MAX_SEARCH_SCAN_ROWS = Number(process.env.QUESTION_SEARCH_SCAN_CAP) || 20000;

export async function listQuestions({ with_usage = false, ...filters } = {}) {
  if (!client) return [];
  const { limit = 50, offset = 0, ...rest } = filters;
  const hasSearch = Boolean((rest.search ?? rest.q)?.trim());
  let query = client.from("questions").select("*").order("sort_order").order("created_at", { ascending: false });
  query = applyQuestionFilters(query, rest);
  // Performance: page at the DB level when no in-memory filtering is needed —
  // previously EVERY matching row (full content JSON) was fetched and sliced
  // in JS. With a search term, fetch a bounded scan window instead of the
  // whole bank, then filter/paginate in memory as before.
  query = hasSearch
    ? query.range(0, MAX_SEARCH_SCAN_ROWS - 1)
    : query.range(offset, offset + limit - 1);
  const { data, error } = await query;
  if (error) throw new Error(`Supabase questions.list: ${error.message}`);

  let questions = data.map(rowToQuestion);
  if (hasSearch) {
    questions = questions.filter((q) => questionMatchesSearch(q, rest)).slice(offset, offset + limit);
  }
  if (with_usage) {
    const ids = questions.map((q) => q.id);
    if (ids.length > 0) {
      const { data: usage } = await client
        .from("question_usage_log")
        .select("question_id")
        .in("question_id", ids);
      const countMap = new Map();
      for (const row of usage || []) {
        countMap.set(row.question_id, (countMap.get(row.question_id) || 0) + 1);
      }
      for (const q of questions) q.usage_count = countMap.get(q.id) || 0;
    }
  }
  return questions;
}

export async function countQuestions(filters = {}) {
  if (!client) return 0;
  // When a full-text search is requested we must count filtered rows in JS,
  // so fetch (id, content) and filter locally.
  const hasSearch = Boolean((filters.search ?? filters.q)?.trim());
  let query = client.from("questions").select("id" + (hasSearch ? ", content" : ""), hasSearch ? undefined : { count: "exact", head: true });
  query = applyQuestionFilters(query, filters);
  if (hasSearch) {
    const { data, error } = await query.range(0, MAX_SEARCH_SCAN_ROWS - 1);
    if (error) throw new Error(`Supabase questions.count: ${error.message}`);
    return (data || []).filter((r) => questionMatchesSearch(r, filters)).length;
  }
  const { count, error } = await query;
  if (error) throw new Error(`Supabase questions.count: ${error.message}`);
  return count ?? 0;
}

// Aggregate question counts grouped by each hierarchy level, honoring the given
// (partial) filters so dropdowns can show live per-item totals. Returns:
//   { by_standard: [{id, name, count}], by_subject: [...], by_chapter: [...], by_topic: [...] }
export async function questionAggregateCounts(filters = {}) {
  if (!client) {
    return { by_standard: [], by_subject: [], by_chapter: [], by_topic: [] };
  }
  const picks = ["standard_id", "subject_id", "chapter_id", "topic_id"];
  const includes = filters.include?.split(",")?.map((s) => s.trim()).filter(Boolean) ?? ["standard", "subject", "chapter", "topic"];
  const out = {};
  for (const key of picks) {
    const label = key.replace("_id", "");
    if (!includes.includes(label)) continue;
    let query = client.from("questions").select(key, { count: "exact" });
    // Do not apply the filter for the dimension we are grouping by.
    const dimFilters = { ...filters };
    delete dimFilters[key];
    delete dimFilters.include;
    query = applyQuestionFilters(query, dimFilters);
    query = query.not(key, "is", null);
    const { data, error } = await query;
    if (error) throw new Error(`Supabase questions.aggregate.${key}: ${error.message}`);

    const counts = new Map();
    for (const row of data || []) {
      if (!row[key]) continue;
      counts.set(row[key], (counts.get(row[key]) || 0) + 1);
    }
    out["by_" + label] = Array.from(counts.entries()).map(([id, count]) => ({ id, count }));
  }
  return out;
}

export async function updateQuestion(id, patch) {
  if (!client) return null;
  const dbPatch = {};
  const fieldMap = {
    bank_id: "bank_id", standard_id: "standard_id", subject_id: "subject_id",
    chapter_id: "chapter_id", topic_id: "topic_id", type: "type",
    exam_type_id: "exam_type_id", language_id: "language_id", difficulty: "difficulty",
    level_id: "level_id", exam_year: "exam_year", content: "content",
    explanation: "explanation", image_url: "image_url", marks: "marks",
    negative_marks: "negative_marks", time_limit_sec: "time_limit_sec",
    tags: "tags", status: "status", sort_order: "sort_order",
  };
  for (const [key, col] of Object.entries(fieldMap)) {
    if (patch[key] !== undefined) dbPatch[col] = patch[key];
  }
  if (Object.keys(dbPatch).length === 0) return getQuestionById(id);
  const { error } = await client.from("questions").update(dbPatch).eq("id", id);
  if (error) throw new Error(`Supabase questions.update: ${error.message}`);
  return getQuestionById(id);
}

export async function deleteQuestion(id) {
  if (!client) return false;
  const { error } = await client.from("questions").delete().eq("id", id);
  if (error) throw new Error(`Supabase questions.delete: ${error.message}`);
  return true;
}

export async function duplicateQuestion(id, createdBy) {
  const original = await getQuestionById(id);
  if (!original) return null;
  const { id: _omit, created_at, updated_at, quality_score, ...rest } = original;
  return createQuestion({ ...rest, created_by: createdBy, status: "draft" });
}

// ---------------------------------------------------------------------------
// Question Options
// ---------------------------------------------------------------------------
export async function listQuestionOptions(questionId) {
  if (!client) return [];
  const { data, error } = await client.from("question_options")
    .select("*").eq("question_id", questionId).order("sort_order");
  if (error) throw new Error(`Supabase options.list: ${error.message}`);
  return data;
}

export async function createQuestionOption({ question_id, label, content, is_correct, sort_order }) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("question_options")
    .insert({ question_id, label, content, is_correct: is_correct ?? false, sort_order: sort_order ?? 0 })
    .select().single();
  if (error) throw new Error(`Supabase options.create: ${error.message}`);
  return data;
}

export async function updateQuestionOption(id, patch) {
  if (!client) return null;
  const { data, error } = await client.from("question_options")
    .update(patch).eq("id", id).select().single();
  if (error) throw new Error(`Supabase options.update: ${error.message}`);
  return data;
}

export async function deleteQuestionOption(id) {
  if (!client) return false;
  const { error } = await client.from("question_options").delete().eq("id", id);
  if (error) throw new Error(`Supabase options.delete: ${error.message}`);
  return true;
}

export async function deleteQuestionOptionsByQuestion(questionId) {
  if (!client) return false;
  const { error } = await client.from("question_options").delete().eq("question_id", questionId);
  if (error) throw new Error(`Supabase options.deleteByQuestion: ${error.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// Question Payloads
// ---------------------------------------------------------------------------
export async function getQuestionPayload(questionId) {
  if (!client) return null;
  const { data, error } = await client.from("question_payloads")
    .select("*").eq("question_id", questionId).maybeSingle();
  if (error) throw new Error(`Supabase payload.get: ${error.message}`);
  return data;
}

export async function upsertQuestionPayload(questionId, payload) {
  if (!client) return null;
  const { data, error } = await client.from("question_payloads")
    .upsert({ question_id: questionId, payload }, { onConflict: "question_id" })
    .select().single();
  if (error) throw new Error(`Supabase payload.upsert: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Question Edit History
// ---------------------------------------------------------------------------
export async function logQuestionEdit({ question_id, edited_by, field_changed, old_value, new_value, change_summary }) {
  if (!client) return;
  const { error } = await client.from("question_edit_history")
    .insert({ question_id, edited_by, field_changed, old_value, new_value, change_summary });
  if (error) console.error(`Supabase edit_history.log: ${error.message}`);
}

export async function getQuestionEditHistory(questionId, limit = 50) {
  if (!client) return [];
  const { data, error } = await client.from("question_edit_history")
    .select("*").eq("question_id", questionId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Supabase edit_history.list: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Question Usage History
// ---------------------------------------------------------------------------
export async function logQuestionUsage({ question_id, test_id, used_by, school_id, class_name, usage_type, student_count }) {
  if (!client) return;
  const { error } = await client.from("question_usage_log")
    .insert({ question_id, test_id, used_by, school_id, class_name, usage_type, student_count });
  if (error) console.error(`Supabase usage.log: ${error.message}`);
}

export async function getQuestionUsageHistory(questionId) {
  if (!client) return [];
  const { data, error } = await client.from("question_usage_log")
    .select("*").eq("question_id", questionId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Supabase usage.list: ${error.message}`);
  return data;
}

export async function getQuestionUsageSummary(questionId) {
  if (!client) return { total: 0, teachers: [], schools: [] };
  const { data: logs, error } = await client.from("question_usage_log")
    .select("*").eq("question_id", questionId);
  if (error) throw new Error(`Supabase usage.summary: ${error.message}`);
  const total = logs.length;
  const teacherMap = {};
  const schoolMap = {};
  for (const log of logs) {
    if (log.used_by) teacherMap[log.used_by] = (teacherMap[log.used_by] || 0) + 1;
    if (log.school_id) schoolMap[log.school_id] = (schoolMap[log.school_id] || 0) + 1;
  }
  return { total, teachers: Object.entries(teacherMap).map(([id, count]) => ({ id, count })), schools: Object.entries(schoolMap).map(([id, count]) => ({ id, count })) };
}

// ---------------------------------------------------------------------------
// Question Performance
// ---------------------------------------------------------------------------
export async function getQuestionPerformance(questionId) {
  if (!client) return null;
  const { data, error } = await client.from("question_performance")
    .select("*").eq("question_id", questionId).maybeSingle();
  if (error) throw new Error(`Supabase performance.get: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Analytics (dashboard aggregations)
// ---------------------------------------------------------------------------
function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function weekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

async function usedQuestionIds() {
  const { data, error } = await client.from("question_usage_log").select("question_id");
  if (error) throw new Error(`Supabase analytics.usedIds: ${error.message}`);
  return [...new Set((data ?? []).map((r) => r.question_id))];
}

export async function analyticsOverview() {
  if (!client) {
    return { total: 0, published: 0, drafts: 0, archived: 0, total_usage: 0, used_questions: 0, unused_questions: 0, avg_success_rate: 0, most_used: null };
  }
  const countByStatus = async (status) => {
    const { count, error } = await client.from("questions")
      .select("id", { count: "exact", head: true }).eq("status", status);
    if (error) throw new Error(`Supabase analytics.count: ${error.message}`);
    return count ?? 0;
  };
  const totalQ = await client.from("questions").select("id", { count: "exact", head: true });
  if (totalQ.error) throw new Error(`Supabase analytics.total: ${totalQ.error.message}`);
  const total = totalQ.count ?? 0;
  const [published, drafts, archived] = await Promise.all([
    countByStatus("published"),
    countByStatus("draft"),
    countByStatus("archived"),
  ]);
  const { count: usageCount, error: usageErr } = await client.from("question_usage_log")
    .select("id", { count: "exact", head: true });
  if (usageErr) throw new Error(`Supabase analytics.usage: ${usageErr.message}`);
  const { data: perfRows, error: perfErr } = await client.from("question_performance").select("success_rate");
  if (perfErr) throw new Error(`Supabase analytics.perf: ${perfErr.message}`);
  const avgSuccess = (perfRows ?? []).length
    ? (perfRows ?? []).reduce((acc, p) => acc + (p?.success_rate ?? 0), 0) / perfRows.length
    : 0;
  const usedIds = await usedQuestionIds();
  const usageMap = {};
  const { data: usageRows, error: usageRowsErr } = await client.from("question_usage_log").select("question_id");
  if (usageRowsErr) throw new Error(`Supabase analytics.usedMap: ${usageRowsErr.message}`);
  for (const r of usageRows ?? []) usageMap[r.question_id] = (usageMap[r.question_id] || 0) + 1;
  let mostUsedId = null;
  let mostUsedCount = 0;
  for (const [id, c] of Object.entries(usageMap)) if (c > mostUsedCount) { mostUsedCount = c; mostUsedId = id; }
  let mostUsed = null;
  if (mostUsedId) {
    const q = await getQuestionById(mostUsedId);
    if (q) mostUsed = { ...q, usage_count: mostUsedCount };
  }
  return {
    total,
    published,
    drafts,
    archived,
    total_usage: usageCount ?? 0,
    used_questions: usedIds.length,
    unused_questions: Math.max(0, total - usedIds.length),
    avg_success_rate: Math.round(avgSuccess * 100) / 100,
    most_used: mostUsed,
  };
}

export async function analyticsMostUsed(limit = 10) {
  if (!client) return [];
  const { data, error } = await client.from("question_usage_log").select("question_id");
  if (error) throw new Error(`Supabase analytics.mostUsed: ${error.message}`);
  const usageMap = {};
  for (const r of data ?? []) usageMap[r.question_id] = (usageMap[r.question_id] || 0) + 1;
  const sorted = Object.entries(usageMap).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const out = [];
  for (const [id, count] of sorted) {
    const q = await getQuestionById(id);
    if (q) out.push({ ...q, usage_count: count });
  }
  return out;
}

export async function analyticsUnused(limit = 25) {
  if (!client) return [];
  const used = new Set(await usedQuestionIds());
  const questions = await listQuestions({ limit: 10000 });
  return questions.filter((q) => !used.has(q.id)).slice(0, limit);
}

export async function analyticsBySchool() {
  if (!client) return [];
  const { data, error } = await client.from("question_usage_log").select("school_id, class_name");
  if (error) throw new Error(`Supabase analytics.bySchool: ${error.message}`);
  const map = {};
  for (const r of data ?? []) {
    if (!r.school_id) continue;
    map[r.school_id] = map[r.school_id] || { school_id: r.school_id, usage_count: 0, class_names: new Set() };
    map[r.school_id].usage_count += 1;
    if (r.class_name) map[r.school_id].class_names.add(r.class_name);
  }
  const ids = Object.keys(map);
  let names = {};
  if (ids.length) {
    const { data: schools, error: se } = await client.from("schools").select("id, name").in("id", ids);
    if (!se) names = Object.fromEntries((schools ?? []).map((s) => [s.id, s.name]));
  }
  return Object.values(map)
    .map((m) => ({
      school_id: m.school_id,
      school_name: names[m.school_id] || "Unknown school",
      usage_count: m.usage_count,
      class_names: [...m.class_names],
    }))
    .sort((a, b) => b.usage_count - a.usage_count);
}

export async function analyticsByTeacher() {
  if (!client) return [];
  const { data, error } = await client.from("question_usage_log").select("used_by");
  if (error) throw new Error(`Supabase analytics.byTeacher: ${error.message}`);
  const map = {};
  for (const r of data ?? []) if (r.used_by) map[r.used_by] = (map[r.used_by] || 0) + 1;
  const ids = Object.keys(map);
  const userMap = {};
  if (ids.length) {
    const users = await listUsers();
    for (const u of users) if (u) userMap[u.id] = u.name || u.email;
  }
  return Object.entries(map)
    .map(([id, count]) => ({ teacher_id: id, teacher_name: userMap[id] || "Unknown teacher", usage_count: count }))
    .sort((a, b) => b.usage_count - a.usage_count);
}

export async function analyticsOverTime() {
  if (!client) return { daily: [], weekly: [], monthly: [] };
  const { data, error } = await client.from("question_usage_log").select("created_at");
  if (error) throw new Error(`Supabase analytics.overTime: ${error.message}`);
  const dailyMap = {};
  for (const r of data ?? []) {
    const d = dateKey(r.created_at);
    dailyMap[d] = (dailyMap[d] || 0) + 1;
  }
  const daily = Object.entries(dailyMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));
  const weeklyMap = {};
  const monthlyMap = {};
  for (const { date, count } of daily) {
    const wk = weekKey(date);
    weeklyMap[wk] = (weeklyMap[wk] || 0) + count;
    const mo = date.slice(0, 7);
    monthlyMap[mo] = (monthlyMap[mo] || 0) + count;
  }
  const weekly = Object.entries(weeklyMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));
  const monthly = Object.entries(monthlyMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));
  return { daily, weekly, monthly };
}

export async function analyticsPerformance() {
  if (!client) {
    return { by_difficulty: [], by_subject: [], overall: { attempts: 0, success_rate: 0 } };
  }
  const questions = await listQuestions({ limit: 10000 });
  const qById = new Map(questions.map((q) => [q.id, q]));
  const { data: rows, error } = await client.from("question_performance").select("*");
  if (error) throw new Error(`Supabase analytics.performance: ${error.message}`);
  const diffMap = {};
  const subjMap = {};
  let totalAttempts = 0;
  let totalCorrect = 0;
  for (const r of rows ?? []) {
    const q = qById.get(r.question_id);
    totalAttempts += r.total_attempts || 0;
    totalCorrect += r.correct_count || 0;
    if (!q) continue;
    const diff = q.difficulty || "not-set";
    diffMap[diff] = diffMap[diff] || { difficulty: diff, attempts: 0, correct: 0 };
    diffMap[diff].attempts += r.total_attempts || 0;
    diffMap[diff].correct += r.correct_count || 0;
    const subj = q.subject_id || "none";
    subjMap[subj] = subjMap[subj] || { subject_id: subj, attempts: 0, correct: 0 };
    subjMap[subj].attempts += r.total_attempts || 0;
    subjMap[subj].correct += r.correct_count || 0;
  }
  const withRate = (acc) =>
    acc.map((x) => ({ ...x, success_rate: x.attempts ? Math.round((x.correct / x.attempts) * 10000) / 100 : 0 }));
  const subjIds = Object.keys(subjMap);
  let subjNames = {};
  if (subjIds.length) {
    const { data: subs, error: se } = await client.from("subjects").select("id, name").in("id", subjIds);
    if (!se) subjNames = Object.fromEntries((subs ?? []).map((s) => [s.id, s.name]));
  }
  const bySubject = withRate(Object.values(subjMap))
    .map((x) => ({ ...x, subject_name: subjNames[x.subject_id] || "No subject" }))
    .sort((a, b) => b.attempts - a.attempts);
  const byDifficulty = withRate(Object.values(diffMap)).sort((a, b) => b.attempts - a.attempts);
  return {
    by_difficulty: byDifficulty,
    by_subject: bySubject,
    overall: { attempts: totalAttempts, success_rate: totalAttempts ? Math.round((totalCorrect / totalAttempts) * 10000) / 100 : 0 },
  };
}

// ---------------------------------------------------------------------------
// Tests (Phase 7 — Test Creation)
// ---------------------------------------------------------------------------
const rowToTest = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  standard_id: row.standard_id,
  subject_id: row.subject_id,
  exam_type_id: row.exam_type_id,
  language_id: row.language_id,
  duration_min: row.duration_min,
  total_marks: row.total_marks,
  passing_marks: row.passing_marks,
  shuffle_questions: row.shuffle_questions,
  shuffle_options: row.shuffle_options,
  show_results: row.show_results,
  show_answers: row.show_answers,
  status: row.status,
  created_by: row.created_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

async function listTestQuestionRows(testId) {
  const { data, error } = await client.from("test_questions")
    .select("*").eq("test_id", testId).order("sort_order");
  if (error) throw new Error(`Supabase tests.questions: ${error.message}`);
  return data ?? [];
}

export async function listTests({ status, limit = 100, offset = 0 } = {}) {
  if (!client) return { tests: [], total: 0 };
  let query = client.from("tests").select(
    "id, title, description, standard_id, subject_id, exam_type_id, language_id, duration_min, total_marks, passing_marks, shuffle_questions, shuffle_options, show_results, show_answers, status, created_by, created_at, updated_at, test_questions(count)"
  ).order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  query = query.range(offset, offset + limit - 1);
  const { data, error } = await query;
  if (error) throw new Error(`Supabase tests.list: ${error.message}`);
  const tests = (data ?? []).map((r) => ({
    ...rowToTest(r),
    question_count: r.test_questions?.[0]?.count ?? 0,
  }));
  const { count, error: countErr } = await client.from("tests").select("id", { count: "exact", head: true });
  if (countErr) throw new Error(`Supabase tests.count: ${countErr.message}`);
  return { tests, total: count ?? 0 };
}

async function testByIdWithQuestions(id) {
  const { data, error } = await client.from("tests")
    .select("id, title, description, standard_id, subject_id, exam_type_id, language_id, duration_min, total_marks, passing_marks, shuffle_questions, shuffle_options, show_results, show_answers, status, created_by, created_at, updated_at")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(`Supabase tests.get: ${error.message}`);
  if (!data) return null;
  const rows = await listTestQuestionRows(id);
  const questions = [];
  for (const row of rows) {
    const q = await getQuestionById(row.question_id);
    if (!q) continue;
    const options = await listQuestionOptions(row.question_id);
    questions.push({ id: row.id, question_id: row.question_id, sort_order: row.sort_order, marks: row.marks, question: q, options });
  }
  return { test: rowToTest(data), questions };
}

export async function getTestById(id) {
  if (!client) return null;
  return testByIdWithQuestions(id);
}

export async function createTest({ title, description, standard_id, subject_id, exam_type_id, language_id, duration_min, total_marks, passing_marks, shuffle_questions, shuffle_options, show_results, show_answers, status, created_by, questionIds }) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("tests")
    .insert({
      title, description: description || null,
      standard_id: standard_id || null, subject_id: subject_id || null,
      exam_type_id: exam_type_id || null, language_id: language_id || null,
      duration_min: duration_min ?? 60,
      total_marks: total_marks ?? 0, passing_marks: passing_marks ?? 0,
      shuffle_questions: shuffle_questions ?? true, shuffle_options: shuffle_options ?? true,
      show_results: show_results ?? true, show_answers: show_answers ?? false,
      status: status || "draft", created_by,
    })
    .select().single();
  if (error) throw new Error(`Supabase tests.create: ${error.message}`);
  await replaceTestQuestions(data.id, questionIds ?? []);
  return testByIdWithQuestions(data.id);
}

export async function replaceTestQuestions(testId, questionIds) {
  if (!client) return;
  if (questionIds.length) {
    await client.from("test_questions").delete().eq("test_id", testId);
  }
  const rows = [];
  for (let i = 0; i < questionIds.length; i++) {
    rows.push({ test_id: testId, question_id: questionIds[i], sort_order: i, marks: 0 });
  }
  if (rows.length) {
    const { error } = await client.from("test_questions").insert(rows);
    if (error) throw new Error(`Supabase tests.questions.replace: ${error.message}`);
  }
}

export async function updateTest(id, patch, questionIds) {
  if (!client) return null;
  const dbPatch = {};
  const fieldMap = {
    title: "title", description: "description",
    standard_id: "standard_id", subject_id: "subject_id",
    exam_type_id: "exam_type_id", language_id: "language_id",
    duration_min: "duration_min", total_marks: "total_marks", passing_marks: "passing_marks",
    shuffle_questions: "shuffle_questions", shuffle_options: "shuffle_options",
    show_results: "show_results", show_answers: "show_answers", status: "status",
  };
  for (const [key, col] of Object.entries(fieldMap)) {
    if (patch[key] !== undefined) dbPatch[col] = patch[key];
  }
  if (Object.keys(dbPatch).length) {
    const { error } = await client.from("tests").update(dbPatch).eq("id", id);
    if (error) throw new Error(`Supabase tests.update: ${error.message}`);
  }
  if (questionIds !== undefined) {
    await replaceTestQuestions(id, questionIds);
  }
  return testByIdWithQuestions(id);
}

export async function deleteTest(id) {
  if (!client) return false;
  const { error } = await client.from("tests").delete().eq("id", id);
  if (error) throw new Error(`Supabase tests.delete: ${error.message}`);
  return true;
}

export async function countTests() {
  if (!client) return 0;
  const { count, error } = await client.from("tests").select("id", { count: "exact", head: true });
  if (error) throw new Error(`Supabase tests.count: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Question families & Papers — multi-language "same question paper" (Phase 8)
// ---------------------------------------------------------------------------

export async function createQuestionFamily(createdBy) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("question_families")
    .insert({ created_by: createdBy || null })
    .select().single();
  if (error) throw new Error(`Supabase question_families.create: ${error.message}`);
  return data;
}

export async function listQuestionVariants(familyId) {
  if (!client) return [];
  const { data, error } = await client.from("questions")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Supabase question_families.variants: ${error.message}`);
  const variants = [];
  for (const row of data || []) {
    const q = rowToQuestion(row);
    const options = await listQuestionOptions(q.id);
    const payload = await getQuestionPayload(q.id);
    variants.push({ ...q, options, payload: payload?.payload ?? null });
  }
  return variants;
}

/**
 * Batch variant loading for one or more families in a constant number of
 * queries (3 total regardless of family count) instead of the N+1
 * options/payload round trips per variant. Used by paper loading, set answer
 * keys and reports so large papers stop multiplying query counts.
 * Returns a Map<family_id, variants[]>; families with no rows map to [].
 */
export async function listQuestionVariantsByFamilies(familyIds) {
  const ids = [...new Set((familyIds ?? []).filter(Boolean))];
  const result = new Map(ids.map((id) => [id, []]));
  if (!client || ids.length === 0) return result;

  const { data, error } = await client.from("questions")
    .select("*")
    .in("family_id", ids)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Supabase question_families.variantsBatch: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return result;

  const questionIds = rows.map((r) => r.id);

  // Query 2: all options for every variant, grouped in memory.
  const optionsByQuestion = new Map();
  {
    const { data: optRows, error: optErr } = await client.from("question_options")
      .select("*")
      .in("question_id", questionIds)
      .order("sort_order");
    if (optErr) throw new Error(`Supabase options.listBatch: ${optErr.message}`);
    for (const row of optRows ?? []) {
      const list = optionsByQuestion.get(row.question_id) ?? [];
      list.push(row);
      optionsByQuestion.set(row.question_id, list);
    }
  }

  // Query 3: all payloads for every variant, grouped in memory.
  const payloadByQuestion = new Map();
  {
    const { data: payRows, error: payErr } = await client.from("question_payloads")
      .select("*")
      .in("question_id", questionIds);
    if (payErr) throw new Error(`Supabase payload.listBatch: ${payErr.message}`);
    for (const row of payRows ?? []) {
      payloadByQuestion.set(row.question_id, row);
    }
  }

  for (const row of rows) {
    const q = rowToQuestion(row);
    result.get(q.family_id)?.push({
      ...q,
      options: optionsByQuestion.get(q.id) ?? [],
      payload: payloadByQuestion.get(q.id)?.payload ?? null,
    });
  }
  return result;
}

// Link an existing question into a variant family. Creates the family when
// none exists (or the supplied id is unknown), so all variants share one family.
export async function linkQuestionToFamily(questionId, familyId) {
  if (!client) throw new Error("Supabase not configured");
  const question = await getQuestionById(questionId);
  if (!question) return null;
  let resolvedFamilyId = familyId || null;
  if (resolvedFamilyId) {
    const { error } = await client.from("question_families")
      .select("id").eq("id", resolvedFamilyId).maybeSingle();
    if (error) {
      const family = await createQuestionFamily(question.created_by);
      resolvedFamilyId = family.id;
    }
  } else {
    const family = await createQuestionFamily(question.created_by);
    resolvedFamilyId = family.id;
  }
  const { error } = await client.from("questions")
    .update({ family_id: resolvedFamilyId })
    .eq("id", questionId);
  if (error) throw new Error(`Supabase questions.link: ${error.message}`);
  const linked = await getQuestionById(questionId);
  if (!linked) return null;
  return { question: linked, family_id: linked.family_id };
}

const rowToPaper = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  standard_id: row.standard_id,
  subject_id: row.subject_id,
  exam_type_id: row.exam_type_id,
  duration_min: row.duration_min,
  total_marks: row.total_marks,
  status: row.status,
  blueprint: row.blueprint ?? null,
  created_by: row.created_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
  validated_at: row.validated_at ?? null,
  published_at: row.published_at ?? null,
  archived_at: row.archived_at ?? null,
});

async function listPaperFamilyRows(paperId) {
  // section_key arrives with migration 008; tolerate its absence pre-migration.
  const { data, error } = await client.from("paper_families")
    .select("*")
    .eq("paper_id", paperId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Supabase paper_families.list: ${error.message}`);
  return (data || []).map((row) => ({
    ...row,
    section_key: row.section_key ?? null,
    locked: row.locked ?? false,
  }));
}

export async function listPapers({ status, created_by, limit = 100, offset = 0 } = {}) {
  if (!client) return { papers: [], total: 0 };
  let query = client.from("papers").select(
    "id, title, description, standard_id, subject_id, exam_type_id, duration_min, total_marks, status, created_by, created_at, updated_at, paper_families(count)"
  ).order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (created_by) query = query.eq("created_by", created_by);
  query = query.range(offset, offset + limit - 1);
  const { data, error } = await query;
  if (error) throw new Error(`Supabase papers.list: ${error.message}`);
  const papers = (data ?? []).map((r) => ({
    ...rowToPaper(r),
    question_count: r.paper_families?.[0]?.count ?? 0,
  }));
  // Total count must honor the same filters as the page query so pagination
  // totals stay correct when callers filter by status or creator.
  let countQuery = client.from("papers").select("id", { count: "exact", head: true });
  if (status) countQuery = countQuery.eq("status", status);
  if (created_by) countQuery = countQuery.eq("created_by", created_by);
  const { count, error: countErr } = await countQuery;
  if (countErr) throw new Error(`Supabase papers.count: ${countErr.message}`);
  return { papers, total: count ?? 0 };
}

async function paperByIdWithFamilies(id) {
  const { data, error } = await client.from("papers")
    .select("id, title, description, standard_id, subject_id, exam_type_id, duration_min, total_marks, status, created_by, created_at, updated_at")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(`Supabase papers.get: ${error.message}`);
  if (!data) return null;
  const rows = await listPaperFamilyRows(id);
  // Performance: one batched fetch for ALL family variants (+options+payloads)
  // — 4 queries total instead of 2 per family (N+1 on large papers).
  const variantsByFamily = await listQuestionVariantsByFamilies(
    rows.map((r) => r.family_id).filter(Boolean)
  ).catch(() => new Map());
  const families = rows.map((row) => {
    let primary = null;
    let variants = [];
    const base = {
      id: row.id,
      family_id: row.family_id,
      sort_order: row.sort_order,
      marks: row.marks,
      section_key: row.section_key ?? null,
      locked: row.locked ?? false,
    };
    variants = variantsByFamily.get(row.family_id) ?? [];
    if (variants.length) {
      primary = variants.find((v) => v.language_id) || variants[0];
    }
    return { ...base, primary, variants };
  });
  return { paper: rowToPaper(data), families };
}

export async function getPaperById(id) {
  if (!client) return null;
  return paperByIdWithFamilies(id);
}

// --- Blueprint column graceful degradation -------------------------------
// Migration 008 (papers.blueprint, paper_families.section_key/locked,
// papers.sets) is applied manually via the Supabase SQL editor. Until it runs,
// PostgREST rejects unknown columns — so new-column writes fail loudly with a
// clear operator message, new-column reads return null + migrationRequired,
// and paper creation silently drops the blueprint instead of breaking CRUD.
function isMissingBlueprintColumn(error) {
  if (!error) return false;
  const msg = String(error.message || error);
  return error.code === "PGRST204" || /(blueprint|sets|section_key|locked)/i.test(msg) && /(column|schema cache)/i.test(msg);
}

// Migration 009 (questions.translation_status, papers.translations) degrades
// independently of 008 so each paste can be applied separately.
function isMissingTranslationColumn(error) {
  if (!error) return false;
  const msg = String(error.message || error);
  return error.code === "PGRST204" || /translation/i.test(msg) && /(column|schema cache)/i.test(msg);
}

export async function createPaper({
  title, description, standard_id, subject_id, exam_type_id,
  duration_min, total_marks, status, created_by, familyIds, blueprint,
}) {
  if (!client) throw new Error("Supabase not configured");
  let data, error;
  try {
    ({ data, error } = await client.from("papers")
      .insert({
        title,
        description: description || null,
        standard_id: standard_id || null,
        subject_id: subject_id || null,
        exam_type_id: exam_type_id || null,
        duration_min: duration_min ?? 120,
        total_marks: total_marks ?? 0,
        status: status || "draft",
        blueprint: blueprint ?? null,
        created_by,
      })
      .select().single());
  } catch (err) {
    // Older SDK surface: fallback insert without the blueprint column.
    if (isMissingBlueprintColumn(err)) {
      console.warn("papers.blueprint column missing — create paper without blueprint (apply migrations/008_paper_blueprints.sql)");
      ({ data, error } = await client.from("papers")
        .insert({
          title,
          description: description || null,
          standard_id: standard_id || null,
          subject_id: subject_id || null,
          exam_type_id: exam_type_id || null,
          duration_min: duration_min ?? 120,
          total_marks: total_marks ?? 0,
          status: status || "draft",
          created_by,
        })
        .select().single());
    } else {
      throw err;
    }
  }
  if (error && isMissingBlueprintColumn(error)) {
    console.warn("papers.blueprint column missing — create paper without blueprint (apply migrations/008_paper_blueprints.sql)");
    ({ data, error } = await client.from("papers")
      .insert({
        title,
        description: description || null,
        standard_id: standard_id || null,
        subject_id: subject_id || null,
        exam_type_id: exam_type_id || null,
        duration_min: duration_min ?? 120,
        total_marks: total_marks ?? 0,
        status: status || "draft",
        created_by,
      })
      .select().single());
  }
  if (error) throw new Error(`Supabase papers.create: ${error.message}`);
  await replacePaperFamilies(data.id, familyIds ?? []);
  return paperByIdWithFamilies(data.id);
}

/**
 * Replace the ordered family list of a paper. Accepts either:
 *   - string[] of family ids (marks 0, no section, unlocked — original behavior), or
 *   - { familyId, marks?, sectionKey?, locked? }[] entries (Paper Generator phases 3–5).
 * section_key/locked are dropped silently when migration 008 has not been
 * applied yet, so paper editing keeps working before the columns exist.
 */
export async function replacePaperFamilies(paperId, familyIds) {
  if (!client) return;
  await client.from("paper_families").delete().eq("paper_id", paperId);
  if (!familyIds.length) return;
  const rows = familyIds.map((entry, i) => {
    const familyId = typeof entry === "string" ? entry : entry?.familyId;
    const isObj = typeof entry === "object" && entry;
    const marks = isObj ? Number(entry.marks) || 0 : 0;
    const sectionKey =
      isObj && typeof entry.sectionKey === "string" && entry.sectionKey
        ? entry.sectionKey
        : null;
    const locked = Boolean(isObj && entry.locked);
    const row = {
      paper_id: paperId,
      family_id: familyId,
      sort_order: i,
      marks,
    };
    if (sectionKey) row.section_key = sectionKey;
    if (locked) row.locked = true;
    return row;
  });
  const { error } = await client.from("paper_families").insert(rows);
  if (error && isMissingBlueprintColumn(error) && rows.some((r) => "section_key" in r || "locked" in r)) {
    // Pre-migration: retry without section/lock assignments (marks/order kept).
    const retryRows = rows.map(({ section_key, locked, ...rest }) => rest);
    const { error: retryError } = await client.from("paper_families").insert(retryRows);
    if (retryError) throw new Error(`Supabase paper_families.replace: ${retryError.message}`);
    return;
  }
  if (error) throw new Error(`Supabase paper_families.replace: ${error.message}`);
}

export async function updatePaper(id, patch, familyIds) {
  if (!client) return null;
  const dbPatch = {};
  const fieldMap = {
    title: "title", description: "description",
    standard_id: "standard_id", subject_id: "subject_id",
    exam_type_id: "exam_type_id", duration_min: "duration_min",
    total_marks: "total_marks", status: "status",
    blueprint: "blueprint",
    translations: "translations",
  };
  for (const [key, col] of Object.entries(fieldMap)) {
    if (patch[key] !== undefined) dbPatch[col] = patch[key];
  }
  if (Object.keys(dbPatch).length) {
    const { error } = await client.from("papers").update(dbPatch).eq("id", id);
    if (error && isMissingBlueprintColumn(error) && dbPatch.blueprint !== undefined) {
      throw new Error(
        "Blueprint storage is not available: apply backend/migrations/008_paper_blueprints.sql in the Supabase SQL editor."
      );
    }
    if (error && isMissingTranslationColumn(error) && dbPatch.translations !== undefined) {
      throw new Error(
        "Translation storage is not available: apply backend/migrations/009_translation_states.sql in the Supabase SQL editor."
      );
    }
    if (error) throw new Error(`Supabase papers.update: ${error.message}`);
  }
  if (familyIds !== undefined) {
    await replacePaperFamilies(id, familyIds);
  }
  return paperByIdWithFamilies(id);
}

export async function deletePaper(id) {
  if (!client) return false;
  const { error } = await client.from("papers").delete().eq("id", id);
  if (error) throw new Error(`Supabase papers.delete: ${error.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// Paper Lifecycle Management (Paper Generator Phase 16)
// ---------------------------------------------------------------------------

// Migration 013 adds validated_at/published_at/archived_at. Before the columns
// exist these helpers degrade: status updates still work, timestamps are
// silently skipped.
function isMissingLifecycleColumn(error) {
  if (!error) return false;
  const msg = String(error.message || error);
  return (
    error.code === "PGRST204" ||
    (/(validated_at|published_at|archived_at)/i.test(msg) && /(column|schema cache)/i.test(msg))
  );
}

/**
 * Transition a paper's status and record the matching lifecycle timestamp.
 * `clear: [...]` nulls out the listed lifecycle columns (used when un-archiving
 * so the archived_at stamp is not misleading). Returns the updated paper (or
 * null on pre-migration degrade — the status update itself still succeeded).
 */
export async function transitionPaperStatus(paperId, status, { timestamp = "now()", clear = [] } = {}) {
  if (!client) return null;
  const statusPatch = { status };
  if (status === "validated") statusPatch.validated_at = timestamp;
  else if (status === "published") statusPatch.published_at = timestamp;
  else if (status === "archived") statusPatch.archived_at = timestamp;
  for (const key of clear) {
    if (["validated_at", "published_at", "archived_at"].includes(key)) statusPatch[key] = null;
  }

  const { error } = await client.from("papers").update(statusPatch).eq("id", paperId);
  if (error && isMissingLifecycleColumn(error)) {
    const { error: fallbackErr } = await client.from("papers").update({ status }).eq("id", paperId);
    if (fallbackErr) throw new Error(`Supabase papers.lifecycle.status: ${fallbackErr.message}`);
    return null;
  }
  if (error) throw new Error(`Supabase papers.lifecycle: ${error.message}`);
  return paperByIdWithFamilies(paperId);
}

/**
 * Create a duplicate of an existing paper (families, blueprint, translations)
 * as a new draft. Sets are NOT copied — the admin regenerates them.
 */
export async function duplicatePaper(sourcePaperId, createdBy) {
  if (!client) throw new Error("Supabase not configured");

  const source = await paperByIdWithFamilies(sourcePaperId);
  if (!source) return null;
  const bp = await getPaperBlueprint(sourcePaperId).catch(() => null);
  const setsData = await getPaperSets(sourcePaperId).catch(() => null);

  const patch = {
    title: `${source.paper.title} (copy)`,
    description: source.paper.description,
    standard_id: source.paper.standard_id,
    subject_id: source.paper.subject_id,
    exam_type_id: source.paper.exam_type_id,
    duration_min: source.paper.duration_min,
    total_marks: source.paper.total_marks,
    status: "draft",
    blueprint: bp?.blueprint ?? null,
    created_by: createdBy,
  };

  let insertData, insertErr;
  try {
    ({ data: insertData, error: insertErr } = await client.from("papers").insert(patch).select().single());
  } catch (err) {
    if (isMissingBlueprintColumn(err)) {
      ({ data: insertData, error: insertErr } = await client.from("papers")
        .insert({ ...patch, blueprint: undefined })
        .select().single());
    } else {
      throw err;
    }
  }
  if (insertErr && isMissingBlueprintColumn(insertErr)) {
    ({ data: insertData, error: insertErr } = await client.from("papers")
      .insert({ ...patch, blueprint: undefined })
      .select().single());
  }
  if (insertErr) throw new Error(`Supabase papers.duplicate.create: ${insertErr.message}`);

  const newId = insertData.id;

  const familyRows = source.families.map((f) => ({
    paper_id: newId,
    family_id: f.family_id,
    sort_order: Number(f.sort_order) || 0,
    marks: Number(f.marks) || 0,
    ...(f.section_key ? { section_key: f.section_key } : {}),
    ...(f.locked ? { locked: true } : {}),
  }));
  if (familyRows.length > 0) {
    const { error: famErr } = await client.from("paper_families").insert(familyRows);
    if (famErr && isMissingBlueprintColumn(famErr)) {
      const leanRows = familyRows.map(({ section_key, locked, ...rest }) => rest);
      const { error: leanErr } = await client.from("paper_families").insert(leanRows);
      if (leanErr) throw new Error(`Supabase papers.duplicate.families: ${leanErr.message}`);
    } else if (famErr) {
      throw new Error(`Supabase papers.duplicate.families: ${famErr.message}`);
    }
  }

  if (setsData?.translations) {
    await updatePaperTranslations(newId, setsData.translations).catch(() => {});
  }

  return paperByIdWithFamilies(newId);
}

export async function getPaperLanguages(id) {
  if (!client) return { languages: [], coverage: [] };
  const rows = await listPaperFamilyRows(id);
  const coverage = [];
  const languageSet = new Set();
  for (const row of rows) {
    try {
      const variants = await listQuestionVariants(row.family_id);
      const langs = variants.map((v) => v.language_id).filter(Boolean);
      langs.forEach((l) => languageSet.add(l));
      coverage.push({ family_id: row.family_id, languages: langs });
    } catch {
      coverage.push({ family_id: row.family_id, languages: [] });
    }
  }
  return { languages: [...languageSet], coverage };
}

export async function getPaperInLanguage(id, languageId) {
  if (!client) return null;
  const loaded = await paperByIdWithFamilies(id);
  if (!loaded) return null;
  const questions = [];
  const missingLangs = new Set();
  for (const fam of loaded.families) {
    let variant = (fam.variants || []).find((v) => v.language_id === languageId);
    if (!variant && fam.variants?.length) variant = fam.variants[0];
    if (variant) {
      questions.push({
        id: fam.id,
        family_id: fam.family_id,
        sort_order: fam.sort_order,
        marks: fam.marks || variant.marks,
        resolved_language_id: variant.language_id,
        question: variant,
      });
    } else {
      missingLangs.add(fam.family_id);
    }
  }
  return { paper: loaded.paper, questions, missing_families: [...missingLangs] };
}

// ---------------------------------------------------------------------------
// Paper blueprint (Paper Generator Phase 2)
// ---------------------------------------------------------------------------

/** Single-purpose read of just the paper + its blueprint (no family joins). */
export async function getPaperBlueprint(id) {
  if (!client) return null;
  let { data, error } = await client.from("papers")
    .select("id, title, description, standard_id, subject_id, exam_type_id, duration_min, total_marks, status, blueprint, created_by, created_at, updated_at")
    .eq("id", id).maybeSingle();
  if (error && isMissingBlueprintColumn(error)) {
    // Migration 008 not applied yet — degrade to blueprint-less read.
    ({ data, error } = await client.from("papers")
      .select("id, title, description, standard_id, subject_id, exam_type_id, duration_min, total_marks, status, created_by, created_at, updated_at")
      .eq("id", id).maybeSingle());
    if (error) throw new Error(`Supabase papers.blueprint.get: ${error.message}`);
    if (!data) return null;
    return { paper: rowToPaper(data), blueprint: null, migrationRequired: true };
  }
  if (error) throw new Error(`Supabase papers.blueprint.get: ${error.message}`);
  if (!data) return null;
  return { paper: rowToPaper(data), blueprint: data.blueprint ?? null, migrationRequired: false };
}

// ---------------------------------------------------------------------------
// Paper sets & randomization (Paper Generator Phase 7)
// ---------------------------------------------------------------------------

/** Read just the paper + its sets document (no family joins). */
export async function getPaperSets(id) {
  if (!client) return null;
  let { data, error } = await client.from("papers")
    .select("id, title, status, standard_id, subject_id, exam_type_id, duration_min, total_marks, sets, translations, created_by, created_at, updated_at")
    .eq("id", id).maybeSingle();
  if (error && isMissingBlueprintColumn(error)) {
    // The sets column ships with the same migration 008 paste; degrade the
    // read so the Sets page still renders with a migration hint.
    ({ data, error } = await client.from("papers")
      .select("id, title, status, standard_id, subject_id, exam_type_id, duration_min, total_marks, created_by, created_at, updated_at")
      .eq("id", id).maybeSingle());
    if (error) throw new Error(`Supabase papers.sets.get: ${error.message}`);
    if (!data) return null;
    return { paper: rowToPaper(data), sets: null, migrationRequired: true };
  }
  if (error) throw new Error(`Supabase papers.sets.get: ${error.message}`);
  if (!data) return null;
  return { paper: rowToPaper(data), sets: data.sets ?? null, translations: data.translations ?? null, migrationRequired: false };
}

/**
 * Persist the sets document. `null` clears all sets. Degrades gracefully
 * before migration 008 by surfacing an operator-facing error (the sets
 * feature has no meaningful fallback without storage).
 */
export async function updatePaperSets(id, sets) {
  if (!client) throw new Error("Supabase not configured");
  const { error } = await client.from("papers")
    .update({ sets: sets ?? null })
    .eq("id", id);
  if (error && isMissingBlueprintColumn(error)) {
    throw new Error(
      "Sets storage is not available: apply backend/migrations/008_paper_blueprints.sql in the Supabase SQL editor."
    );
  }
  if (error) throw new Error(`Supabase papers.sets.update: ${error.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// Multilingual Paper Engine (Paper Generator Phase 8)
// Logical question identity lives in question_families; each language variant
// is a normal questions row with its own language_id. No duplicate questions
// are created — a "translation" is just another variant of the same family.
// ---------------------------------------------------------------------------

/**
 * Per-language readiness doc for a paper. `null` clears it. Degrades with a
 * clear operator error before migration 009 (storage has no fallback).
 */
export async function updatePaperTranslations(id, translations) {
  if (!client) throw new Error("Supabase not configured");
  const { error } = await client.from("papers")
    .update({ translations: translations ?? null })
    .eq("id", id);
  if (error && isMissingTranslationColumn(error)) {
    throw new Error(
      "Translation storage is not available: apply backend/migrations/009_translation_states.sql in the Supabase SQL editor."
    );
  }
  if (error) throw new Error(`Supabase papers.translations.update: ${error.message}`);
  return true;
}

/**
 * Language-aware paper rendering. Variant choice per family, in priority
 * order: exact language → approved/reviewed variants of other languages
 * (substitution, flagged) → base-language variant (substitution, flagged) →
 * nothing (reported as missing). Never invents or renames questions; the
 * caller decides how to treat substituted/missing entries.
 *
 * mode "strict": substituted families are moved to `unresolved` — the paper
 * is NOT silently rendered with unrelated-language content. mode "substitute"
 * preserves the legacy print behavior (render best-available, flagged).
 */
export async function getPaperInLanguageStrict(id, languageId, { mode = "substitute" } = {}) {
  if (!client) return null;
  const loaded = await paperByIdWithFamilies(id);
  if (!loaded) return null;

  const order = { approved: 0, reviewed: 1, translated: 2, draft: 3 };
  const stateOf = (v) => v?.translation_status ?? "draft";

  // Per-language section instructions from the paper's translations doc.
  let sections = {};
  try {
    const stored = await getPaperSets(id); // returns translations too (cheap single-row read)
    sections = stored?.translations?.languages?.[languageId]?.sections ?? {};
  } catch {
    sections = {};
  }

  const questions = [];
  const unresolved = [];
  for (const fam of loaded.families) {
    const variants = fam.variants || [];
    const exact = variants.filter((v) => v.language_id === languageId);
    let variant = null;
    let substituted = false;

    if (exact.length > 0) {
      // Prefer the highest workflow state, then the newest row.
      variant = [...exact].sort(
        (a, b) => (order[stateOf(a)] ?? 3) - (order[stateOf(b)] ?? 3) ||
          String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
      )[0];
    } else if (variants.length > 0) {
      substituted = true;
      if (mode === "strict") {
        unresolved.push({
          family_id: fam.family_id,
          sort_order: fam.sort_order,
          reason: "translation_missing",
          available_languages: [...new Set(variants.map((v) => v.language_id).filter(Boolean))],
        });
        continue;
      }
      // Legacy substitution: best non-exact variant, never across families.
      variant = [...variants].sort(
        (a, b) => (order[stateOf(a)] ?? 3) - (order[stateOf(b)] ?? 3)
      )[0];
    } else {
      unresolved.push({
        family_id: fam.family_id,
        sort_order: fam.sort_order,
        reason: "no_variants",
        available_languages: [],
      });
      continue;
    }

    questions.push({
      id: fam.id,
      family_id: fam.family_id,
      sort_order: fam.sort_order,
      marks: fam.marks || variant.marks,
      resolved_language_id: variant.language_id,
      substituted,
      translation_status: stateOf(variant),
      section_key: fam.section_key ?? null,
      question: variant,
    });
  }

  return {
    paper: loaded.paper,
    questions,
    unresolved,
    requested_language_id: languageId,
    mode,
    complete: unresolved.length === 0 && questions.every((q) => !q.substituted),
  };
}

/** Set the workflow state on one question variant (language version). */
export async function updateQuestionTranslationStatus(id, status) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("questions")
    .update({ translation_status: status })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error && isMissingTranslationColumn(error)) {
    throw new Error(
      "Translation state storage is not available: apply backend/migrations/009_translation_states.sql in the Supabase SQL editor."
    );
  }
  if (error) throw new Error(`Supabase questions.translation_status.update: ${error.message}`);
  return data ? rowToQuestion(data) : null;
}

// ---------------------------------------------------------------------------
// Separate Language Paper Generation (Paper Generator Phase 9)
// Storage layer for derived per-language paper artifacts. The generation
// logic itself lives in paperService.buildLanguagePaperSnapshot (pure); these
// functions only persist/read the snapshots. Migration 010 degrades
// independently of 008/009 so each paste can be applied separately.
// ---------------------------------------------------------------------------

function isMissingLanguagePaperTable(error) {
  if (!error) return false;
  const msg = String(error.message || error);
  return (
    error.code === "PGRST204" ||
    (/paper_languages/i.test(msg) && /(relation|table|does not exist|schema cache)/i.test(msg))
  );
}

function languagePaperRow(row) {
  return {
    id: row.id,
    master_paper_id: row.master_paper_id,
    language_id: row.language_id,
    version: row.version,
    set_key: row.set_key ?? null,
    status: row.status,
    generated_by: row.generated_by ?? null,
    generated_at: row.generated_at,
    updated_at: row.updated_at,
    snapshot: row.snapshot ?? null,
  };
}

/** All generated language paper versions of one master paper, newest first. */
export async function listLanguagePapers(masterPaperId) {
  if (!client) return [];
  const { data, error } = await client.from("paper_languages")
    .select("*")
    .eq("master_paper_id", masterPaperId)
    .order("language_id", { ascending: true })
    .order("version", { ascending: false });
  if (error && isMissingLanguagePaperTable(error)) return [];
  if (error) throw new Error(`Supabase paper_languages.list: ${error.message}`);
  return (data || []).map(languagePaperRow);
}

/** Insert one generated language paper. Returns the stored row. */
export async function createLanguagePaper({
  master_paper_id,
  language_id,
  version,
  set_key,
  status,
  generated_by,
  snapshot,
}) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("paper_languages")
    .insert({
      master_paper_id,
      language_id,
      version: version ?? 1,
      set_key: set_key ?? null,
      status: status || "generated",
      generated_by: generated_by || null,
      snapshot: snapshot ?? null,
    })
    .select()
    .single();
  if (error && isMissingLanguagePaperTable(error)) {
    throw new Error(
      "Language paper storage is not available: apply backend/migrations/010_language_papers.sql in the Supabase SQL editor."
    );
  }
  if (error) throw new Error(`Supabase paper_languages.create: ${error.message}`);
  return languagePaperRow(data);
}

/** One stored language paper artifact (snapshot + metadata, no content joins). */
export async function getLanguagePaperData(masterPaperId, version) {
  if (!client) return null;
  const { data, error } = await client.from("paper_languages")
    .select("*")
    .eq("master_paper_id", masterPaperId)
    .eq("version", version)
    .maybeSingle();
  if (error && isMissingLanguagePaperTable(error)) {
    throw new Error(
      "Language paper storage is not available: apply backend/migrations/010_language_papers.sql in the Supabase SQL editor."
    );
  }
  if (error) throw new Error(`Supabase paper_languages.get: ${error.message}`);
  return data ? languagePaperRow(data) : null;
}

/** Update status (draft | generated | approved | archived). */
export async function updateLanguagePaperStatus(masterPaperId, version, status) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("paper_languages")
    .update({ status })
    .eq("master_paper_id", masterPaperId)
    .eq("version", version)
    .select()
    .maybeSingle();
  if (error && isMissingLanguagePaperTable(error)) {
    throw new Error(
      "Language paper storage is not available: apply backend/migrations/010_language_papers.sql in the Supabase SQL editor."
    );
  }
  if (error) throw new Error(`Supabase paper_languages.status: ${error.message}`);
  return data ? languagePaperRow(data) : null;
}

/** Delete one language paper version. */
export async function deleteLanguagePaper(masterPaperId, version) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("paper_languages")
    .delete()
    .eq("master_paper_id", masterPaperId)
    .eq("version", version)
    .select()
    .maybeSingle();
  if (error && isMissingLanguagePaperTable(error)) {
    throw new Error(
      "Language paper storage is not available: apply backend/migrations/010_language_papers.sql in the Supabase SQL editor."
    );
  }
  if (error) throw new Error(`Supabase paper_languages.delete: ${error.message}`);
  return data ? languagePaperRow(data) : null;
}

// ---------------------------------------------------------------------------
// Paper template repository (Paper Generator Phase 11)
// ---------------------------------------------------------------------------
function isMissingPaperTemplatesTable(error) {
  if (!error) return false;
  const msg = String(error.message || error);
  return (
    error.code === "PGRST204" ||
    (/paper_templates/i.test(msg) && /(relation|table|does not exist|schema cache)/i.test(msg))
  );
}

function paperTemplateRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    kind: row.kind,
    config: row.config ?? {},
    is_default: Boolean(row.is_default),
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const PAPER_TEMPLATES_MIGRATION_HINT =
  "Paper template storage is not available: apply backend/migrations/011_paper_templates.sql in the Supabase SQL editor.";

/** All saved paper templates, newest first. Optional kind filter. */
export async function listPaperTemplates(kind) {
  if (!client) return [];
  let query = client.from("paper_templates").select("*").order("created_at", { ascending: false });
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query;
  if (error && isMissingPaperTemplatesTable(error)) return [];
  if (error) throw new Error(`Supabase paper_templates.list: ${error.message}`);
  return (data || []).map(paperTemplateRow);
}

/** The flagged default template for a kind (null when none is flagged). */
export async function getDefaultPaperTemplate(kind) {
  if (!client) return null;
  const { data, error } = await client.from("paper_templates")
    .select("*")
    .eq("kind", kind)
    .eq("is_default", true)
    .maybeSingle();
  if (error && isMissingPaperTemplatesTable(error)) return null;
  if (error) throw new Error(`Supabase paper_templates.default: ${error.message}`);
  return data ? paperTemplateRow(data) : null;
}

/** One saved template by id. */
export async function getPaperTemplate(id) {
  if (!client) return null;
  const { data, error } = await client.from("paper_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error && isMissingPaperTemplatesTable(error)) return null;
  if (error) throw new Error(`Supabase paper_templates.get: ${error.message}`);
  return data ? paperTemplateRow(data) : null;
}

/** Insert one saved template. Returns the stored row. */
export async function createPaperTemplate({ name, description, kind, config, is_default, created_by }) {
  if (!client) throw new Error("Supabase not configured");
  if (is_default) {
    await client.from("paper_templates")
      .update({ is_default: false })
      .eq("kind", kind ?? "single");
  }
  const { data, error } = await client.from("paper_templates")
    .insert({
      name,
      description: description ?? null,
      kind: kind || "single",
      config: config ?? {},
      is_default: Boolean(is_default),
      created_by: created_by || null,
    })
    .select()
    .single();
  if (error && isMissingPaperTemplatesTable(error)) {
    throw new Error(PAPER_TEMPLATES_MIGRATION_HINT);
  }
  if (error) throw new Error(`Supabase paper_templates.create: ${error.message}`);
  return paperTemplateRow(data);
}

/** Patch one saved template (name/description/kind/config/is_default). */
export async function updatePaperTemplate(id, patch) {
  if (!client) throw new Error("Supabase not configured");
  if (patch.kind && patch.is_default === true) {
    await client.from("paper_templates")
      .update({ is_default: false })
      .eq("kind", patch.kind)
      .neq("id", id);
  }
  const fields = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.description !== undefined) fields.description = patch.description;
  if (patch.kind !== undefined) fields.kind = patch.kind;
  if (patch.config !== undefined) fields.config = patch.config;
  if (patch.is_default !== undefined) fields.is_default = Boolean(patch.is_default);
  const { data, error } = await client.from("paper_templates")
    .update(fields)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error && isMissingPaperTemplatesTable(error)) {
    throw new Error(PAPER_TEMPLATES_MIGRATION_HINT);
  }
  if (error) throw new Error(`Supabase paper_templates.update: ${error.message}`);
  return data ? paperTemplateRow(data) : null;
}

/** Delete one saved template. Returns the deleted row (null when missing). */
export async function deletePaperTemplate(id) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("paper_templates")
    .delete()
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error && isMissingPaperTemplatesTable(error)) {
    throw new Error(PAPER_TEMPLATES_MIGRATION_HINT);
  }
  if (error) throw new Error(`Supabase paper_templates.delete: ${error.message}`);
  return data ? paperTemplateRow(data) : null;
}

// ---------------------------------------------------------------------------
// Paper Versioning & History (Paper Generator Phase 15)
// Insert-only version timeline: each row is an immutable snapshot of the paper
// state (buildPaperSnapshot in paperService.js). Writes DEGRADE gracefully
// before migration 012 is applied so publish/create are never broken by a
// missing table; reads report migrationRequired like the sets/blueprint reads.
// ---------------------------------------------------------------------------

function isMissingPaperVersionsTable(error) {
  if (!error) return false;
  const msg = String(error.message || error);
  return (
    error.code === "PGRST204" ||
    (/paper_versions/i.test(msg) && /(relation|table|does not exist|schema cache)/i.test(msg))
  );
}

const PAPER_VERSIONS_HINT =
  "Paper versioning is not available: apply backend/migrations/012_paper_versioning.sql in the Supabase SQL editor.";

function paperVersionRow(row, { withSnapshot = false } = {}) {
  const base = {
    id: row.id,
    paper_id: row.paper_id,
    version: row.version,
    reason: row.reason,
    note: row.note ?? null,
    summary: row.summary ?? null,
    changes: row.changes ?? {},
    parent_version: row.parent_version ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
  };
  if (withSnapshot) base.snapshot = row.snapshot ?? null;
  return base;
}

const VERSION_LIST_COLUMNS =
  "id, paper_id, version, reason, note, summary, changes, parent_version, created_by, created_at";

/** All saved versions of one paper (metadata only, newest last for ordering). */
export async function listPaperVersions(paperId) {
  if (!client) return { versions: [], currentVersion: 0, createdVersion: 0, migrationRequired: false };
  const { data, error } = await client.from("paper_versions")
    .select(VERSION_LIST_COLUMNS)
    .eq("paper_id", paperId)
    .order("version", { ascending: false });
  if (error && isMissingPaperVersionsTable(error)) {
    return { versions: [], currentVersion: 0, createdVersion: 0, migrationRequired: true };
  }
  if (error) throw new Error(`Supabase paper_versions.list: ${error.message}`);
  const versions = (data || []).map((r) => paperVersionRow(r));
  const numbers = versions.map((v) => v.version);
  return {
    versions,
    currentVersion: numbers.length ? Math.max(...numbers) : 0,
    createdVersion: numbers.length ? Math.min(...numbers) : 0,
    migrationRequired: false,
  };
}

/** The newest saved version (full row incl. snapshot) or null. */
export async function getLatestPaperVersion(paperId) {
  if (!client) return null;
  const { data, error } = await client.from("paper_versions")
    .select("*")
    .eq("paper_id", paperId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && isMissingPaperVersionsTable(error)) return null;
  if (error) throw new Error(`Supabase paper_versions.latest: ${error.message}`);
  return data ? paperVersionRow(data, { withSnapshot: true }) : null;
}

/** One saved version (full row incl. snapshot) by version number. */
export async function getPaperVersion(paperId, version) {
  if (!client) return null;
  const { data, error } = await client.from("paper_versions")
    .select("*")
    .eq("paper_id", paperId)
    .eq("version", version)
    .maybeSingle();
  if (error && isMissingPaperVersionsTable(error)) {
    throw new Error(PAPER_VERSIONS_HINT);
  }
  if (error) throw new Error(`Supabase paper_versions.get: ${error.message}`);
  return data ? paperVersionRow(data, { withSnapshot: true }) : null;
}

/**
 * Insert one immutable version row. Best-effort: returns null (and warns)
 * before migration 012 so capturing never breaks the primary operation
 * (create/publish) that triggered it.
 */
export async function insertPaperVersion({
  paper_id,
  version,
  reason = "manual",
  note = null,
  summary = null,
  changes = {},
  snapshot,
  created_by = null,
  parent_version = null,
}) {
  if (!client) return null;
  const { data, error } = await client.from("paper_versions")
    .insert({
      paper_id,
      version,
      reason,
      note: note ?? null,
      summary: summary ?? null,
      changes: changes ?? {},
      snapshot,
      created_by: created_by || null,
      parent_version: parent_version ?? null,
    })
    .select()
    .single();
  if (error && isMissingPaperVersionsTable(error)) {
    console.warn(PAPER_VERSIONS_HINT);
    return null;
  }
  if (error) throw new Error(`Supabase paper_versions.create: ${error.message}`);
  return paperVersionRow(data, { withSnapshot: true });
}

/**
 * Re-materialise a version snapshot onto the live paper row (safe restore).
 * Writes the core paper fields as a DRAFT (the admin re-publishes after
 * reviewing), plus blueprint/sets/translations when their columns exist, and
 * rebuilds the ordered family list from the snapshot. Families whose question
 * family has since been deleted are skipped (FK safety) and counted.
 */
export async function restorePaperFromSnapshot(paperId, snapshot) {
  if (!client) throw new Error("Supabase not configured");
  const fam = Array.isArray(snapshot?.families) ? snapshot.families : [];
  const corePatch = {
    title: snapshot?.paper?.title ?? "Untitled paper",
    description: snapshot?.paper?.description ?? null,
    standard_id: snapshot?.paper?.standard_id ?? null,
    subject_id: snapshot?.paper?.subject_id ?? null,
    exam_type_id: snapshot?.paper?.exam_type_id ?? null,
    duration_min: Number(snapshot?.paper?.duration_min) || 120,
    total_marks: Number(snapshot?.paper?.total_marks) || 0,
    status: "draft",
  };

  const patchWith = async (extra) => {
    const merged = extra
      ? { ...corePatch, blueprint: extra.blueprint, sets: extra.sets, translations: extra.translations }
      : corePatch;
    const { error } = await client.from("papers").update(merged).eq("id", paperId);
    return error;
  };

  let err = await patchWith({ blueprint: snapshot?.blueprint ?? null, sets: snapshot?.sets ?? null, translations: snapshot?.translations ?? null });
  if (err) {
    if (isMissingBlueprintColumn(err) && isMissingTranslationColumn(err)) {
      err = await patchWith(null);
    } else if (isMissingBlueprintColumn(err)) {
      err = await patchWith({ blueprint: undefined, sets: undefined, translations: snapshot?.translations ?? null });
    } else if (isMissingTranslationColumn(err)) {
      err = await patchWith({ translations: undefined });
    }
  }
  if (err) throw new Error(`Supabase papers.restore.update: ${err.message}`);

  // Only re-link families that still exist (question_families rows cascade away
  // with paper closing, so a snapshot can reference deleted families).
  const ids = fam.map((f) => f.family_id).filter(Boolean);
  const existing = new Set();
  if (ids.length > 0 && client) {
    const { data, error: listErr } = await client.from("question_families").select("id").in("id", ids);
    if (listErr) throw new Error(`Supabase restore.families.check: ${listErr.message}`);
    for (const r of data || []) existing.add(r.id);
  }
  let skipped = 0;
  const entries = [];
  for (const f of fam) {
    if (!f?.family_id) continue;
    if (!existing.has(f.family_id)) {
      skipped += 1;
      continue;
    }
    entries.push({
      familyId: f.family_id,
      marks: Number(f.marks) || 0,
      sectionKey: f.section_key || null,
      locked: Boolean(f.locked),
    });
  }
  await replacePaperFamilies(paperId, entries);
  const paper = await paperByIdWithFamilies(paperId);
  return { paper, skipped };
}
