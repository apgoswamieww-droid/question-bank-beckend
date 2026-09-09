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
  "settings.view": "System & Settings",
  "settings.manage": "System & Settings",
  "roles.manage": "System & Settings",
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

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
  return { code, name, description: description || null };
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
  return true;
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
// Master Data: Chapters
// ---------------------------------------------------------------------------
export async function listChapters({ subject_id, standard_id } = {}) {
  if (!client) return [];
  let query = client.from("chapters").select("*").order("sort_order");
  if (subject_id) query = query.eq("subject_id", subject_id);
  if (standard_id) query = query.eq("standard_id", standard_id);
  const { data, error } = await query;
  if (error) throw new Error(`Supabase chapters.list: ${error.message}`);
  return data;
}

export async function createChapter({ subject_id, standard_id, name, number, description, sort_order = 0 }) {
  if (!client) throw new Error("Supabase not configured");
  const { data, error } = await client.from("chapters").insert({ subject_id, standard_id, name, number, description, sort_order }).select().single();
  if (error) throw new Error(`Supabase chapters.create: ${error.message}`);
  return data;
}

export async function updateChapter(id, { name, number, description, sort_order, active }) {
  if (!client) return null;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (number !== undefined) patch.number = number;
  if (description !== undefined) patch.description = description;
  if (sort_order !== undefined) patch.sort_order = sort_order;
  if (active !== undefined) patch.active = active;
  const { data, error } = await client.from("chapters").update(patch).eq("id", id).select().single();
  if (error) throw new Error(`Supabase chapters.update: ${error.message}`);
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
  tags: row.tags ?? [],
  status: row.status,
  sort_order: row.sort_order,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export async function createQuestion({
  bank_id, created_by, standard_id, subject_id, chapter_id, topic_id,
  type, exam_type_id, language_id, difficulty, level_id, exam_year,
  content, explanation, image_url, marks, negative_marks, time_limit_sec,
  tags, status, sort_order,
}) {
  if (!client) throw new Error("Supabase not configured");
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
  } = filters;

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

export async function listQuestions({ with_usage = false, ...filters } = {}) {
  if (!client) return [];
  const { limit = 50, offset = 0, ...rest } = filters;
  let query = client.from("questions").select("*").order("sort_order").order("created_at", { ascending: false });
  query = applyQuestionFilters(query, rest);
  const { data, error } = await query;
  if (error) throw new Error(`Supabase questions.list: ${error.message}`);

  let questions = data.map(rowToQuestion).filter((q) => questionMatchesSearch(q, rest));
  questions = questions.slice(offset, offset + limit);
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
    const { data, error } = await query;
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
