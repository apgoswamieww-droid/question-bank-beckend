import express from "express";
import cors from "cors";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import {
  sendTeacherRegistrationEmail,
  sendPasswordResetEmail,
} from "./mailer.js";
import {
  findUserByLogin,
  verifyPassword,
  signToken,
  verifyToken,
  publicUser,
  runDummyVerify,
} from "./auth.js";
import {
  PERMISSIONS,
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  setUserRole,
  countUsersByRole,
  listRoles,
  createRole,
  deleteRole,
  listPermissions,
  permissionsForRole,
  setRolePermissions,
  hasPermission,
  passwordResetStore,
  // Master data
  listStandards,
  createStandard,
  updateStandard,
  deleteStandard,
  listSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  listChapters,
  createChapter,
  updateChapter,
  deleteChapter,
  listTopics,
  createTopic,
  updateTopic,
  deleteTopic,
  listExamTypes,
  createExamType,
  updateExamType,
  deleteExamType,
  // Question Levels
  listQuestionLevels,
  createQuestionLevel,
  // Questions
  createQuestion,
  getQuestionById,
  listQuestions,
  countQuestions,
  questionAggregateCounts,
  updateQuestion,
  deleteQuestion,
  duplicateQuestion,
  listQuestionOptions,
  createQuestionOption,
  updateQuestionOption,
  deleteQuestionOption,
  deleteQuestionOptionsByQuestion,
  getQuestionPayload,
  upsertQuestionPayload,
  logQuestionEdit,
  getQuestionEditHistory,
  logQuestionUsage,
  getQuestionUsageHistory,
  getQuestionUsageSummary,
  getQuestionPerformance,
  analyticsOverview,
  analyticsMostUsed,
  analyticsUnused,
  analyticsBySchool,
  analyticsByTeacher,
  analyticsOverTime,
  analyticsPerformance,
  listTests,
  getTestById,
  createTest,
  updateTest,
  deleteTest,
  countTests,
  listLanguages,
  createLanguage,
  updateLanguage,
  deleteLanguage,
  listSchools,
  createSchool,
  listStandardSubjects,
  linkSubjectToStandards,
  replaceSubjectStandards,
  updateSchool,
  deleteSchool,
  // Question families & papers (multi-language)
  listQuestionVariants,
  listQuestionVariantsByFamilies,
  linkQuestionToFamily,
  listPapers,
  getPaperById,
  createPaper,
  updatePaper,
  deletePaper,
  getPaperLanguages,
  getPaperInLanguage,
  getPaperInLanguageStrict,
  getPaperBlueprint,
  getPaperSets,
  updatePaperSets,
  updatePaperTranslations,
  updateQuestionTranslationStatus,
  // Separate language paper generation (Phase 9)
  listLanguagePapers,
  createLanguagePaper,
  getLanguagePaperData,
  updateLanguagePaperStatus,
  deleteLanguagePaper,
  // Reusable paper templates (Phase 11)
  listPaperTemplates,
  getDefaultPaperTemplate,
  getPaperTemplate,
  createPaperTemplate,
  updatePaperTemplate,
  deletePaperTemplate,
  // Paper versioning & history (Phase 15)
  listPaperVersions,
  getLatestPaperVersion,
  getPaperVersion,
  insertPaperVersion,
  restorePaperFromSnapshot,
  // Paper lifecycle management (Phase 16)
  transitionPaperStatus,
  duplicatePaper,
} from "./supabase.js";
import {
  normalizeBlueprint,
  validateBlueprint,
  previewBlueprintAvailability,
  selectQuestionsForBlueprint,
  computePaperStructure,
  findReplacement,
  validatePaper,
  generateSetsDoc,
  computeSetAnswerKey,
  computeTranslationReport,
  computeSetAnswerKeyInLanguage,
  buildLanguagePaperSnapshot,
  resolveSetQuestionAnswer,
  buildPaperReport,
  buildPaperAnalysis,
  buildPaperSnapshot,
  diffPaperSnapshots,
  canTransitionPaper,
  computeStatusAfterContentEdit,
} from "./paperService.js";
import { buildPaperHtml, htmlToPdfBuffer } from "./pdfRenderer.js";

const TRANSLATION_WORKFLOW_STATES = ["draft", "translated", "reviewed", "approved"];
const LANGUAGE_PAPER_STATES = ["draft", "generated", "approved", "archived"];

const BASE_VALID_ROLES = new Set(["super_admin", "teacher", "student"]);
// Custom roles (created via Roles & Permissions) are also assignable — resolved
// against the roles table/fallback at request time.
async function isValidRole(role) {
  if (BASE_VALID_ROLES.has(role)) return true;
  if (typeof role !== "string" || role.length === 0) return false;
  try {
    const roles = await listRoles();
    return roles.some((r) => r.code === role);
  } catch {
    return false;
  }
}
const VALID_PERMISSIONS = new Set(Object.values(PERMISSIONS));

const app = express();
app.disable("x-powered-by");

// Open CORS by default (Bearer-token auth, no cookies). Set CORS_ORIGINS to a
// comma-separated allowlist to restrict which frontend origins may call the API.
const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins, credentials: true } : { origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------
// Authentication middleware
// ---------------------------------------------------------------
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const decoded = token ? verifyToken(token) : null;
  if (!decoded) {
    return res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
  }
  req.user = decoded;
  next();
}

// Permission guard — must run after requireAuth.
function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      const allowed = await hasPermission(req.user?.role, permission);
      if (!allowed) {
        return res.status(403).json({
          error: "You do not have permission to perform this action.",
          code: "FORBIDDEN",
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

const isSafeIdentifier = (s) =>
  typeof s === "string" && s.trim().length > 0 && s.trim().length <= 120;

// Super-admin only guard. Teacher registration + the per-teacher question
// bank editor are restricted to super admins via this middleware.
function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== "super_admin") {
    return res
      .status(403)
      .json({ error: "This action is restricted to Super Admins.", code: "FORBIDDEN" });
  }
  next();
}

const isSafeOptional = (s, max = 500) =>
  s === undefined || s === null || (typeof s === "string" && s.length <= max);
const isSafeDate = (s) => s === undefined || s === null || (typeof s === "string" && !Number.isNaN(Date.parse(s)));
const isSafeEmail = (s) =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.trim().length <= 254;
const isSafeProfileImage = (s) =>
  s === undefined || s === null || (typeof s === "string" && s.trim().length <= 2048);

// Password-reset tokens: random, one-time, 24h expiry.
const RESET_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_BYTES = 32;

async function createPasswordReset(user) {
  const token = randomBytes(RESET_TOKEN_BYTES).toString("base64url");
  passwordResetStore.create(token, {
    userId: user.id,
    email: user.email,
    expiresAt: Date.now() + RESET_TTL_MS,
  });
  return token;
}

// ---------------------------------------------------------------
// Health check
// ---------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "question-bank-admin-api" });
});

