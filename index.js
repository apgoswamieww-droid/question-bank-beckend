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
  linkQuestionToFamily,
  listPapers,
  getPaperById,
  createPaper,
  updatePaper,
  deletePaper,
  getPaperLanguages,
  getPaperInLanguage,
} from "./supabase.js";

const VALID_ROLES = new Set(["super_admin", "teacher", "student"]);
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
      if (!VALID_ROLES.has(role)) {
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
      if (!VALID_ROLES.has(role)) {
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
      if (String(err?.message || "").includes("duplicate")) {
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
    filters.limit = parseInt(limit, 10) || 50;
    filters.offset = parseInt(offset, 10) || 0;
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
app.get("/api/admin/papers", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const { status, limit, offset } = req.query ?? {};
    const isSuperAdmin = req.user?.role === "super_admin";
    const result = await listPapers({
      status: typeof status === "string" ? status : undefined,
      created_by: isSuperAdmin ? undefined : req.user.sub,
      limit: parseInt(limit, 10) || 100,
      offset: parseInt(offset, 10) || 0,
    });
    res.json(result);
  } catch (err) { next(err); }
});

app.post("/api/admin/papers", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_MANAGE), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    if (!isSafeIdentifier(b.title)) return res.status(400).json({ error: "Title is required.", code: "VALIDATION" });
    const familyIds = Array.isArray(b.familyIds) ? b.familyIds.filter((x) => typeof x === "string") : [];
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
    res.status(201).json(created);
  } catch (err) { next(err); }
});

app.get("/api/admin/papers/:id", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const result = await getPaperById(req.params.id);
    if (!result) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    res.json(result);
  } catch (err) { next(err); }
});

app.patch("/api/admin/papers/:id", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_MANAGE), async (req, res, next) => {
  try {
    const existing = await getPaperById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    const b = req.body ?? {};
    if (b.title !== undefined && !isSafeIdentifier(b.title)) return res.status(400).json({ error: "Title is required.", code: "VALIDATION" });
    const patch = {};
    for (const key of ["title", "description", "standard_id", "subject_id", "exam_type_id", "duration_min", "total_marks", "status"]) {
      if (b[key] !== undefined) patch[key] = b[key];
    }
    const familyIds = Array.isArray(b.familyIds) ? b.familyIds.filter((x) => typeof x === "string") : undefined;
    const updated = await updatePaper(req.params.id, patch, familyIds);
    res.json(updated);
  } catch (err) { next(err); }
});

app.delete("/api/admin/papers/:id", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_MANAGE), async (req, res, next) => {
  try {
    const removed = await deletePaper(req.params.id);
    if (!removed) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// Key endpoint: paper resolved to a requested language. Any authenticated
// teacher can print a paper; the resolved content excludes answer keys.
app.get("/api/admin/papers/:id/print", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
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

app.get("/api/admin/papers/:id/languages", requireAuth, requirePermission(PERMISSIONS.QUESTION_BANKS_VIEW), async (req, res, next) => {
  try {
    const result = await getPaperLanguages(req.params.id);
    if (!result) return res.status(404).json({ error: "Paper not found.", code: "NOT_FOUND" });
    res.json(result);
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