// ---------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------
const loginAttempts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = loginAttempts.get(ip) || { count: 0, resetAt: now + 60000 };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + 60000;
  }
  bucket.count += 1;
  loginAttempts.set(ip, bucket);
  return { allowed: bucket.count <= 10, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
}

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const { allowed, retryAfter } = checkRateLimit(ip);
    if (!allowed) {
      return res.status(429).json({
        error: "Too many login attempts. Please wait and try again.",
        code: "RATE_LIMITED",
        retryAfter,
      });
    }

    const { email, password } = req.body ?? {};
    if (!isSafeEmail(email) || typeof password !== "string" || !password) {
      return res.status(400).json({
        error: "Email and password are required.",
        code: "MISSING_FIELDS",
      });
    }

    const user = await findUserByLogin(email);
    // Timing-attack mitigation: always run a bcrypt compare.
    const ok = user ? await verifyPassword(user, password) : runDummyVerify();
    if (!user || !ok) {
      return res.status(401).json({
        error: "Invalid email or password.",
        code: "INVALID_CREDENTIALS",
      });
    }

    const permissions = await permissionsForRole(user.role);
    return res.json({
      token: signToken(user),
      user: publicUser(user),
      role: user.role,
      permissions,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/auth/me — restore session on page reload
// ---------------------------------------------------------------
app.get("/api/auth/me", requireAuth, async (req, res, next) => {
  try {
    const user = await getUserById(req.user.sub);
    if (!user) {
      return res.status(401).json({ error: "User no longer exists", code: "UNAUTHORIZED" });
    }
    const permissions = await permissionsForRole(user.role);
    res.json({
      user: publicUser(user),
      role: user.role,
      permissions,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// PATCH /api/auth/me — update the signed-in user's own profile
// ---------------------------------------------------------------
app.patch("/api/auth/me", requireAuth, async (req, res, next) => {
  try {
    const { name, email, phone, gender, dateOfBirth, address, hireDate, subject, qualification, profileImage } = req.body ?? {};
    const patch = {};
    if (name !== undefined) {
      if (!isSafeIdentifier(name)) return res.status(400).json({ error: "Invalid name.", code: "VALIDATION" });
      patch.name = name.trim();
    }
    if (email !== undefined) {
      if (!isSafeEmail(email)) return res.status(400).json({ error: "Invalid email.", code: "VALIDATION" });
      patch.email = email.trim();
    }
    if (profileImage !== undefined) {
      if (!isSafeProfileImage(profileImage)) return res.status(400).json({ error: "Invalid profile image URL.", code: "VALIDATION" });
      patch.profileImage = profileImage.trim() || undefined;
    }
    if (phone !== undefined) { if (!isSafeOptional(phone, 30)) return res.status(400).json({ error: "Invalid phone.", code: "VALIDATION" }); patch.phone = phone; }
    if (gender !== undefined) { if (!isSafeOptional(gender, 20)) return res.status(400).json({ error: "Invalid gender.", code: "VALIDATION" }); patch.gender = gender; }
    if (address !== undefined) { if (!isSafeOptional(address, 500)) return res.status(400).json({ error: "Invalid address.", code: "VALIDATION" }); patch.address = address; }
    if (subject !== undefined) { if (!isSafeOptional(subject, 120)) return res.status(400).json({ error: "Invalid subject.", code: "VALIDATION" }); patch.subject = subject; }
    if (qualification !== undefined) { if (!isSafeOptional(qualification, 200)) return res.status(400).json({ error: "Invalid qualification.", code: "VALIDATION" }); patch.qualification = qualification; }
    if (hireDate !== undefined) { if (!isSafeDate(hireDate)) return res.status(400).json({ error: "Invalid hire date.", code: "VALIDATION" }); patch.hireDate = hireDate; }
    if (dateOfBirth !== undefined) { if (!isSafeDate(dateOfBirth)) return res.status(400).json({ error: "Invalid date of birth.", code: "VALIDATION" }); patch.dateOfBirth = dateOfBirth; }

    const updated = await updateUser(req.user.sub, patch);
    if (!updated) return res.status(404).json({ error: "User not found.", code: "NOT_FOUND" });
    const permissions = await permissionsForRole(updated.role);
    res.json({ user: publicUser(updated), role: updated.role, permissions });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/auth/change-password — signed-in user changes own password
// ---------------------------------------------------------------
app.post("/api/auth/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 256) {
      return res.status(400).json({ error: "New password must be 8+ characters.", code: "VALIDATION" });
    }
    const user = await getUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found.", code: "NOT_FOUND" });
    if (typeof currentPassword !== "string" || !(await verifyPassword(user, currentPassword))) {
      return res.status(401).json({ error: "Current password is incorrect.", code: "INVALID_CREDENTIALS" });
    }
    await updateUser(user.id, { password: newPassword });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/auth/forgot-password — public: email a reset link
// ---------------------------------------------------------------
app.post("/api/auth/forgot-password", async (req, res, next) => {
  try {
    const { email } = req.body ?? {};
    const user = isSafeEmail(email) ? await findUserByLogin(email.trim()) : null;
    // Always report success to avoid user enumeration.
    if (user) {
      const token = await createPasswordReset(user);
      const resetLink = `${config.mail.baseUrl}/admin/reset-password?token=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail({ email: user.email, name: user.name, resetLink });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/auth/reset-password — public: consume token + set password
// ---------------------------------------------------------------
app.post("/api/auth/reset-password", async (req, res, next) => {
  try {
    const { token, password } = req.body ?? {};
    if (typeof password !== "string" || password.length < 8 || password.length > 256) {
      return res.status(400).json({ error: "Password must be 8+ characters.", code: "VALIDATION" });
    }
    if (typeof token !== "string" || !token) {
      return res.status(400).json({ error: "Reset token is required.", code: "VALIDATION" });
    }
    const entry = passwordResetStore.consume(token);
    if (!entry || Date.now() > entry.expiresAt) {
      return res.status(400).json({ error: "This reset link is invalid or has expired.", code: "INVALID_TOKEN" });
    }
    const user = await getUserById(entry.userId);
    if (!user || user.email.toLowerCase() !== String(entry.email).toLowerCase()) {
      return res.status(400).json({ error: "This reset link is invalid or has expired.", code: "INVALID_TOKEN" });
    }
    await updateUser(user.id, { password });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Admin: users
// ---------------------------------------------------------------
app.get(
  "/api/admin/users",
  requireAuth,
  requirePermission(PERMISSIONS.USERS_VIEW),
  async (_req, res, next) => {
    try {
      const users = await listUsers();
      res.json({ users: users.map(publicUser) });
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  "/api/admin/users",
  requireAuth,
  requirePermission(PERMISSIONS.USERS_MANAGE),
  async (req, res, next) => {
    try {
      const { email, name, password, role, active, phone, gender, dateOfBirth, address, hireDate, subject, qualification, profileImage } = req.body ?? {};
      if (!isSafeEmail(email)) {
        return res.status(400).json({ error: "A valid email is required.", code: "VALIDATION" });
      }
      if (!isSafeIdentifier(name)) {
        return res.status(400).json({ error: "Name is required.", code: "VALIDATION" });
      }
      if (typeof password !== "string" || password.length < 8 || password.length > 256) {
        return res.status(400).json({ error: "Password must be 8+ characters.", code: "VALIDATION" });
      }
      if (!(await isValidRole(role))) {
        return res.status(400).json({ error: "Invalid role.", code: "VALIDATION" });
      }
      if (!isSafeProfileImage(profileImage) || !isSafeDate(dateOfBirth) || !isSafeDate(hireDate) || !isSafeOptional(phone, 30) || !isSafeOptional(gender, 20) || !isSafeOptional(address, 500) || !isSafeOptional(subject, 120) || !isSafeOptional(qualification, 200)) {
        return res.status(400).json({ error: "Invalid teacher registration field.", code: "VALIDATION" });
      }
      const created = await createUser({
        email: email.trim(),
        name: name.trim(),
        password,
        role,
        active: active !== false,
        phone: phone ?? undefined,
        gender: gender ?? undefined,
        dateOfBirth: dateOfBirth ?? undefined,
        address: address ?? undefined,
        hireDate: hireDate ?? undefined,
        subject: subject ?? undefined,
        qualification: qualification ?? undefined,
        profileImage: profileImage ?? undefined,
      });

      // For a new teacher, email a one-time reset link (no plaintext password).
      let emailStatus = null;
      if (created && role === "teacher") {
        const resetToken = await createPasswordReset(created);
        const resetLink = `${config.mail.baseUrl}/admin/reset-password?token=${encodeURIComponent(resetToken)}`;
        emailStatus = await sendTeacherRegistrationEmail({
          email: created.email,
          name: created.name,
          resetLink,
        });
      }

      res.status(201).json({ user: publicUser(created), email: emailStatus });
    } catch (err) {
      if (String(err?.message || "").includes("duplicate")) {
        return res.status(409).json({ error: "Email already exists.", code: "DUPLICATE" });
      }
      next(err);
    }
  }
);

app.patch(
  "/api/admin/users/:id",
  requireAuth,
  requirePermission(PERMISSIONS.USERS_MANAGE),
  async (req, res, next) => {
    try {
      const { name, email, password, active, phone, gender, dateOfBirth, address, hireDate, subject, qualification, profileImage } = req.body ?? {};
      const patch = {};
      if (name !== undefined) {
        if (!isSafeIdentifier(name)) return res.status(400).json({ error: "Invalid name.", code: "VALIDATION" });
        patch.name = name.trim();
      }
      if (email !== undefined) {
        if (!isSafeEmail(email)) return res.status(400).json({ error: "Invalid email.", code: "VALIDATION" });
        patch.email = email.trim();
      }
      if (active !== undefined) patch.active = Boolean(active);
      if (profileImage !== undefined && !isSafeProfileImage(profileImage)) return res.status(400).json({ error: "Invalid profile image URL.", code: "VALIDATION" });
      if (profileImage !== undefined) patch.profileImage = profileImage;
      if (phone !== undefined && !isSafeOptional(phone, 30)) return res.status(400).json({ error: "Invalid phone.", code: "VALIDATION" });
      if (gender !== undefined && !isSafeOptional(gender, 20)) return res.status(400).json({ error: "Invalid gender.", code: "VALIDATION" });
      if (address !== undefined && !isSafeOptional(address, 500)) return res.status(400).json({ error: "Invalid address.", code: "VALIDATION" });
      if (subject !== undefined && !isSafeOptional(subject, 120)) return res.status(400).json({ error: "Invalid subject.", code: "VALIDATION" });
      if (qualification !== undefined && !isSafeOptional(qualification, 200)) return res.status(400).json({ error: "Invalid qualification.", code: "VALIDATION" });
      if (dateOfBirth !== undefined && !isSafeDate(dateOfBirth)) return res.status(400).json({ error: "Invalid date of birth.", code: "VALIDATION" });
      if (hireDate !== undefined && !isSafeDate(hireDate)) return res.status(400).json({ error: "Invalid hire date.", code: "VALIDATION" });
      if (phone !== undefined) patch.phone = phone;
      if (gender !== undefined) patch.gender = gender;
      if (dateOfBirth !== undefined) patch.dateOfBirth = dateOfBirth;
      if (address !== undefined) patch.address = address;
      if (hireDate !== undefined) patch.hireDate = hireDate;
      if (subject !== undefined) patch.subject = subject;
      if (qualification !== undefined) patch.qualification = qualification;
      if (password !== undefined) {
        if (typeof password !== "string" || (password && (password.length < 8 || password.length > 256))) {
          return res.status(400).json({ error: "Password must be 8+ characters.", code: "VALIDATION" });
        }
        patch.password = password;
      }
      const updated = await updateUser(req.params.id, patch);
      if (!updated) return res.status(404).json({ error: "User not found.", code: "NOT_FOUND" });
      res.json({ user: publicUser(updated) });
    } catch (err) {
      if (String(err?.message || "").includes("duplicate")) {
        return res.status(409).json({ error: "Username or email already exists.", code: "DUPLICATE" });
      }
      next(err);
    }
  }
);

// DELETE /api/admin/users/:id — Super admin only. Cannot delete yourself.
app.delete(
  "/api/admin/users/:id",
  requireAuth,
  requireSuperAdmin,
  async (req, res, next) => {
    try {
      if (req.params.id === req.user.sub) {
        return res.status(400).json({ error: "You cannot delete your own account.", code: "VALIDATION" });
      }
      const removed = await deleteUser(req.params.id);
      if (!removed) return res.status(404).json({ error: "User not found.", code: "NOT_FOUND" });
      res.json({ deleted: true, user: publicUser(removed) });
    } catch (err) {
      next(err);
    }
  }
);

app.put(
  "/api/admin/users/:id/role",
  requireAuth,
  requirePermission(PERMISSIONS.USERS_MANAGE),
  async (req, res, next) => {
    try {
      const { role } = req.body ?? {};
      if (!(await isValidRole(role))) {
        return res.status(400).json({ error: "Invalid role.", code: "VALIDATION" });
      }
      // Protect the seeded super admin from self-demotion.
      if (req.params.id === req.user.sub && role !== "super_admin") {
        return res.status(400).json({ error: "You cannot change your own super admin role.", code: "VALIDATION" });
      }
      const updated = await setUserRole(req.params.id, role);
      if (!updated) return res.status(404).json({ error: "User not found.", code: "NOT_FOUND" });
      res.json({ user: publicUser(updated) });
    } catch (err) {
      next(err);
    }
  }
);

app.get(
  "/api/admin/stats",
  requireAuth,
  requirePermission(PERMISSIONS.USERS_VIEW),
  async (_req, res, next) => {
    try {
      const counts = await countUsersByRole();
      res.json({ stats: counts });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------
// Admin: roles & permissions
// ---------------------------------------------------------------
app.get(
  "/api/admin/roles",
  requireAuth,
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  async (_req, res, next) => {
    try {
      const roles = await listRoles();
      res.json({ roles });
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  "/api/admin/roles",
  requireAuth,
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  async (req, res, next) => {
    try {
      const { code, name, description } = req.body ?? {};
      if (!isSafeIdentifier(name) || !code || typeof code !== "string") {
        return res.status(400).json({ error: "Role code and name are required.", code: "VALIDATION" });
      }
      const cleanCode = code.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const created = await createRole({
        code: cleanCode,
        name: name.trim(),
        description: description?.trim() || null,
      });
      res.status(201).json({ role: created });
    } catch (err) {
      if (String(err?.message || "").includes("duplicate") || err?.code === "ROLE_EXISTS") {
        return res.status(409).json({ error: "Role code already exists.", code: "DUPLICATE" });
      }
      next(err);
    }
  }
);

app.delete(
  "/api/admin/roles/:code",
  requireAuth,
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  async (req, res, next) => {
    try {
      const { code } = req.params;
      const SYSTEM_ROLES = new Set(["super_admin", "teacher", "student"]);
      if (SYSTEM_ROLES.has(code)) {
        return res.status(400).json({ error: "Cannot delete built-in system role.", code: "SYSTEM_ROLE" });
      }
      const removed = await deleteRole(code);
      if (!removed) return res.status(404).json({ error: "Role not found.", code: "NOT_FOUND" });
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  }
);

app.get(
  "/api/admin/permissions",
  requireAuth,
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  async (_req, res, next) => {
    try {
      const permissions = await listPermissions();
      const allPermCodes = permissions.map((p) => p.code);
      const roles = await listRoles();
      const matrix = {};
      for (const role of roles.map((r) => r.code)) {
        if (role === "super_admin") {
          matrix[role] = allPermCodes;
        } else {
          matrix[role] = await permissionsForRole(role);
        }
      }
      res.json({ permissions, matrix });
    } catch (err) {
      next(err);
    }
  }
);

app.put(
  "/api/admin/roles/:code/permissions",
  requireAuth,
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  async (req, res, next) => {
    try {
      const { code } = req.params;
      const allRoles = await listRoles();
      if (!allRoles.some((r) => r.code === code)) {
        return res.status(404).json({ error: "Role not found.", code: "NOT_FOUND" });
      }
      const { permissions } = req.body ?? {};
      if (!Array.isArray(permissions)) {
        return res.status(400).json({ error: "Invalid permissions array.", code: "VALIDATION" });
      }
      const allPerms = (await listPermissions()).map((p) => p.code);
      const validPerms = permissions.filter((p) => allPerms.includes(p));
      const finalPerms = code === "super_admin" ? allPerms : validPerms;
      await setRolePermissions(code, finalPerms);
      res.json({ role: code, permissions: await permissionsForRole(code) });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------
// Admin: Master Data — Standards
// ---------------------------------------------------------------
app.get("/api/admin/standards", requireAuth, async (_req, res, next) => {
  try {
    const standards = await listStandards();
    res.json({ standards });
  } catch (err) { next(err); }
});

app.post("/api/admin/standards", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, sort_order } = req.body ?? {};
    if (!isSafeIdentifier(name)) return res.status(400).json({ error: "Name is required.", code: "VALIDATION" });
    const created = await createStandard({ name: name.trim(), sort_order: sort_order ?? 0 });
    res.status(201).json({ standard: created });
  } catch (err) {
    if (String(err?.message || "").includes("duplicate")) return res.status(409).json({ error: "Standard already exists.", code: "DUPLICATE" });
    next(err);
  }
});

app.patch("/api/admin/standards/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, sort_order, active } = req.body ?? {};
    const updated = await updateStandard(req.params.id, { name, sort_order, active });
    if (!updated) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ standard: updated });
  } catch (err) { next(err); }
});

app.delete("/api/admin/standards/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const removed = await deleteStandard(req.params.id);
    if (!removed) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Admin: Master Data — Subjects
// ---------------------------------------------------------------
app.get("/api/admin/subjects", requireAuth, async (_req, res, next) => {
  try {
    const subjects = await listSubjects();
    res.json({ subjects });
  } catch (err) { next(err); }
});

app.post("/api/admin/subjects", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, icon, color, sort_order, standard_ids } = req.body ?? {};
    if (!isSafeIdentifier(name)) return res.status(400).json({ error: "Name is required.", code: "VALIDATION" });
    const created = await createSubject({ name: name.trim(), icon, color, sort_order: sort_order ?? 0 });
    if (Array.isArray(standard_ids) && standard_ids.length) {
      await linkSubjectToStandards(created.id, standard_ids);
    }
    res.status(201).json({ subject: created });
  } catch (err) {
    if (String(err?.message || "").includes("duplicate")) return res.status(409).json({ error: "Subject already exists.", code: "DUPLICATE" });
    next(err);
  }
});

app.patch("/api/admin/subjects/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, icon, color, sort_order, active, standard_ids } = req.body ?? {};
    const updated = await updateSubject(req.params.id, { name, icon, color, sort_order, active });
    if (!updated) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    if (Array.isArray(standard_ids)) {
      await replaceSubjectStandards(req.params.id, standard_ids);
    }
    res.json({ subject: updated });
  } catch (err) { next(err); }
});

app.delete("/api/admin/subjects/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const removed = await deleteSubject(req.params.id);
    if (!removed) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Admin: Master Data — Chapters
// ---------------------------------------------------------------
app.get("/api/admin/chapters", requireAuth, async (req, res, next) => {
  try {
    const { subject_id, standard_id } = req.query ?? {};
    const chapters = await listChapters({ subject_id, standard_id });
    res.json({ chapters });
  } catch (err) { next(err); }
});

app.post("/api/admin/chapters", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { subject_id, standard_id, name, number, description, sort_order } = req.body ?? {};
    if (!isSafeIdentifier(name)) return res.status(400).json({ error: "Name is required.", code: "VALIDATION" });
    if (!subject_id || !standard_id) return res.status(400).json({ error: "Subject and standard are required.", code: "VALIDATION" });
    const created = await createChapter({ subject_id, standard_id, name: name.trim(), number, description, sort_order: sort_order ?? 0 });
    res.status(201).json({ chapter: created });
  } catch (err) { next(err); }
});

app.patch("/api/admin/chapters/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, number, description, sort_order, active } = req.body ?? {};
    const updated = await updateChapter(req.params.id, { name, number, description, sort_order, active });
    if (!updated) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ chapter: updated });
  } catch (err) { next(err); }
});

app.delete("/api/admin/chapters/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const removed = await deleteChapter(req.params.id);
    if (!removed) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Admin: Master Data — Topics
// ---------------------------------------------------------------
app.get("/api/admin/topics", requireAuth, async (req, res, next) => {
  try {
    const { chapter_id } = req.query ?? {};
    const topics = await listTopics({ chapter_id });
    res.json({ topics });
  } catch (err) { next(err); }
});

app.post("/api/admin/topics", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { chapter_id, name, number, description, sort_order } = req.body ?? {};
    if (!isSafeIdentifier(name)) return res.status(400).json({ error: "Name is required.", code: "VALIDATION" });
    if (!chapter_id) return res.status(400).json({ error: "Chapter is required.", code: "VALIDATION" });
    const created = await createTopic({ chapter_id, name: name.trim(), number, description, sort_order: sort_order ?? 0 });
    res.status(201).json({ topic: created });
  } catch (err) { next(err); }
});

app.patch("/api/admin/topics/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, number, description, sort_order, active } = req.body ?? {};
    const updated = await updateTopic(req.params.id, { name, number, description, sort_order, active });
    if (!updated) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ topic: updated });
  } catch (err) { next(err); }
});

app.delete("/api/admin/topics/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const removed = await deleteTopic(req.params.id);
    if (!removed) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Admin: Master Data — Question Levels
// ---------------------------------------------------------------
app.get("/api/admin/question-levels", requireAuth, async (_req, res, next) => {
  try {
    const levels = await listQuestionLevels();
    res.json({ levels });
  } catch (err) { next(err); }
});

app.post("/api/admin/question-levels", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { code, name, color, icon, sort_order } = req.body ?? {};
    if (!isSafeIdentifier(name) || !isSafeIdentifier(code)) return res.status(400).json({ error: "Code and name are required.", code: "VALIDATION" });
    const created = await createQuestionLevel({ code: code.trim(), name: name.trim(), color, icon, sort_order: sort_order ?? 0 });
    res.status(201).json({ level: created });
  } catch (err) {
    if (String(err?.message || "").includes("duplicate")) return res.status(409).json({ error: "Level already exists.", code: "DUPLICATE" });
    next(err);
  }
});

// ---------------------------------------------------------------
// Admin: Master Data — Exam Types
// ---------------------------------------------------------------
app.get("/api/admin/exam-types", requireAuth, async (_req, res, next) => {
  try {
    const examTypes = await listExamTypes();
    res.json({ examTypes });
  } catch (err) { next(err); }
});

app.post("/api/admin/exam-types", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, category, description, sort_order } = req.body ?? {};
    if (!isSafeIdentifier(name)) return res.status(400).json({ error: "Name is required.", code: "VALIDATION" });
    const created = await createExamType({ name: name.trim(), category, description, sort_order: sort_order ?? 0 });
    res.status(201).json({ examType: created });
  } catch (err) {
    if (String(err?.message || "").includes("duplicate")) return res.status(409).json({ error: "Exam type already exists.", code: "DUPLICATE" });
    next(err);
  }
});

app.patch("/api/admin/exam-types/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, category, description, sort_order, active } = req.body ?? {};
    const updated = await updateExamType(req.params.id, { name, category, description, sort_order, active });
    if (!updated) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ examType: updated });
  } catch (err) { next(err); }
});

app.delete("/api/admin/exam-types/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const removed = await deleteExamType(req.params.id);
    if (!removed) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Admin: Master Data — Languages
// ---------------------------------------------------------------
app.get("/api/admin/languages", requireAuth, async (_req, res, next) => {
  try {
    const languages = await listLanguages();
    res.json({ languages });
  } catch (err) { next(err); }
});

app.post("/api/admin/languages", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { code, name, native_name } = req.body ?? {};
    if (!isSafeIdentifier(name) || !isSafeIdentifier(code)) return res.status(400).json({ error: "Code and name are required.", code: "VALIDATION" });
    const created = await createLanguage({ code: code.trim(), name: name.trim(), native_name });
    res.status(201).json({ language: created });
  } catch (err) {
    if (String(err?.message || "").includes("duplicate")) return res.status(409).json({ error: "Language already exists.", code: "DUPLICATE" });
    next(err);
  }
});

app.patch("/api/admin/languages/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { code, name, native_name, active } = req.body ?? {};
    const updated = await updateLanguage(req.params.id, { code, name, native_name, active });
    if (!updated) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ language: updated });
  } catch (err) { next(err); }
});

app.delete("/api/admin/languages/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const removed = await deleteLanguage(req.params.id);
    if (!removed) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Admin: Master Data — Schools
// ---------------------------------------------------------------
app.get("/api/admin/schools", requireAuth, async (_req, res, next) => {
  try {
    const schools = await listSchools();
    res.json({ schools });
  } catch (err) { next(err); }
});

app.post("/api/admin/schools", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, code, district, city, state, board, type, contact_email, contact_phone, address } = req.body ?? {};
    if (!isSafeIdentifier(name)) return res.status(400).json({ error: "Name is required.", code: "VALIDATION" });
    const created = await createSchool({ name: name.trim(), code, district, city, state, board, type, contact_email, contact_phone, address });
    res.status(201).json({ school: created });
  } catch (err) {
    if (String(err?.message || "").includes("duplicate")) return res.status(409).json({ error: "School code already exists.", code: "DUPLICATE" });
    next(err);
  }
});

app.patch("/api/admin/schools/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, code, district, city, state, board, type, contact_email, contact_phone, address, active } = req.body ?? {};
    const updated = await updateSchool(req.params.id, { name, code, district, city, state, board, type, contact_email, contact_phone, address, active });
    if (!updated) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ school: updated });
  } catch (err) { next(err); }
});

app.delete("/api/admin/schools/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const removed = await deleteSchool(req.params.id);
    if (!removed) return res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Admin: Master Data — Standard ↔ Subject mapping
// ---------------------------------------------------------------
app.get("/api/admin/standard-subjects", requireAuth, async (req, res, next) => {
  try {
    const { standard_id, subject_id } = req.query ?? {};
    const mappings = await listStandardSubjects({ standard_id, subject_id });
    res.json({ mappings });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Admin: Questions CRUD
// ---------------------------------------------------------------
const VALID_QUESTION_TYPES = new Set([
  "mcq_single","mcq_multi","true_false","fill_blank",
  "short_answer","long_answer","match","ordering","image_based","numeric"
]);
const VALID_DIFFICULTIES = new Set(["easy","medium","hard","expert"]);
const VALID_STATUSES = new Set(["draft","published","archived"]);

app.post("/api/admin/questions", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_MANAGE), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    if (!b.content) return res.status(400).json({ error: "Content is required.", code: "VALIDATION" });
    if (!b.type || !VALID_QUESTION_TYPES.has(b.type)) return res.status(400).json({ error: "Invalid question type.", code: "VALIDATION" });
    if (b.difficulty && !VALID_DIFFICULTIES.has(b.difficulty)) return res.status(400).json({ error: "Invalid difficulty.", code: "VALIDATION" });
    if (b.status && !VALID_STATUSES.has(b.status)) return res.status(400).json({ error: "Invalid status.", code: "VALIDATION" });
    const created = await createQuestion({
      bank_id: b.bank_id, created_by: req.user.sub,
      standard_id: b.standard_id, subject_id: b.subject_id, chapter_id: b.chapter_id, topic_id: b.topic_id,
      type: b.type, exam_type_id: b.exam_type_id, language_id: b.language_id,
      difficulty: b.difficulty, level_id: b.level_id, exam_year: b.exam_year,
      content: b.content, explanation: b.explanation, image_url: b.image_url,
      marks: b.marks, negative_marks: b.negative_marks, time_limit_sec: b.time_limit_sec,
      tags: b.tags, status: b.status, sort_order: b.sort_order,
      family_id: b.family_id,
    });
    // Save options if provided
    if (Array.isArray(b.options) && b.options.length > 0) {
      for (let i = 0; i < b.options.length; i++) {
        const opt = b.options[i];
        await createQuestionOption({
          question_id: created.id, label: opt.label || String.fromCharCode(65 + i),
          content: opt.content, is_correct: opt.is_correct ?? false, sort_order: i,
        });
      }
    }
    // Save payload if provided
    if (b.payload) {
      await upsertQuestionPayload(created.id, b.payload);
    }
    // Log creation
    await logQuestionEdit({
      question_id: created.id, edited_by: req.user.sub,
      field_changed: "created", old_value: null, new_value: { type: created.type },
      change_summary: "Question created",
    });
    const full = await getQuestionById(created.id);
    const options = await listQuestionOptions(created.id);
    const payload = await getQuestionPayload(created.id);
    res.status(201).json({ question: full, options, payload: payload?.payload ?? null });
  } catch (err) { next(err); }
});

app.get("/api/admin/questions", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const {
      bank_id, standard_id, subject_id, chapter_id, topic_id, type, difficulty,
      level_id, exam_type_id, language_id, exam_year, status, tags, created_by,
      search, q, min_marks, max_marks, min_negative_marks, max_negative_marks,
      created_from, created_to, updated_from, updated_to, family_id,
      with_usage, limit, offset,
    } = req.query ?? {};
    const filters = {};
    if (bank_id) filters.bank_id = bank_id;
    if (standard_id) filters.standard_id = standard_id;
    if (subject_id) filters.subject_id = subject_id;
    if (chapter_id) filters.chapter_id = chapter_id;
    if (topic_id) filters.topic_id = topic_id;
    if (family_id) filters.family_id = family_id;
    if (type) filters.type = type;
    if (difficulty) filters.difficulty = difficulty;
    if (level_id) filters.level_id = level_id;
    if (exam_type_id) filters.exam_type_id = exam_type_id;
    if (language_id) filters.language_id = language_id;
    if (exam_year) filters.exam_year = parseInt(exam_year, 10);
    if (status) filters.status = status;
    if (tags) filters.tags = tags.split(",");
    if (created_by) filters.created_by = created_by;
    if (search) filters.search = search;
    if (q) filters.q = q;
    if (min_marks !== undefined && min_marks !== "") filters.min_marks = parseInt(min_marks, 10);
    if (max_marks !== undefined && max_marks !== "") filters.max_marks = parseInt(max_marks, 10);
    if (min_negative_marks !== undefined && min_negative_marks !== "") filters.min_negative_marks = parseInt(min_negative_marks, 10);
    if (max_negative_marks !== undefined && max_negative_marks !== "") filters.max_negative_marks = parseInt(max_negative_marks, 10);
    if (created_from) filters.created_from = created_from;
    if (created_to) filters.created_to = created_to;
    if (updated_from) filters.updated_from = updated_from;
    if (updated_to) filters.updated_to = updated_to;
    filters.with_usage = with_usage === "true" || with_usage === "1";
    // Performance/memory guard: clamp page size so a huge `limit` can't pull
    // the whole question bank into memory in one response.
    const parsedLimit = parseInt(limit, 10);
    const parsedOffset = parseInt(offset, 10);
    filters.limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1), 500);
    filters.offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0);
    const questions = await listQuestions(filters);
    const total = await countQuestions({ ...filters, limit: undefined, offset: undefined, with_usage: undefined });
    res.json({ questions, total, limit: filters.limit, offset: filters.offset, with_usage: filters.with_usage });
  } catch (err) { next(err); }
});

// Aggregate per-hierarchy question counts for filter dropdowns.
app.get("/api/admin/questions/aggregate", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const q = req.query ?? {};
    const filters = {};
    for (const k of ["bank_id", "standard_id", "subject_id", "chapter_id", "topic_id", "type", "difficulty", "level_id", "exam_type_id", "language_id", "status", "search", "q", "created_from", "created_to", "updated_from", "updated_to"]) {
      if (q[k]) filters[k] = q[k];
    }
    if (q.exam_year) filters.exam_year = parseInt(q.exam_year, 10);
    if (q.tags) filters.tags = q.tags.split(",");
    if (q.min_marks !== undefined && q.min_marks !== "") filters.min_marks = parseInt(q.min_marks, 10);
    if (q.max_marks !== undefined && q.max_marks !== "") filters.max_marks = parseInt(q.max_marks, 10);
    if (q.min_negative_marks !== undefined && q.min_negative_marks !== "") filters.min_negative_marks = parseInt(q.min_negative_marks, 10);
    if (q.max_negative_marks !== undefined && q.max_negative_marks !== "") filters.max_negative_marks = parseInt(q.max_negative_marks, 10);
    if (q.include) filters.include = q.include;
    res.json(await questionAggregateCounts(filters));
  } catch (err) { next(err); }
});

app.get("/api/admin/questions/:id", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const question = await getQuestionById(req.params.id);
    if (!question) return res.status(404).json({ error: "Question not found.", code: "NOT_FOUND" });
    const options = await listQuestionOptions(req.params.id);
    const payload = await getQuestionPayload(req.params.id);
    res.json({ question, options, payload: payload?.payload ?? null });
  } catch (err) { next(err); }
});

app.patch("/api/admin/questions/:id", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_MANAGE), async (req, res, next) => {
  try {
    const existing = await getQuestionById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Question not found.", code: "NOT_FOUND" });
    const b = req.body ?? {};
    if (b.type && !VALID_QUESTION_TYPES.has(b.type)) return res.status(400).json({ error: "Invalid question type.", code: "VALIDATION" });
    if (b.difficulty && !VALID_DIFFICULTIES.has(b.difficulty)) return res.status(400).json({ error: "Invalid difficulty.", code: "VALIDATION" });
    if (b.status && !VALID_STATUSES.has(b.status)) return res.status(400).json({ error: "Invalid status.", code: "VALIDATION" });
    // Log changes
    const fieldsToLog = ["content","explanation","type","difficulty","level_id","exam_year","marks","negative_marks","status","tags","standard_id","subject_id","chapter_id","topic_id","exam_type_id","language_id"];
    for (const field of fieldsToLog) {
      if (b[field] !== undefined && JSON.stringify(b[field]) !== JSON.stringify(existing[field])) {
        await logQuestionEdit({
          question_id: req.params.id, edited_by: req.user.sub,
          field_changed: field, old_value: existing[field], new_value: b[field],
          change_summary: `Changed ${field}`,
        });
      }
    }
    const updated = await updateQuestion(req.params.id, b);
    // Update options if provided
    if (Array.isArray(b.options)) {
      await deleteQuestionOptionsByQuestion(req.params.id);
      for (let i = 0; i < b.options.length; i++) {
        const opt = b.options[i];
        await createQuestionOption({
          question_id: req.params.id, label: opt.label || String.fromCharCode(65 + i),
          content: opt.content, is_correct: opt.is_correct ?? false, sort_order: i,
        });
      }
    }
    if (b.payload) await upsertQuestionPayload(req.params.id, b.payload);
    const options = await listQuestionOptions(req.params.id);
    const payload = await getQuestionPayload(req.params.id);
    res.json({ question: updated, options, payload: payload?.payload ?? null });
  } catch (err) { next(err); }
});

app.delete("/api/admin/questions/:id", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_MANAGE), async (req, res, next) => {
  try {
    const question = await getQuestionById(req.params.id);
    if (!question) return res.status(404).json({ error: "Question not found.", code: "NOT_FOUND" });
    await deleteQuestion(req.params.id);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

app.post("/api/admin/questions/:id/duplicate", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_MANAGE), async (req, res, next) => {
  try {
    const dup = await duplicateQuestion(req.params.id, req.user.sub);
    if (!dup) return res.status(404).json({ error: "Question not found.", code: "NOT_FOUND" });
    res.status(201).json({ question: dup });
  } catch (err) { next(err); }
});

// Question history & analytics
app.get("/api/admin/questions/:id/history", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const [usage, edits, performance] = await Promise.all([
      getQuestionUsageHistory(req.params.id),
      getQuestionEditHistory(req.params.id),
      getQuestionPerformance(req.params.id),
    ]);
    res.json({ usage, edits, performance });
  } catch (err) { next(err); }
});

app.get("/api/admin/questions/:id/usage", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const summary = await getQuestionUsageSummary(req.params.id);
    res.json(summary);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Analytics dashboard (aggregate usage & performance)
// ---------------------------------------------------------------
app.get("/api/admin/analytics/overview", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (_req, res, next) => {
  try {
    res.json(await analyticsOverview());
  } catch (err) { next(err); }
});

app.get("/api/admin/analytics/most-used", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    res.json({ questions: await analyticsMostUsed(limit) });
  } catch (err) { next(err); }
});

app.get("/api/admin/analytics/unused", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    res.json({ questions: await analyticsUnused(limit) });
  } catch (err) { next(err); }
});

app.get("/api/admin/analytics/by-school", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (_req, res, next) => {
  try {
    res.json({ schools: await analyticsBySchool() });
  } catch (err) { next(err); }
});

app.get("/api/admin/analytics/by-teacher", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (_req, res, next) => {
  try {
    res.json({ teachers: await analyticsByTeacher() });
  } catch (err) { next(err); }
});

app.get("/api/admin/analytics/over-time", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (_req, res, next) => {
  try {
    res.json(await analyticsOverTime());
  } catch (err) { next(err); }
});

app.get("/api/admin/analytics/performance", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (_req, res, next) => {
  try {
    res.json(await analyticsPerformance());
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Admin: Tests (Phase 7 — Test Creation)
// ---------------------------------------------------------------
app.get("/api/admin/tests", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const { status, limit, offset } = req.query ?? {};
    const result = await listTests({
      status: typeof status === "string" ? status : undefined,
      limit: parseInt(limit, 10) || 100,
      offset: parseInt(offset, 10) || 0,
    });
    res.json(result);
  } catch (err) { next(err); }
});

app.get("/api/admin/tests/:id", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const result = await getTestById(req.params.id);
    if (!result) return res.status(404).json({ error: "Test not found.", code: "NOT_FOUND" });
    res.json(result);
  } catch (err) { next(err); }
});

app.post("/api/admin/tests", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_MANAGE), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    if (!isSafeIdentifier(b.title)) return res.status(400).json({ error: "Title is required.", code: "VALIDATION" });
    const questionIds = Array.isArray(b.questionIds) ? b.questionIds.filter((x) => typeof x === "string") : [];
    const created = await createTest({
      title: b.title.trim(),
      description: isSafeOptional(b.description, 2000) ? b.description : undefined,
      standard_id: isSafeOptional(b.standard_id) ? b.standard_id : undefined,
      subject_id: isSafeOptional(b.subject_id) ? b.subject_id : undefined,
      exam_type_id: isSafeOptional(b.exam_type_id) ? b.exam_type_id : undefined,
      language_id: isSafeOptional(b.language_id) ? b.language_id : undefined,
      duration_min: b.duration_min,
      total_marks: b.total_marks,
      passing_marks: b.passing_marks,
      shuffle_questions: b.shuffle_questions,
      shuffle_options: b.shuffle_options,
      show_results: b.show_results,
      show_answers: b.show_answers,
      status: b.status || "draft",
      created_by: req.user.sub,
      questionIds,
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

app.patch("/api/admin/tests/:id", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_MANAGE), async (req, res, next) => {
  try {
    const existing = await getTestById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Test not found.", code: "NOT_FOUND" });
    const b = req.body ?? {};
    if (b.title !== undefined && !isSafeIdentifier(b.title)) return res.status(400).json({ error: "Title is required.", code: "VALIDATION" });
    const patch = {};
    for (const key of ["title", "description", "standard_id", "subject_id", "exam_type_id", "language_id", "duration_min", "total_marks", "passing_marks", "shuffle_questions", "shuffle_options", "show_results", "show_answers", "status"]) {
      if (b[key] !== undefined) patch[key] = b[key];
    }
    const questionIds = Array.isArray(b.questionIds) ? b.questionIds.filter((x) => typeof x === "string") : undefined;
    const updated = await updateTest(req.params.id, patch, questionIds);
    res.json(updated);
  } catch (err) { next(err); }
});

app.delete("/api/admin/tests/:id", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_MANAGE), async (req, res, next) => {
  try {
    const removed = await deleteTest(req.params.id);
    if (!removed) return res.status(404).json({ error: "Test not found.", code: "NOT_FOUND" });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Admin: Papers (multi-language question papers)
// ---------------------------------------------------------------
app.get("/api/admin/papers", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const { status, limit, offset } = req.query ?? {};
    const isSuperAdmin = req.user?.role === "super_admin";
    // Performance/memory guard: clamp page size and offset so unbounded
    // requests can't force huge result sets into memory.
    const parsedLimit = parseInt(limit, 10);
    const parsedOffset = parseInt(offset, 10);
    const result = await listPapers({
      status: typeof status === "string" ? status : undefined,
      created_by: isSuperAdmin ? undefined : req.user.sub,
      limit: Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 100, 1), 200),
      offset: Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0),
    });
    res.json(result);
  } catch (err) { next(err); }
});

app.post("/api/admin/papers", requireAuth, requirePermission(PERMISSIONS.PAPERS_MANAGE), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    if (!isSafeIdentifier(b.title)) return res.status(400).json({ error: "Title is required.", code: "VALIDATION" });
    // Papers always enter the lifecycle as drafts (Phase 16): publishing runs
    // through the validation gate, which needs questions — impossible for a
    // brand-new empty paper.
    if (b.status && b.status !== "draft") {
      return res.status(400).json({
        error: "New papers are always created as drafts. Publish after validation from the paper detail page.",
        code: "LIFECYCLE_CREATION_BLOCKED",
      });
    }
    // familyIds entries: "<uuid>" (legacy) or { familyId, marks } (Paper Generator).
    const familyIds = Array.isArray(b.familyIds)
      ? b.familyIds
          .map((x) => (typeof x === "string" ? { familyId: x, marks: 0 } : x))
          .filter((x) => x && typeof x.familyId === "string" && x.familyId)
      : [];
    const created = await createPaper({
      title: b.title.trim(),
      description: isSafeOptional(b.description, 2000) ? b.description : undefined,
      standard_id: isSafeOptional(b.standard_id) ? b.standard_id : undefined,
      subject_id: isSafeOptional(b.subject_id) ? b.subject_id : undefined,
      exam_type_id: isSafeOptional(b.exam_type_id) ? b.exam_type_id : undefined,
      duration_min: b.duration_min,
      total_marks: b.total_marks,
      status: b.status || "draft",
      created_by: req.user.sub,
      familyIds,
    });
    if (created?.paper?.id) {
      await capturePaperVersion(created.paper.id, { reason: "created", createdBy: req.user.sub });
    }
    res.status(201).json(created);
  } catch (err) { next(err); }
});

app.get("/api/admin/papers/:id", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const result = await getPaperById(req.params.id);
    if (!result) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    res.json(result);
  } catch (err) { next(err); }
});

app.patch("/api/admin/papers/:id", requireAuth, requirePermission(PERMISSIONS.PAPERS_MANAGE), async (req, res, next) => {
  try {
    const existing = await getPaperById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    const b = req.body ?? {};
    if (b.title !== undefined && !isSafeIdentifier(b.title)) return res.status(400).json({ error: "Title is required.", code: "VALIDATION" });
    const patch = {};
    for (const key of ["title", "description", "standard_id", "subject_id", "exam_type_id", "duration_min", "total_marks", "status"]) {
      if (b[key] !== undefined) patch[key] = b[key];
    }
    // Lifecycle state machine (Phase 16): status changes must follow the
    // transition allowlist — published is a sink toward archived, and archived
    // can only leave via restore → draft (dedicated /archive and /restore
    // endpoints exist for those flows). Keeps PATCH from bypassing the
    // state machine that the dedicated endpoints enforce.
    if (
      patch.status !== undefined &&
      patch.status !== existing.paper.status &&
      !canTransitionPaper(existing.paper.status, patch.status)
    ) {
      return res.status(409).json({
        error: `Papers in state "${existing.paper.status}" cannot move to "${patch.status}".`,
        code: "TRANSITION_BLOCKED",
        from: existing.paper.status,
        to: patch.status,
      });
    }
    // Archived papers are read-only (Phase 16): metadata/content edits are
    // blocked until the paper is restored to draft via POST /restore.
    if (existing.paper.status === "archived" && Object.keys(patch).some((k) => k !== "status")) {
      return res.status(409).json({
        error: "Archived papers are read-only. Restore it to draft to make changes.",
        code: "ARCHIVED_ACTION_BLOCKED",
        status: "archived",
      });
    }
    // Status gate (Paper Generator Phase 6/16): any transition into
    // "published" or "validated" must pass the full validation suite — critical
    // errors block the transition. Only the status transition is gated; no
    // other field or behavior changes.
    const isValidationGateTransition =
      (patch.status === "published" && existing.paper.status !== "published") ||
      (patch.status === "validated" && existing.paper.status !== "validated");
    if (isValidationGateTransition) {
      const stored = await getPaperBlueprint(req.params.id);
      const languages = await listLanguages().catch(() => []);
      const usedLangs = new Set();
      for (const f of existing.families) {
        for (const v of f.variants ?? []) if (v.language_id) usedLangs.add(v.language_id);
      }
      const report = validatePaper(existing.paper, existing.families, stored?.blueprint ?? null, {
        languages,
        requiredLanguages: [...usedLangs].map((id) => {
          const lang = languages.find((l) => l.id === id);
          return lang ? { id: lang.id, name: lang.name } : { id, name: id };
        }),
        migrationRequired: stored?.migrationRequired === true,
      });
      if (!report.summary.canPublish) {
        return res.status(409).json({
          error: patch.status === "published"
            ? `Paper cannot be published — ${report.summary.errors} critical issue(s) found. Run validation for details.`
            : `Paper cannot be validated — ${report.summary.errors} critical issue(s) found. Run validation for details.`,
          code: patch.status === "published" ? "PUBLICATION_BLOCKED" : "VALIDATION_BLOCKED",
          summary: report.summary,
          results: report.results.filter((r) => r.level === "ERROR"),
        });
      }
    }
    // A "validated" paper that gets content-edited (family list or any field
    // other than a lifecycle status change) reverts to draft so the admin must
    // re-validate before it can be published again.
    if (existing.paper.status === "validated") {
      const contentKeys = Object.keys(patch).filter((k) => k !== "status");
      if (contentKeys.length > 0) {
        patch.status = computeStatusAfterContentEdit("validated", b.status === "validated" || b.status === "published" ? b.status : undefined);
      }
    }
    const familyIds = Array.isArray(b.familyIds)
      ? b.familyIds
          .map((x) => (typeof x === "string" ? { familyId: x, marks: 0 } : x))
          .filter((x) => x && typeof x.familyId === "string" && x.familyId)
      : undefined;
    const updated = await updatePaper(req.params.id, patch, familyIds);
    // Lifecycle clock: stamp validated_at/published_at/archived_at exactly when
    // the paper crosses that boundary (best-effort pre-migration 013).
    if (patch.status === "validated" && existing.paper.status !== "validated") {
      await transitionPaperStatus(req.params.id, "validated").catch(() => {});
    } else if (patch.status === "archived" && existing.paper.status !== "archived") {
      await transitionPaperStatus(req.params.id, "archived").catch(() => {});
    }
    // Auto-capture a "published" version whenever a paper crosses into
    // published — this pins exactly what was released. Best-effort: a
    // missing migration never fails the publish itself.
    if (patch.status === "published" && existing.paper.status !== "published") {
      await transitionPaperStatus(req.params.id, "published").catch(() => {});
      await capturePaperVersion(req.params.id, { reason: "published", createdBy: req.user.sub });
    }
    res.json(updated);
  } catch (err) { next(err); }
});

app.delete("/api/admin/papers/:id", requireAuth, requirePermission(PERMISSIONS.PAPERS_DELETE), async (req, res, next) => {
  try {
    const existing = await getPaperById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    // Never destroy released data through a normal UI action (Phase 16): a
    // published paper must be archived first, keeping version history intact.
    if (existing.paper.status === "published") {
      return res.status(409).json({
        error: "Published papers cannot be deleted directly. Archive it first — past versions are preserved automatically.",
        code: "PUBLISHED_DELETION_BLOCKED",
        status: existing.paper.status,
      });
    }
    const removed = await deletePaper(req.params.id);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Paper Lifecycle Management (Paper Generator Phase 16)
// ---------------------------------------------------------------
// The full Draft → Validated → Published → Archived lifecycle. Dedicated
// endpoints keep every transition explicit and auditable; the timestamp
// columns (validated_at/published_at/archived_at) are stamped on transition.
// All require QUESTION_BANKS_MANAGE except PDF export (VIEW).

// Validate + promote a paper to "validated". Read-only re-validation of an
// already-validated/published paper is allowed (returns the fresh report).
app.post("/api/admin/papers/:id/validate", requireAuth, requirePermission(PERMISSIONS.PAPERS_PUBLISH), async (req, res, next) => {
  try {
    const loaded = await getPaperById(req.params.id);
    if (!loaded) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    if (loaded.paper.status === "archived") {
      return res.status(409).json({
        error: "Archived papers cannot be validated. Restore it first.",
        code: "ARCHIVED_ACTION_BLOCKED",
        status: loaded.paper.status,
      });
    }
    const stored = await getPaperBlueprint(req.params.id);
    const languages = await listLanguages().catch(() => []);
    const usedLangs = new Set();
    for (const f of loaded.families) {
      for (const v of f.variants ?? []) if (v.language_id) usedLangs.add(v.language_id);
    }
    const report = validatePaper(loaded.paper, loaded.families, stored?.blueprint ?? null, {
      languages,
      requiredLanguages: [...usedLangs].map((id) => {
        const lang = languages.find((l) => l.id === id);
        return lang ? { id: lang.id, name: lang.name } : { id, name: id };
      }),
      migrationRequired: stored?.migrationRequired === true,
    });
    if (!report.summary.canPublish) {
      return res.status(409).json({
        error: `Paper cannot be validated — ${report.summary.errors} critical issue(s) found.`,
        code: "VALIDATION_BLOCKED",
        summary: report.summary,
        results: report.results.filter((r) => r.level === "ERROR"),
      });
    }
    let promoted = false;
    if (loaded.paper.status === "draft" || loaded.paper.status === "validated") {
      await transitionPaperStatus(req.params.id, "validated");
      promoted = true;
    }
    res.json({ validated: true, promoted, status: "validated", summary: report.summary });
  } catch (err) { next(err); }
});

// Duplicate a paper as a new draft (families + blueprint + translations; sets
// are deliberately not copied).
app.post("/api/admin/papers/:id/duplicate", requireAuth, requirePermission(PERMISSIONS.PAPERS_MANAGE), async (req, res, next) => {
  try {
    const existed = await getPaperById(req.params.id);
    if (!existed) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    const created = await duplicatePaper(req.params.id, req.user.sub);
    if (!created?.paper?.id) {
      return res.status(500).json({ error: "Could not duplicate paper.", code: "DUPLICATE_FAILED" });
    }
    await capturePaperVersion(created.paper.id, {
      reason: "created",
      note: `Duplicated from "${existed.paper.title}"`,
      createdBy: req.user.sub,
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// Archive a paper. Allowed from draft/validated/published. Idempotent: an
// already-archived paper stays archived.
app.post("/api/admin/papers/:id/archive", requireAuth, requirePermission(PERMISSIONS.PAPERS_DELETE), async (req, res, next) => {
  try {
    const loaded = await getPaperById(req.params.id);
    if (!loaded) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    if (loaded.paper.status === "archived") {
      return res.json({ archived: true, status: "archived" });
    }
    if (!canTransitionPaper(loaded.paper.status, "archived")) {
      return res.status(409).json({
        error: `Papers in state "${loaded.paper.status}" cannot be archived.`,
        code: "TRANSITION_BLOCKED",
        from: loaded.paper.status,
        to: "archived",
      });
    }
    await transitionPaperStatus(req.params.id, "archived");
    res.json({ archived: true, status: "archived" });
  } catch (err) { next(err); }
});

// Restore an archived paper back to draft (lifecycle restore). Distinct from
// POST /versions/:version/restore which re-materializes historical content.
app.post("/api/admin/papers/:id/restore", requireAuth, requirePermission(PERMISSIONS.PAPERS_MANAGE), async (req, res, next) => {
  try {
    const loaded = await getPaperById(req.params.id);
    if (!loaded) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    if (loaded.paper.status !== "archived") {
      return res.status(409).json({
        error: "Only archived papers can be restored to draft.",
        code: "NOT_ARCHIVED",
        status: loaded.paper.status,
      });
    }
    await transitionPaperStatus(req.params.id, "draft", { clear: ["archived_at"] });
    res.json({ restored: true, status: "draft" });
  } catch (err) { next(err); }
});

// Export a paper to PDF (server-rendered via Puppeteer + KaTeX). Optional
// `language` selects the resolved language; leave it out for primary variants.
app.get("/api/admin/papers/:id/pdf", requireAuth, requirePermission(PERMISSIONS.PAPERS_EXPORT), async (req, res, next) => {
  try {
    const loaded = await getPaperById(req.params.id);
    if (!loaded) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });

    const langId = typeof req.query.language === "string" ? req.query.language : null;
    let questions = [];
    let languageName = null;

    if (langId) {
      const languages = await listLanguages().catch(() => []);
      const lang = languages.find((l) => l.id === langId);
      languageName = lang?.name ?? null;
      const resolved = await getPaperInLanguageStrict(req.params.id, langId, {
        mode: req.query.mode === "strict" ? "strict" : "substitute",
      });
      questions = (resolved?.questions ?? []).map((q) => ({
        ...q.question,
        marks: Number(q.marks) || 0,
        section_key: q.section_key ?? null,
      }));
    } else {
      // Primary variant per family (the language each family was assigned to).
      const languageById = new Map(
        (await listLanguages().catch(() => [])).map((l) => [l.id, l])
      );
      for (const fam of loaded.families) {
        if (fam.primary) {
          if (!languageName && fam.primary.language_id) {
            const lang = languageById.get(fam.primary.language_id);
            if (lang) languageName = lang.name;
          }
          questions.push({
            ...fam.primary,
            marks: Number(fam.marks) || Number(fam.primary.marks) || 0,
            section_key: fam.section_key ?? null,
          });
        }
      }
    }

    const html = buildPaperHtml(loaded.paper, questions, {
      title: loaded.paper.title,
      description: loaded.paper.description,
      durationMin: loaded.paper.duration_min,
      totalMarks: loaded.paper.total_marks,
      languageName,
    });
    const pdf = await htmlToPdfBuffer(html);
    const slug = String(loaded.paper.title || "paper")
      .replace(/[^\w\s-]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "paper";
    const langSlug = langId
      ? `${(languageName || langId).replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "lang"}`
      : "paper";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${slug}-${langSlug}.pdf"`);
    res.send(Buffer.from(pdf));
  } catch (err) { next(err); }
});

// Key endpoint: paper resolved to a requested language. Any authenticated
// teacher can print a paper; the resolved content excludes answer keys.
// ---------------------------------------------------------------
// Paper structure (Paper Generator Phase 4)
// ---------------------------------------------------------------
// Effective structure: ordered sections with per-section metadata, global
// question numbering and totals (total questions, total marks, maximum
// possible score, minimum score under negative marking). Backward compatible:
// papers without a blueprint render as a single implicit section.
app.get("/api/admin/papers/:id/structure", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const loaded = await getPaperById(req.params.id);
    if (!loaded) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    const stored = await getPaperBlueprint(req.params.id);
    const blueprint = stored?.blueprint ?? null;
    const structure = computePaperStructure(loaded.paper, loaded.families, blueprint);
    res.json({
      paper: loaded.paper,
      blueprint: blueprint,
      ...structure,
      migrationRequired: stored?.migrationRequired === true,
    });
  } catch (err) { next(err); }
});

// Paper Validation Engine (Paper Generator Phase 6)
// ---------------------------------------------------------------
// Runs the full pre-publish validation suite (duplicates, required data,
// options/answers, media, blueprint & section compliance, counts, marks,
// negative marking, language coverage). Read-only: never mutates content.
// `?requiredLanguage=<id>` marks languages the paper must fully cover.
app.get("/api/admin/papers/:id/validate", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const loaded = await getPaperById(req.params.id);
    if (!loaded) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    const stored = await getPaperBlueprint(req.params.id);
    const languages = await listLanguages().catch(() => []);
    // Required languages: explicit query params, defaulting to every language
    // that at least one variant already uses (keeps existing papers valid).
    let requiredLanguageIds = Array.isArray(req.query.requiredLanguage)
      ? req.query.requiredLanguage
      : req.query.requiredLanguage
      ? [req.query.requiredLanguage]
      : null;
    if (!requiredLanguageIds) {
      const used = new Set();
      for (const f of loaded.families) {
        for (const v of f.variants ?? []) if (v.language_id) used.add(v.language_id);
      }
      requiredLanguageIds = [...used];
    }
    const requiredLanguages = requiredLanguageIds
      .map((id) => {
        const lang = languages.find((l) => l.id === id);
        return lang ? { id: lang.id, name: lang.name } : { id, name: id };
      })
      .filter(Boolean);
    const report = validatePaper(loaded.paper, loaded.families, stored?.blueprint ?? null, {
      languages,
      requiredLanguages,
      migrationRequired: stored?.migrationRequired === true,
    });
    res.json({ paperId: loaded.paper.id, ...report });
  } catch (err) { next(err); }
});

// Replace the ordered family list with explicit section assignments
// ({ familyId, marks, sectionKey }[]). Same guard set as papers PATCH.
app.put("/api/admin/papers/:id/families", requireAuth, requirePermission(PERMISSIONS.PAPERS_MANAGE), async (req, res, next) => {
  try {
    const existing = await getPaperById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    if (existing.paper.status === "archived") {
      return res.status(409).json({
        error: "Archived papers are read-only. Restore it to draft first.",
        code: "ARCHIVED_ACTION_BLOCKED",
        status: "archived",
      });
    }
    const list = Array.isArray(req.body?.families) ? req.body.families : [];
    const entries = list
      .map((x) => (typeof x === "string" ? { familyId: x, marks: 0 } : x))
      .filter((x) => x && typeof x.familyId === "string" && x.familyId);
    const updated = await updatePaper(req.params.id, {}, entries);
    res.json(updated);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Replace question (Paper Generator Phase 5)
// ---------------------------------------------------------------
// Swaps one family reference inside the paper for another. The replacement is
// chosen by a deterministic relaxation ladder (exact → topic → chapter → type
// → difficulty → any), constrained to the paper's standard/subject, published
// only, and never a family already in the paper. The original Question Bank
// question is never modified. With body { dryRun: true } nothing is saved —
// the proposed match is returned for preview.
app.post("/api/admin/papers/:id/families/:familyId/replace", requireAuth, requirePermission(PERMISSIONS.PAPERS_MANAGE), async (req, res, next) => {
  try {
    const loaded = await getPaperById(req.params.id);
    if (!loaded) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    if (loaded.paper.status === "archived") {
      return res.status(409).json({
        error: "Archived papers are read-only. Restore it to draft first.",
        code: "ARCHIVED_ACTION_BLOCKED",
        status: "archived",
      });
    }
    const currentRef = loaded.families.find((f) => f.family_id === req.params.familyId);
    if (!currentRef) {
      return res.status(404).json({ error: "Question family not found on this paper.", code: "NOT_FOUND" });
    }

    const paper = loaded.paper;
    const candidates = await listQuestions({
      status: "published",
      standard_id: paper.standard_id || undefined,
      subject_id: paper.subject_id || undefined,
      limit: 500,
    });
    const excludeFamilyIds = loaded.families.map((f) => f.family_id);
    const replacement = findReplacement(
      candidates,
      {
        familyId: req.params.familyId,
        chapterId: currentRef.primary?.chapter_id ?? null,
        topicId: currentRef.primary?.topic_id ?? null,
        type: currentRef.primary?.type ?? null,
        difficulty: currentRef.primary?.difficulty ?? null,
        marks: Number(currentRef.marks) || (currentRef.primary?.marks ?? null),
      },
      excludeFamilyIds,
      req.body?.seed || `replace:${req.params.id}:${req.params.familyId}`
    );

    if (!replacement.question) {
      // Clear feedback instead of a silent substitute.
      return res.status(409).json({
        error: "No suitable replacement exists.",
        code: "REPLACEMENT_UNAVAILABLE",
        reason: replacement.reason,
      });
    }

    if (req.body?.dryRun) {
      return res.json({
        dryRun: true,
        match: replacement.match,
        exact: replacement.exact,
        replacement: replacement.question,
      });
    }

    // Swap the reference in place: same position, marks, section and lock state.
    const entries = loaded.families.map((f) => ({
      familyId: f.family_id,
      marks: Number(f.marks) || 0,
      sectionKey: f.section_key || undefined,
      locked: Boolean(f.locked),
    }));
    const idx = entries.findIndex((e) => e.familyId === req.params.familyId);
    entries[idx] = {
      familyId: replacement.question.family_id,
      marks: entries[idx].marks,
      sectionKey: entries[idx].sectionKey,
      locked: entries[idx].locked,
    };
    const updated = await updatePaper(req.params.id, {}, entries);
    if (!updated) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });

    res.json({
      match: replacement.match,
      exact: replacement.exact,
      replacedWith: replacement.question,
      families: updated.families,
      paper: updated.paper,
    });
  } catch (err) { next(err); }
});

app.get("/api/admin/papers/:id/print", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const { language } = req.query ?? {};
    if (!language || typeof language !== "string") {
      return res.status(400).json({ error: "language query param is required.", code: "VALIDATION" });
    }
    const result = await getPaperInLanguage(req.params.id, language);
    if (!result) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    res.json(result);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Multilingual Paper Engine (Paper Generator Phase 8)
// ---------------------------------------------------------------
// Language-aware paper rendering. Query `mode=strict` reports translation
// gaps instead of substituting other-language variants (the legacy `print`
// route above keeps its substitution behavior for backward compatibility).
app.get("/api/admin/papers/:id/language", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const { language, mode } = req.query ?? {};
    if (!language || typeof language !== "string") {
      return res.status(400).json({ error: "language query param is required.", code: "VALIDATION" });
    }
    const result = await getPaperInLanguageStrict(req.params.id, language, {
      mode: mode === "strict" ? "strict" : "substitute",
    });
    if (!result) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    res.json(result);
  } catch (err) { next(err); }
});

// Full translation readiness report for every configured language.
app.get("/api/admin/papers/:id/translations", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const loaded = await getPaperById(req.params.id);
    if (!loaded) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    const languages = await listLanguages().catch(() => []);
    const stored = await getPaperSets(req.params.id).catch(() => null);
    const doc = stored?.translations ?? null;
    const report = computeTranslationReport(loaded.families, languages, doc);
    res.json({ paperId: loaded.paper.id, translations: doc, ...report });
  } catch (err) { next(err); }
});

// Save the paper's per-language readiness doc (state/note/section
// instructions per language). Body: { translations: {...} } or null to clear.
app.put("/api/admin/papers/:id/translations", requireAuth, requirePermission(PERMISSIONS.PAPERS_TRANSLATIONS_MANAGE), async (req, res, next) => {
  try {
    const existing = await getPaperById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    const doc = req.body?.translations;
    if (doc !== null && (typeof doc !== "object" || Array.isArray(doc))) {
      return res.status(400).json({ error: "translations must be an object or null.", code: "VALIDATION" });
    }
    try {
      await updatePaperTranslations(req.params.id, doc ?? null);
    } catch (err) {
      if (/Translation storage is not available/i.test(String(err?.message))) {
        return res.status(503).json({
          error: err.message,
          code: "TRANSLATION_STORAGE_UNAVAILABLE",
          migrationRequired: true,
        });
      }
      throw err;
    }
    res.json({ saved: true, translations: doc ?? null });
  } catch (err) { next(err); }
});

// Set the workflow state on ONE question variant (a single language version
// of a logical question). The variant is not otherwise modified.
app.patch("/api/admin/questions/:id/translation-status", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_MANAGE), async (req, res, next) => {
  try {
    const question = await getQuestionById(req.params.id);
    if (!question) return res.status(404).json({ error: "Question not found.", code: "NOT_FOUND" });
    const status = req.body?.status;
    if (!TRANSLATION_WORKFLOW_STATES.includes(status)) {
      return res.status(400).json({
        error: "status must be one of draft | translated | reviewed | approved.",
        code: "VALIDATION",
      });
    }
    try {
      await updateQuestionTranslationStatus(req.params.id, status);
    } catch (err) {
      if (/Translation state storage is not available/i.test(String(err?.message))) {
        return res.status(503).json({
          error: err.message,
          code: "TRANSLATION_STORAGE_UNAVAILABLE",
          migrationRequired: true,
        });
      }
      throw err;
    }
    res.json({ question: await getQuestionById(req.params.id) });
  } catch (err) { next(err); }
});

app.get("/api/admin/papers/:id/languages", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const result = await getPaperLanguages(req.params.id);
    if (!result) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    res.json(result);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Separate Language Paper Generation (Paper Generator Phase 9)
// ---------------------------------------------------------------
// A language paper is a derived artifact of the master paper. Question
// families always come from the master (NEVER re-selected per language);
// only the language-specific text changes. Version metadata + master
// traceability ship on every generated representation.
app.get("/api/admin/papers/:id/language-papers", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const master = await getPaperById(req.params.id);
    if (!master) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    const versions = await listLanguagePapers(req.params.id).catch((err) => {
      if (/Language paper storage is not available/i.test(String(err?.message))) return { list: [], migrationRequired: true };
      throw err;
    });
    const papers = Array.isArray(versions) ? versions : [];
    const migrationRequired = Array.isArray(versions) ? false : versions.migrationRequired;
    const languages = await listLanguages().catch(() => []);
    const langById = new Map(languages.map((l) => [l.id, l]));
    res.json({
      paperId: req.params.id,
      masterTitle: master.paper.title,
      languages: [...new Set(papers.map((p) => p.language_id))].map((id) => {
        const lang = langById.get(id) ?? null;
        return { id, code: lang?.code ?? null, name: lang?.name ?? id };
      }),
      migrationRequired,
      papers: papers.map((p) => ({
        ...p,
        language: langById.get(p.language_id) ?? { id: p.language_id, code: null, name: p.language_id },
      })),
    });
  } catch (err) { next(err); }
});

// Generate a language paper artifact. Body: { languageId, setKey?, mode? }.
app.post("/api/admin/papers/:id/language-papers", requireAuth, requirePermission(PERMISSIONS.PAPERS_TRANSLATIONS_MANAGE), async (req, res, next) => {
  try {
    const { languageId, setKey, mode } = req.body ?? {};
    if (!languageId || typeof languageId !== "string") {
      return res.status(400).json({ error: "languageId is required.", code: "VALIDATION" });
    }
    const master = await getPaperById(req.params.id);
    if (!master) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });

    const languages = await listLanguages().catch(() => []);
    const language = languages.find((l) => l.id === languageId);
    if (!language) {
      return res.status(400).json({ error: "Unknown language.", code: "VALIDATION" });
    }

    const blueprint = await getPaperBlueprint(req.params.id).catch(() => null);

    // Explicit randomization reuses a STORED set's family order; the family
    // set itself is never changed and no questions are re-selected.
    let orderFamilyIds = null;
    let resolvedSetKey = setKey ?? null;
    if (resolvedSetKey) {
      const stored = await getPaperSets(req.params.id).catch(() => null);
      const set = stored?.sets?.sets?.find((s) => s.key === resolvedSetKey);
      if (set) orderFamilyIds = set.questions.map((q) => q.familyId);
      else {
        resolvedSetKey = null;
        // fall through with master order; generation still succeeds
      }
    }

    const { snapshot, errors, warnings } = buildLanguagePaperSnapshot(
      master.paper,
      master.families,
      languageId,
      blueprint?.blueprint ?? null,
      { setKey: resolvedSetKey, orderFamilyIds, mode: mode === "strict" ? "strict" : "substitute" }
    );

    const generationWarnings = [...warnings];
    if (resolvedSetKey === null && setKey) generationWarnings.push("Requested randomization set was not found; generated from the master order.");

    if (snapshot && snapshot.missing_count > 0 && mode === "strict") {
      return res.status(422).json({ error: errors.join(" "), code: "TRANSLATION_INCOMPLETE", missing: snapshot.missing_count, warnings: generationWarnings });
    }
    if (!snapshot) {
      return res.status(422).json({ error: errors.join(" ") || "Cannot generate a language paper for this master paper.", code: "UNSUPPORTED", warnings: generationWarnings });
    }

    const existing = await listLanguagePapers(req.params.id);
    const maxVersion = existing.reduce((m, p) => Math.max(m, Number(p.version) || 0), 0);
    const version = maxVersion + 1;

    let stored;
    try {
      stored = await createLanguagePaper({
        master_paper_id: master.paper.id,
        language_id: languageId,
        version,
        set_key: resolvedSetKey,
        status: "generated",
        generated_by: req.user?.id ?? null,
        snapshot,
      });
    } catch (err) {
      if (/Language paper storage is not available/i.test(String(err?.message))) {
        return res.status(503).json({ error: err.message, code: "LANGUAGE_PAPER_STORAGE_UNAVAILABLE", migrationRequired: true });
      }
      throw err;
    }

    res.status(201).json({
      paperId: master.paper.id,
      language: { id: language.id, code: language.code ?? null, name: language.name },
      version,
      status: stored.status,
      setKey: resolvedSetKey,
      warnings: generationWarnings,
      snapshot,
    });
  } catch (err) { next(err); }
});

// Resolve one generated language paper into a full paper representation:
// language content, answer mapping and section metadata are derived from the
// SNAPSHOT's resolved variants while the master paper provides structure.
app.get("/api/admin/papers/:id/language-papers/:version", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    let stored;
    try {
      stored = await getLanguagePaperData(req.params.id, Number(req.params.version));
    } catch (err) {
      if (/Language paper storage is not available/i.test(String(err?.message))) {
        return res.status(503).json({ error: err.message, code: "LANGUAGE_PAPER_STORAGE_UNAVAILABLE", migrationRequired: true });
      }
      throw err;
    }
    if (!stored || !stored.snapshot) return res.status(404).json({ error: "Language paper not found.", code: "NOT_FOUND" });

    const master = await getPaperById(req.params.id);
    if (!master) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    const languages = await listLanguages().catch(() => []);
    const language = languages.find((l) => l.id === stored.language_id) ?? null;

    const blueprint = await getPaperBlueprint(req.params.id).catch(() => null);
    const sets = await getPaperSets(req.params.id).catch(() => null);
    const sectionNegatives = new Map();
    for (const s of Array.isArray(blueprint?.blueprint?.sections) ? blueprint.blueprint.sections : []) {
      sectionNegatives.set(s.id, Number(s.negativeMarks) || 0);
    }
    const negativeOf = (sectionKey) => (sectionKey ? sectionNegatives.get(sectionKey) ?? 0 : 0);

    // Per-question negative marks mirror section metadata (0 for unassigned).
    const snapByFamily = new Map(stored.snapshot.questions.map((q) => [q.family_id, q]));

    const sections = (stored.snapshot.sections ?? []).map((sec) => {
      const nos = (stored.snapshot.questions ?? [])
        .filter((q) => q.section_key === sec.key || (!q.section_key && sec.key === "__default__"))
        .map((q) => q.number);
      return {
        key: sec.key,
        name: sec.name,
        negativeMarks: Number(sec.negativeMarks) ?? negativeOf(sec.key) ?? 0,
        questionCount: sec.questionCount ?? nos.length ?? 0,
      };
    });

    const questions = [];
    const missing = [];
    let substitutedCount = 0;
    for (const q of stored.snapshot.questions ?? []) {
      const base = {
        family_id: q.family_id,
        number: q.number,
        sort_order: q.sort_order ?? 0,
        marks: Number(q.marks) || 0,
        negative_marks: negativeOf(q.section_key ?? null),
        section_key: q.section_key ?? null,
        resolved_language_id: q.resolved_language_id ?? stored.language_id,
        substituted: q.substituted ?? false,
        translation_status: q.translation_status ?? "missing",
        invariant_issues: Array.isArray(q.invariant_issues) ? q.invariant_issues : [],
        content_hash: q.content_hash ?? null,
      };
      if (!q.resolved_variant_id) {
        missing.push({ ...base, question: null, answer: null });
        continue;
      }
      const variant = snapVariantFor(master, q.family_id, (fam) =>
        fam.variants?.find((v) => v.id === q.resolved_variant_id) ?? fam.variants?.[0] ?? null
      );
      if (!variant) {
        missing.push({ ...base, question: null, answer: null });
        continue;
      }
      if (base.substituted) substitutedCount += 1;
      const { answer, displayOptions } = resolveSetQuestionAnswer(variant, null);
      questions.push({
        ...base,
        question: variant,
        answer,
        displayOptions,
      });
    }

    const translationDoc = sets?.translations ?? null;
    const sectionInstructions = translationDoc?.languages?.[stored.language_id]?.sections ?? {};

    res.json({
      paper: {
        id: master.paper.id,
        title: master.paper.title,
        description: master.paper.description ?? null,
        duration_min: master.paper.duration_min,
        total_marks: Number(stored.snapshot.total_marks) || master.paper.total_marks,
        status: master.paper.status,
      },
      language: language ? { id: language.id, code: language.code ?? null, name: language.name } : stored.language_id,
      version: stored.version,
      status: stored.status,
      generated_at: stored.generated_at,
      set_key: stored.set_key,
      complete: (stored.snapshot.complete ?? false) && missing.length === 0,
      missing_count: (stored.snapshot.missing_count ?? 0) + missing.length,
      substituted_count: (stored.snapshot.substituted_count ?? 0) + substitutedCount,
      sections,
      sectionInstructions,
      questions,
      missing,
    });
  } catch (err) { next(err); }
});

// Update workflow status of one generated language paper.
app.patch("/api/admin/papers/:id/language-papers/:version", requireAuth, requirePermission(PERMISSIONS.PAPERS_TRANSLATIONS_MANAGE), async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (!LANGUAGE_PAPER_STATES.includes(status)) {
      return res.status(400).json({
        error: `status must be one of ${LANGUAGE_PAPER_STATES.join(" | ")}.`,
        code: "VALIDATION",
      });
    }
    let updated;
    try {
      updated = await updateLanguagePaperStatus(req.params.id, Number(req.params.version), status);
    } catch (err) {
      if (/Language paper storage is not available/i.test(String(err?.message))) {
        return res.status(503).json({ error: err.message, code: "LANGUAGE_PAPER_STORAGE_UNAVAILABLE", migrationRequired: true });
      }
      throw err;
    }
    if (!updated) return res.status(404).json({ error: "Language paper not found.", code: "NOT_FOUND" });
    res.json({ paperId: req.params.id, version: updated.version, status: updated.status });
  } catch (err) { next(err); }
});

// Delete one language paper version.
app.delete("/api/admin/papers/:id/language-papers/:version", requireAuth, requirePermission(PERMISSIONS.PAPERS_TRANSLATIONS_MANAGE), async (req, res, next) => {
  try {
    let deleted;
    try {
      deleted = await deleteLanguagePaper(req.params.id, Number(req.params.version));
    } catch (err) {
      if (/Language paper storage is not available/i.test(String(err?.message))) {
        return res.status(503).json({ error: err.message, code: "LANGUAGE_PAPER_STORAGE_UNAVAILABLE", migrationRequired: true });
      }
      throw err;
    }
    if (!deleted) return res.status(404).json({ error: "Language paper not found.", code: "NOT_FOUND" });
    res.json({ deleted: true, paperId: req.params.id, version: deleted.version });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Reusable paper templates (Paper Generator Phase 11)
// ---------------------------------------------------------------
const PAPER_TEMPLATE_KINDS = new Set(["single", "bilingual", "custom"]);

function validatePaperTemplateBody(body) {
  const errors = [];
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) errors.push("name is required.");
  const kind = body?.kind ?? "single";
  if (!PAPER_TEMPLATE_KINDS.has(kind)) errors.push("kind must be one of: single, bilingual, custom.");
  const config = body?.config && typeof body.config === "object" && !Array.isArray(body.config) ? body.config : {};
  return { name, kind, config, errors };
}

// List saved templates. Optional ?kind= filter.
app.get("/api/admin/templates", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    if (kind && !PAPER_TEMPLATE_KINDS.has(kind)) {
      return res.status(400).json({ error: "Invalid kind filter.", code: "VALIDATION" });
    }
    const templates = await listPaperTemplates(kind);
    res.json({ templates });
  } catch (err) { next(err); }
});

// The one flagged default template for a kind.
app.get("/api/admin/templates/default", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const kind = typeof req.query.kind === "string" ? req.query.kind : "single";
    if (!PAPER_TEMPLATE_KINDS.has(kind)) {
      return res.status(400).json({ error: "Invalid kind.", code: "VALIDATION" });
    }
    const template = await getDefaultPaperTemplate(kind);
    res.json({ template });
  } catch (err) { next(err); }
});

// Create one template.
app.post("/api/admin/templates", requireAuth, requirePermission(PERMISSIONS.PAPERS_TEMPLATES_MANAGE), async (req, res, next) => {
  try {
    const { name, kind, config, errors } = validatePaperTemplateBody(req.body ?? {});
    if (errors.length) return res.status(400).json({ error: errors.join(" "), code: "VALIDATION" });
    const created = await createPaperTemplate({
      name,
      description: typeof req.body.description === "string" ? req.body.description : null,
      kind,
      config,
      is_default: Boolean(req.body.is_default),
      created_by: req.user?.id ?? null,
    });
    res.status(201).json({ template: created });
  } catch (err) {
    if (/Paper template storage is not available/i.test(String(err?.message))) {
      return res.status(503).json({ error: err.message, code: "PAPER_TEMPLATE_STORAGE_UNAVAILABLE", migrationRequired: true });
    }
    next(err);
  }
});

// One saved template.
app.get("/api/admin/templates/:id", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const template = await getPaperTemplate(req.params.id);
    if (!template) return res.status(404).json({ error: "Template not found.", code: "NOT_FOUND" });
    res.json({ template });
  } catch (err) { next(err); }
});

// Patch one template (name, description, kind, config, is_default).
app.patch("/api/admin/templates/:id", requireAuth, requirePermission(PERMISSIONS.PAPERS_TEMPLATES_MANAGE), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return res.status(400).json({ error: "name cannot be empty.", code: "VALIDATION" });
    }
    if (body.kind !== undefined && !PAPER_TEMPLATE_KINDS.has(body.kind)) {
      return res.status(400).json({ error: "kind must be one of: single, bilingual, custom.", code: "VALIDATION" });
    }
    if (body.config !== undefined && (typeof body.config !== "object" || Array.isArray(body.config))) {
      return res.status(400).json({ error: "config must be an object.", code: "VALIDATION" });
    }
    const updated = await updatePaperTemplate(req.params.id, {
      name: body.name,
      description: body.description,
      kind: body.kind,
      config: body.config,
      is_default: body.is_default,
    });
    if (!updated) return res.status(404).json({ error: "Template not found.", code: "NOT_FOUND" });
    res.json({ template: updated });
  } catch (err) {
    if (/Paper template storage is not available/i.test(String(err?.message))) {
      return res.status(503).json({ error: err.message, code: "PAPER_TEMPLATE_STORAGE_UNAVAILABLE", migrationRequired: true });
    }
    next(err);
  }
});

// Delete one template.
app.delete("/api/admin/templates/:id", requireAuth, requirePermission(PERMISSIONS.PAPERS_TEMPLATES_MANAGE), async (req, res, next) => {
  try {
    const deleted = await deletePaperTemplate(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Template not found.", code: "NOT_FOUND" });
    res.json({ deleted: true, id: deleted.id });
  } catch (err) {
    if (/Paper template storage is not available/i.test(String(err?.message))) {
      return res.status(503).json({ error: err.message, code: "PAPER_TEMPLATE_STORAGE_UNAVAILABLE", migrationRequired: true });
    }
    next(err);
  }
});

function snapVariantFor(master, familyId, pick) {
  const fam = (master.families ?? []).find((f) => f.family_id === familyId);
  return fam ? pick(fam) : null;
}

// ---------------------------------------------------------------
// Paper blueprint (Paper Generator Phase 2)
// ---------------------------------------------------------------
app.get("/api/admin/papers/:id/blueprint", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const result = await getPaperBlueprint(req.params.id);
    if (!result) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    res.json(result);
  } catch (err) { next(err); }
});

app.put("/api/admin/papers/:id/blueprint", requireAuth, requirePermission(PERMISSIONS.PAPERS_MANAGE), async (req, res, next) => {
  try {
    const existing = await getPaperById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    if (existing.paper.status === "archived") {
      return res.status(409).json({
        error: "Archived papers are read-only. Restore it to draft first.",
        code: "ARCHIVED_ACTION_BLOCKED",
        status: "archived",
      });
    }
    const { blueprint: rawBlueprint } = req.body ?? {};
    const { blueprint, errors } = normalizeBlueprint(rawBlueprint);
    const validation = validateBlueprint(blueprint);
    if (!errors.length && validation.errors.length > 0) {
      return res.status(400).json({
        error: "Blueprint is not logically consistent.",
        code: "BLUEPRINT_INVALID",
        validation,
      });
    }
    const updated = await updatePaper(req.params.id, { blueprint });
    if (!updated) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    res.json({ paper: updated.paper, blueprint, normalizationErrors: errors, validation });
  } catch (err) { next(err); }
});

// Validate without saving. Accepts { blueprint } in the body; falls back to
// the stored blueprint when no body is provided.
app.post("/api/admin/papers/:id/blueprint/validate", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    let candidate = req.body?.blueprint;
    if (candidate === undefined) {
      const stored = await getPaperBlueprint(req.params.id);
      if (!stored) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
      candidate = stored.blueprint;
      if (candidate === null) {
        return res.json({ valid: true, errors: [], warnings: ["No blueprint saved yet."], summary: null });
      }
    }
    const { blueprint, errors } = normalizeBlueprint(candidate);
    const validation = validateBlueprint(blueprint);
    res.json({ valid: errors.length === 0 && validation.errors.length === 0, normalizationErrors: errors, ...validation });
  } catch (err) { next(err); }
});

// Preview of expected paper composition + live availability per rule.
app.post("/api/admin/papers/:id/blueprint/preview", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    let candidate = req.body?.blueprint;
    if (candidate === undefined) {
      const stored = await getPaperBlueprint(req.params.id);
      if (!stored) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
      candidate = stored.blueprint;
      if (candidate === null) {
        return res.status(400).json({ error: "No blueprint saved for this paper.", code: "BLUEPRINT_MISSING" });
      }
    }
    const { blueprint, errors } = normalizeBlueprint(candidate);
    const validation = validateBlueprint(blueprint);

    // Availability counts against the existing Question Bank via the same
    // filter engine as listQuestions (no new query semantics).
    const loadCounts = (filters) => countQuestions({ status: "published", ...filters });
    const availability = await previewBlueprintAvailability(
      { ...blueprint, standardId: req.body?.standardId ?? null, subjectId: req.body?.subjectId ?? null },
      loadCounts
    );

    res.json({
      validation: { errors, warnings: validation.warnings, summary: validation.summary },
      sections: blueprint.sections.map((s) => ({
        id: s.id,
        name: s.name,
        marksPerQuestion: s.marksPerQuestion,
        negativeMarks: s.negativeMarks,
        questionCount: s.questionCount,
        marks: s.questionCount * s.marksPerQuestion,
      })),
      availability,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Question selection (Paper Generator Phase 3)
// ---------------------------------------------------------------
// Generates the paper's question list from the stored blueprint using the
// EXISTING Question Bank as source of truth. Modes:
//   - automatic: fills every blueprint slot from the bank
//   - hybrid:    body.lockFamilyIds are kept (consume demand first); the
//                system fills only the remaining slots, never duplicating a
//                locked family
// Deterministic per (paperId, seed) so regenerating with the same seed
// reproduces the exact same paper. On shortage: nothing is saved; the
// response carries a structured shortage report instead.
app.post("/api/admin/papers/:id/generate", requireAuth, requirePermission(PERMISSIONS.PAPERS_GENERATE), async (req, res, next) => {
  try {
    const stored = await getPaperBlueprint(req.params.id);
    if (!stored) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    // A body blueprint acts as a dry-run override (nothing is persisted as
    // blueprint); otherwise the stored blueprint is used.
    const rawBlueprint = req.body?.blueprint ?? stored.blueprint;
    if (rawBlueprint === null || rawBlueprint === undefined) {
      return res.status(400).json({
        error: "Save a blueprint before generating the paper.",
        code: "BLUEPRINT_MISSING",
        migrationRequired: stored.migrationRequired === true,
      });
    }

    const { blueprint } = normalizeBlueprint(rawBlueprint);
    const validation = validateBlueprint(blueprint);
    if (validation.errors.length > 0) {
      return res.status(400).json({
        error: "Blueprint is not logically consistent — fix it before generating.",
        code: "BLUEPRINT_INVALID",
        validation,
      });
    }

    // Locks: an explicit body list wins; otherwise every family flagged
    // locked on the paper is pinned (Phase 5 editor "lock" action).
    const current = await getPaperById(req.params.id);
    if (!current) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    if (current.paper.status === "archived") {
      return res.status(409).json({
        error: "Archived papers are read-only. Restore it to draft first.",
        code: "ARCHIVED_ACTION_BLOCKED",
        status: "archived",
      });
    }
    const lockFamilyIds = Array.isArray(req.body?.lockFamilyIds)
      ? req.body.lockFamilyIds.filter((x) => typeof x === "string")
      : current.families.filter((f) => f.locked).map((f) => f.family_id);
    const seed = typeof req.body?.seed === "string" && req.body.seed.trim()
      ? req.body.seed.trim()
      : `paper:${req.params.id}`;
    const strategy = req.body?.strategy === "seeded" || req.body?.strategy === "random" ? req.body.strategy : "seeded";
    const effectiveSeed = strategy === "random" ? `${seed}:${randomBytes(8).toString("hex")}` : seed;

    const result = await selectQuestionsForBlueprint(
      { ...blueprint, standardId: stored.paper.standard_id, subjectId: stored.paper.subject_id },
      (filters) => listQuestions({ status: "published", ...filters }),
      lockFamilyIds,
      effectiveSeed
    );

    if (!result.satisfied) {
      // Shortage: save nothing, report precisely which constraints failed.
      return res.status(409).json({
        error: "Blueprint cannot be satisfied with the available questions.",
        code: "BLUEPRINT_SHORTAGE",
        shortages: result.shortages,
      });
    }

    // Hybrid: locked families must remain in the paper. Keep them (with their
    // marks, section assignment and locked flag) ahead of the fresh picks.
    const existingRefs = new Map(
      current.families.map((f) => [
        f.family_id,
        {
          marks: Number(f.marks) || 0,
          sectionKey: f.section_key ?? null,
          locked: Boolean(f.locked),
        },
      ])
    );
    const lockedEntries = lockFamilyIds
      .filter((fid) => existingRefs.has(fid))
      .map((fid) => ({
        familyId: fid,
        marks: existingRefs.get(fid)?.marks ?? 0,
        sectionKey: existingRefs.get(fid)?.sectionKey ?? undefined,
        locked: true,
      }));
    // Fresh picks are assigned to their blueprint section (Phase 4).
    const freshEntries = result.selections
      .filter((s) => s.familyId)
      .map((s) => ({
        familyId: s.familyId,
        marks: s.marks,
        sectionKey: s.sectionId || undefined,
      }));
    const entries = [...lockedEntries, ...freshEntries];
    const updated = await updatePaper(req.params.id, {}, entries);
    if (!updated) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });

    res.json({
      generated: {
        seed: effectiveSeed,
        strategy,
        total: entries.length,
        totalMarks: entries.reduce((sum, e) => sum + e.marks, 0),
      },
      families: updated.families,
      paper: updated.paper,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Paper sets & randomization (Paper Generator Phase 7)
// ---------------------------------------------------------------
// One master paper generates multiple sets (A–D or custom count). Sets only
// reorder questions/options of the SAME logical questions — no Question Bank
// duplication. Each set stores its own seed + version so randomization is
// reproducible; a per-set answer key is derived from the stored option
// permutation.

// List the stored sets document for a paper.
app.get("/api/admin/papers/:id/sets", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const stored = await getPaperSets(req.params.id);
    if (!stored) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    res.json({
      paperId: stored.paper.id,
      sets: stored.sets,
      migrationRequired: stored.migrationRequired === true,
    });
  } catch (err) { next(err); }
});

// (Re-)generate sets. Body: { count?, labels?, shuffleQuestions?,
// shuffleOptions?, baseSeed?, version? }. Version defaults to stored+1 so a
// plain "regenerate" click deliberately re-randomizes, while regenerating
// with an explicit version reproduces the original randomization.
app.post("/api/admin/papers/:id/sets", requireAuth, requirePermission(PERMISSIONS.PAPERS_GENERATE), async (req, res, next) => {
  try {
    const loaded = await getPaperById(req.params.id);
    if (!loaded) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    if (loaded.paper.status === "archived") {
      return res.status(409).json({
        error: "Archived papers are read-only. Restore it to draft first.",
        code: "ARCHIVED_ACTION_BLOCKED",
        status: "archived",
      });
    }
    const stored = await getPaperSets(req.params.id);
    const currentVersion = Number(stored?.sets?.version) || 0;
    const options = {
      count: req.body?.count,
      labels: req.body?.labels,
      shuffleQuestions: req.body?.shuffleQuestions,
      shuffleOptions: req.body?.shuffleOptions,
      baseSeed: req.body?.baseSeed,
      version:
        Number.isInteger(req.body?.version) && req.body.version >= 1
          ? req.body.version
          : currentVersion + 1,
    };
    const { doc, errors } = generateSetsDoc(loaded.paper, loaded.families, options);
    if (!doc) {
      return res.status(400).json({ error: errors[0], code: "SETS_INVALID", errors });
    }
    try {
      await updatePaperSets(req.params.id, doc);
    } catch (err) {
      if (/Sets storage is not available/i.test(String(err?.message))) {
        return res.status(503).json({
          error: err.message,
          code: "SETS_STORAGE_UNAVAILABLE",
          migrationRequired: true,
        });
      }
      throw err;
    }
    res.json({ paperId: req.params.id, sets: doc, warnings: errors, migrationRequired: stored?.migrationRequired === true });
  } catch (err) { next(err); }
});

// Clear all sets from the master paper.
app.delete("/api/admin/papers/:id/sets", requireAuth, requirePermission(PERMISSIONS.PAPERS_GENERATE), async (req, res, next) => {
  try {
    const existing = await getPaperById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    if (existing.paper.status === "archived") {
      return res.status(409).json({
        error: "Archived papers are read-only. Restore it to draft first.",
        code: "ARCHIVED_ACTION_BLOCKED",
        status: "archived",
      });
    }
    try {
      await updatePaperSets(req.params.id, null);
    } catch (err) {
      if (/Sets storage is not available/i.test(String(err?.message))) {
        return res.status(503).json({
          error: err.message,
          code: "SETS_STORAGE_UNAVAILABLE",
          migrationRequired: true,
        });
      }
      throw err;
    }
    res.json({ deleted: true, paperId: req.params.id });
  } catch (err) { next(err); }
});

// Independent answer key for one set (computed from the stored permutation,
// never re-rolling the RNG — keys always match the stored set). Optional
// `?language=<id>` resolves answers from that language's variants.
app.get("/api/admin/papers/:id/sets/:key/answer-key", requireAuth, requirePermission(PERMISSIONS.PAPERS_REPORTS_VIEW), async (req, res, next) => {
  try {
    const stored = await getPaperSets(req.params.id);
    if (!stored) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    if (!stored.sets) {
      return res.status(400).json({
        error: "No sets generated for this paper yet.",
        code: "SETS_MISSING",
        migrationRequired: stored.migrationRequired === true,
      });
    }
    const language = typeof req.query.language === "string" ? req.query.language : null;
    // Performance: batched variant loader — one 3-query batch for the whole set
    // instead of two queries per question (N+1 on large papers/sets).
    const key = language
      ? await computeSetAnswerKeyInLanguage(stored.sets, req.params.key, language, listQuestionVariantsByFamilies)
      : await computeSetAnswerKey(stored.sets, req.params.key, listQuestionVariantsByFamilies);
    if (!key) {
      return res.status(404).json({
        error: `Set "${req.params.key}" does not exist on this paper.`,
        code: "SET_NOT_FOUND",
        availableKeys: stored.sets.sets.map((s) => s.key),
      });
    }
    res.json({ paperId: stored.paper.id, ...key });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Answer key & solutions reports (Paper Generator Phase 13)
// ---------------------------------------------------------------
// Both endpoints are derived from the paper's ACTUAL final structure on every
// request, so numbering/answer mappings always match the paper — for the
// master paper or any generated set, optionally resolved to a language. Data
// comes from the Question Bank only; missing answers/solutions are reported,
// never invented.
//
//   GET /api/admin/papers/:id/answer-key?set=A&language=<language_id>
//   GET /api/admin/papers/:id/solutions?set=A&language=<language_id>

async function buildPaperReportFor(req, res, includeContent) {
  const loaded = await getPaperById(req.params.id);
  if (!loaded) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
  const blueprint = await getPaperBlueprint(req.params.id).catch(() => null);
  const stored = await getPaperSets(req.params.id).catch(() => null);

  const setKey = typeof req.query.set === "string" && req.query.set.trim() ? req.query.set.trim() : null;
  if (setKey && (!stored || !stored.sets || (stored.sets.sets ?? []).length === 0)) {
    return res.status(400).json({
      error: "No sets generated for this paper yet — generate sets first or omit ?set for the master paper report.",
      code: "SETS_MISSING",
      migrationRequired: stored?.migrationRequired === true,
      scope: "master",
    });
  }
  if (setKey && !(stored.sets.sets ?? []).some((s) => s.key === setKey)) {
    return res.status(404).json({
      error: `Set "${setKey}" does not exist on this paper.`,
      code: "SET_NOT_FOUND",
      availableKeys: (stored.sets.sets ?? []).map((s) => s.key),
    });
  }

  const languageId = typeof req.query.language === "string" && req.query.language.trim()
    ? req.query.language.trim()
    : null;

  const report = buildPaperReport({
    paper: loaded.paper,
    familyRefs: loaded.families,
    blueprint: blueprint?.blueprint ?? null,
    setsDoc: stored?.sets ?? null,
    setKey,
    languageId,
    includeContent,
  });
  res.json({ paperId: loaded.paper.id, ...report });
}

// Compact answer key (question number -> answer) for master paper or a set.
app.get("/api/admin/papers/:id/answer-key", requireAuth, requirePermission(PERMISSIONS.PAPERS_REPORTS_VIEW), async (req, res, next) => {
  try { await buildPaperReportFor(req, res, false); } catch (err) { next(err); }
});

// Detailed solutions (question text, options, answer + explanation).
app.get("/api/admin/papers/:id/solutions", requireAuth, requirePermission(PERMISSIONS.PAPERS_REPORTS_VIEW), async (req, res, next) => {
  try { await buildPaperReportFor(req, res, true); } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Paper analysis & quality report (Paper Generator Phase 14)
// ---------------------------------------------------------------
// Composition + blueprint variance computed from the paper's own data on every
// request. Read-only; question content is never modified.
app.get("/api/admin/papers/:id/analysis", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const loaded = await getPaperById(req.params.id);
    if (!loaded) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    const [bp, chapters, topics, levels, languages] = await Promise.all([
      getPaperBlueprint(req.params.id).catch(() => null),
      listChapters().catch(() => []),
      listTopics().catch(() => []),
      listQuestionLevels().catch(() => []),
      listLanguages().catch(() => []),
    ]);
    const analysis = buildPaperAnalysis(loaded.paper, loaded.families, bp?.blueprint ?? null, { chapters, topics, levels, languages });
    res.json({ paperId: loaded.paper.id, ...analysis, migrationRequired: bp?.migrationRequired === true });
  } catch (err) { next(err); }
});

// Question family variants — list all language versions of a question's family
app.get("/api/admin/questions/:id/variants", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const question = await getQuestionById(req.params.id);
    if (!question) return res.status(404).json({ error: "Question not found.", code: "NOT_FOUND" });
    if (!question.family_id) {
      return res.json({ family_id: null, variants: [question] });
    }
    const variants = await listQuestionVariants(question.family_id);
    res.json({ family_id: question.family_id, variants });
  } catch (err) { next(err); }
});

// Question family variants — link an existing question into a variant family
app.post("/api/admin/questions/:id/link-variant", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const result = await linkQuestionToFamily(req.params.id, req.body?.family_id);
    if (!result) return res.status(404).json({ error: "Question not found.", code: "NOT_FOUND" });
    res.json({ question: result.question, family_id: result.family_id });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Paper versioning & history (Paper Generator Phase 15)
// ---------------------------------------------------------------
// Immutable, insert-only versions of a paper's state. Historical published
// versions are never mutated: restoring re-materialises a snapshot as a NEW
// version. Automatic captures: v1 on creation, on every publish; admins can
// also save a version manually or restore any past version.

/**
 * Best-effort capture of the paper's CURRENT live state as the next version.
 * Never throws (capture must not break the create/publish that triggered it).
 * Returns null when versioning storage is unavailable (migration 012 pending);
 * { skipped: true, nextVersion } when nothing changed since the last version.
 */
async function capturePaperVersion(paperId, { reason = "manual", note = null, createdBy = null, template = null, parentVersion = null } = {}) {
  try {
    const [loaded, bp, sets] = await Promise.all([
      getPaperById(paperId),
      getPaperBlueprint(paperId).catch(() => null),
      getPaperSets(paperId).catch(() => null),
    ]);
    if (!loaded) return null;
    const languagePapers = await listLanguagePapers(paperId).catch(() => []);
    const snapshot = buildPaperSnapshot(
      loaded.paper,
      loaded.families,
      bp?.blueprint ?? null,
      sets?.sets ?? null,
      sets?.translations ?? null,
      languagePapers,
      template ?? null,
    );

    const latest = await getLatestPaperVersion(paperId).catch(() => null);
    const nextVersion = latest ? latest.version + 1 : 1;

    let changes;
    let summary;
    if (latest?.snapshot) {
      changes = diffPaperSnapshots(latest.snapshot, snapshot);
      summary = changes.summary;
    } else {
      const allLanguages = [...new Set(snapshot.families.flatMap((f) => f.languages ?? []))];
      changes = {
        changed: true,
        additions: snapshot.families.map((f) => f.family_id),
        removals: [],
        replacements: [],
        reorderCount: 0,
        reordered: false,
        marksChanged: [],
        sectionsChanged: [],
        blueprintChanged: snapshot.blueprint != null,
        setsChanged: snapshot.sets != null,
        translationsChanged: snapshot.translations != null,
        languagePapersChanged: {
          added: (snapshot.languagePapers ?? []).map((l) => ({ language_id: l.language_id, version: l.version, status: l.status })),
          removed: [],
        },
        templateChanged: snapshot.template ? { from: null, to: snapshot.template } : null,
        fieldChanges: [],
        questionCount: { from: 0, to: snapshot.totals.questionCount },
        totalMarks: { from: 0, to: snapshot.totals.totalMarks },
        languagesChanged: { added: allLanguages, removed: [], affectedFamilies: snapshot.families.length },
      };
      summary = reason === "baseline" ? "Baseline captured for an existing paper" : "Initial version";
      changes.summary = summary;
    }

    if (!changes.changed && !["created", "baseline", "restore"].includes(reason)) {
      return { skipped: true, nextVersion };
    }

    const row = await insertPaperVersion({
      paper_id: paperId,
      version: nextVersion,
      reason,
      note: note ?? null,
      summary,
      changes,
      snapshot,
      created_by: createdBy,
      parent_version: parentVersion,
    });
    if (!row) return null;
    return {
      version: row.version,
      reason,
      summary,
      changes,
      created_at: row.created_at,
      skipped: false,
    };
  } catch (err) {
    console.error("capturePaperVersion failed:", err);
    return null;
  }
}

/** Lazily seed a baseline version (v1) for papers created before versioning. */
async function ensurePaperVersionBaseline(paperId, createdBy) {
  const latest = await getLatestPaperVersion(paperId).catch(() => null);
  if (latest) return { existing: true, version: latest.version };
  const result = await capturePaperVersion(paperId, {
    reason: "baseline",
    note: "Baseline captured when the paper already existed (pre-versioning).",
    createdBy,
  });
  if (!result) return { unavailable: true };
  return { existing: false, version: result.version };
}

/** Version timeline for a paper (metadata + change summary per version). */
app.get("/api/admin/papers/:id/versions", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const loaded = await getPaperById(req.params.id);
    if (!loaded) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    const paperId = req.params.id;

    let list = await listPaperVersions(paperId);
    if (list.migrationRequired) {
      return res.json({ paper: loaded.paper, versions: [], currentVersion: 0, createdVersion: 0, dirty: false, migrationRequired: true });
    }
    if (list.versions.length === 0) {
      const seeded = await ensurePaperVersionBaseline(paperId, req.user.sub);
      if (seeded.unavailable) {
        return res.json({ paper: loaded.paper, versions: [], currentVersion: 0, createdVersion: 0, dirty: false, migrationRequired: true });
      }
      list = await listPaperVersions(paperId);
    }

    let dirty = false;
    const latest = await getLatestPaperVersion(paperId).catch(() => null);
    if (latest?.snapshot) {
      const [bp, sets, languagePapers] = await Promise.all([
        getPaperBlueprint(paperId).catch(() => null),
        getPaperSets(paperId).catch(() => null),
        listLanguagePapers(paperId).catch(() => []),
      ]);
      const current = buildPaperSnapshot(
        loaded.paper, loaded.families,
        bp?.blueprint ?? null, sets?.sets ?? null, sets?.translations ?? null,
        languagePapers, null,
      );
      dirty = diffPaperSnapshots(latest.snapshot, current).changed;
    }

    res.json({
      paper: { id: loaded.paper.id, title: loaded.paper.title, status: loaded.paper.status, updated_at: loaded.paper.updated_at },
      versions: list.versions,
      currentVersion: list.currentVersion,
      createdVersion: list.createdVersion,
      dirty,
      migrationRequired: false,
    });
  } catch (err) { next(err); }
});

/** One full version row (immutable snapshot included) for View/Restore. */
app.get("/api/admin/papers/:id/versions/:version", requireAuth, requirePermission(PERMISSIONS.PAPERS_VIEW), async (req, res, next) => {
  try {
    const version = parseInt(req.params.version, 10);
    if (!Number.isInteger(version) || version < 1) {
      return res.status(400).json({ error: "version must be a positive integer.", code: "VALIDATION" });
    }
    try {
      const ver = await getPaperVersion(req.params.id, version);
      if (!ver) return res.status(404).json({ error: "Paper version not found.", code: "NOT_FOUND" });
      res.json(ver);
    } catch (err) {
      if (/Paper versioning is not available/i.test(String(err?.message))) {
        return res.status(503).json({ error: err.message, code: "VERSIONING_UNAVAILABLE", migrationRequired: true });
      }
      throw err;
    }
  } catch (err) { next(err); }
});

/** Save the current draft state as a new version. Body: { reason?, note?, template? }. */
app.post("/api/admin/papers/:id/versions", requireAuth, requirePermission(PERMISSIONS.PAPERS_MANAGE), async (req, res, next) => {
  try {
    const existing = await getPaperById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    const reason = req.body?.reason === "published" ? "published" : "manual";
    const template = req.body?.template && (req.body.template.id || req.body.template.name)
      ? { id: req.body.template.id ?? null, name: req.body.template.name ?? null }
      : null;
    const result = await capturePaperVersion(req.params.id, {
      reason,
      note: isSafeOptional(req.body?.note, 1000) ? req.body.note : undefined,
      createdBy: req.user.sub,
      template,
    });
    if (!result) {
      return res.status(503).json({
        error: "Paper versioning is not available: apply backend/migrations/012_paper_versioning.sql in the Supabase SQL editor.",
        code: "VERSIONING_UNAVAILABLE",
        migrationRequired: true,
      });
    }
    if (result.skipped) {
      return res.json({ created: false, message: "No changes since the last version.", paperId: req.params.id, currentVersion: result.nextVersion - 1 });
    }
    res.status(201).json({ created: true, paperId: req.params.id, version: result.version, reason, summary: result.summary, changes: result.changes, createdAt: result.created_at });
  } catch (err) { next(err); }
});

/**
 * Restore a historical version onto the live paper as a NEW version. The
 * snapshot's composition/blueprint/sets/translations are re-materialised, the
 * paper returns to draft for review, and the restored state is captured as
 * version N+1 (parent_version = the version it restored). History is preserved.
 */
app.post("/api/admin/papers/:id/versions/:version/restore", requireAuth, requirePermission(PERMISSIONS.PAPERS_MANAGE), async (req, res, next) => {
  try {
    const version = parseInt(req.params.version, 10);
    if (!Number.isInteger(version) || version < 1) {
      return res.status(400).json({ error: "version must be a positive integer.", code: "VALIDATION" });
    }
    let ver;
    try {
      ver = await getPaperVersion(req.params.id, version);
    } catch (err) {
      if (/Paper versioning is not available/i.test(String(err?.message))) {
        return res.status(503).json({ error: err.message, code: "VERSIONING_UNAVAILABLE", migrationRequired: true });
      }
      throw err;
    }
    if (!ver?.snapshot) return res.status(404).json({ error: "Paper version not found.", code: "NOT_FOUND" });

    const restored = await restorePaperFromSnapshot(req.params.id, ver.snapshot);
    const result = await capturePaperVersion(req.params.id, {
      reason: "restore",
      note: isSafeOptional(req.body?.note, 1000) ? req.body.note : `Restored from version ${version}`,
      createdBy: req.user.sub,
      parentVersion: version,
    });
    if (!result) {
      // Restore applied but capture unavailable — surface it so the admin knows.
      return res.json({
        restored: true,
        note: "Paper restored, but versioning storage is unavailable (migration 012 pending).",
        migrationRequired: true,
        skipped: restored.skipped,
      });
    }
    res.status(201).json({
      restored: true,
      restoredFrom: version,
      version: result.version,
      summary: result.summary,
      changes: result.changes,
      skipped: restored.skipped,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

app.use((err, _req, res, _next) => {
  console.error("API error:", err);
  res.status(500).json({ error: "Internal server error", code: "INTERNAL" });
});

app.listen(config.port, () => {
  console.log(`Admin API listening on http://localhost:${config.port}`);
});
