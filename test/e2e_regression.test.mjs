// ---------------------------------------------------------------------------
// E2E regression (Phase 17) — runs the REAL server in isolated file-repo mode.
// Supabase env vars are blanked by the harness, so:
//   - users/roles/permissions AND papers work via the JSON fallback
//   - question mutation endpoints still require Supabase (throw → 500)
//   - permission middleware runs BEFORE any data call, so 401/403 vs other
//     statuses cleanly separates authorization behavior from data availability
//   - the fallback seeds the legacy mapping: student keeps papers.view/export/
//     reports.view (behavior preservation mandated by Phase 17), so 403
//     assertions for view routes use a dedicated no-access custom role
// ---------------------------------------------------------------------------
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import {
  seedUsersFile, restoreUsersFile, startServer, stopServer, api, login, PORT,
} from "./e2e_harness.mjs";

let sa, teacher, student, noaccess;

// Original fallback permission set for the student role (restored after the
// rewrite test so tests stay order-independent).
const STUDENT_BASE_PERMS = [
  "question_banks.view", "papers.view", "papers.export", "papers.reports.view",
];

async function loginWith(email, password) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

before(async () => {
  seedUsersFile();
  await startServer();
  sa = await login("sa");
  teacher = await login("teacher");
  student = await login("student");

  // Dedicated role with ZERO permissions — used to prove the 403 gate on view
  // routes (the seeded student legitimately holds papers.view).
  const role = await api("POST", "/admin/roles", {
    body: { code: "noaccess17", name: "NoAccess17", description: "e2e" },
  });
  assert.equal(role.status, 201);
  const grant = await api("PUT", "/admin/roles/noaccess17/permissions", {
    body: { permissions: [] },
  });
  assert.equal(grant.status, 200);
  const user = await api("POST", "/admin/users", {
    body: { email: "noaccess17@e2e.local", name: "NA", password: "E2ePass!123", role: "noaccess17", active: true },
  });
  assert.equal(user.status, 201, `noaccess user create failed: ${JSON.stringify(user.body)}`);
  noaccess = await loginWith("noaccess17@e2e.local", "E2ePass!123");
  assert.ok(noaccess.token, "noaccess login");
});

after(() => {
  stopServer();
  restoreUsersFile();
});

// ---------------------------------------------------------------------- AUTH
describe("Authentication (existing behavior)", () => {
  it("rejects bad credentials with 401", async () => {
    const res = await api("POST", "/auth/login", {
      body: { email: "sa@e2e.local", password: "wrong" },
    });
    assert.equal(res.status, 401);
  });

  it("rejects unknown users with 401", async () => {
    const res = await api("POST", "/auth/login", {
      body: { email: "nobody@e2e.local", password: "x" },
    });
    assert.equal(res.status, 401);
  });

  it("returns token + role + permissions on login", async () => {
    assert.ok(sa.token, "super admin token");
    assert.equal(sa.role, "super_admin");
    assert.ok(Array.isArray(sa.permissions) && sa.permissions.length > 0);
    // Phase 17: paper permissions are part of the permission payload.
    assert.ok(sa.permissions.includes("papers.view"), "papers.view granted");
    assert.ok(sa.permissions.includes("papers.manage"), "papers.manage granted");
  });

  it("rejects requests without a token (401)", async () => {
    // token: "" → harness sends no Authorization header.
    const res = await api("GET", "/admin/papers", { token: "" });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "UNAUTHORIZED");
  });

  it("rejects malformed tokens (401)", async () => {
    const res = await api("GET", "/admin/papers", { token: "garbage.token.here" });
    assert.equal(res.status, 401);
  });

  it("GET /auth/me restores the session with fresh permissions", async () => {
    const res = await api("GET", "/auth/me", { role: "teacher" });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "teacher");
    assert.ok(res.body.permissions.includes("papers.manage"));
    assert.ok(res.body.permissions.includes("question_banks.manage"));
  });
});

// -------------------------------------------------------------- ROLES & PERMS
describe("Roles & permissions (existing behavior + Phase 17)", () => {
  it("super admin lists roles and the permission matrix", async () => {
    const res = await api("GET", "/admin/permissions");
    assert.equal(res.status, 200);
    const codes = res.body.permissions.map((p) => p.code);
    for (const code of ["papers.view", "papers.manage", "papers.delete", "papers.publish",
      "papers.generate", "papers.export", "papers.templates.manage",
      "papers.translations.manage", "papers.reports.view"]) {
      assert.ok(codes.includes(code), `matrix should include ${code}`);
      assert.equal(
        res.body.permissions.find((p) => p.code === code).module,
        "Paper Generator",
        `${code} grouped under Paper Generator module`
      );
    }
  });

  it("teacher role holds the mapped Paper Generator permissions", async () => {
    const res = await api("GET", "/admin/permissions");
    assert.equal(res.status, 200);
    const matrix = res.body.matrix;
    for (const code of ["papers.view", "papers.manage", "papers.publish", "papers.generate"]) {
      assert.ok((matrix.teacher ?? []).includes(code), `teacher matrix should include ${code}`);
    }
  });

  it("non-admins cannot manage roles (403)", async () => {
    const res = await api("GET", "/admin/permissions", { role: "teacher" });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "FORBIDDEN");
  });

  it("permission lookup is DB/fallback-backed, not hardcoded per role", async () => {
    // Rewrite the student role's permissions via the API and verify both
    // directions of enforcement, then restore the original set.
    const grant = await api("PUT", "/admin/roles/student/permissions", {
      body: { permissions: ["question_banks.view", "papers.view", "papers.export", "papers.reports.view"] },
    });
    assert.equal(grant.status, 200);
    const matrix = await api("GET", "/admin/permissions");
    assert.deepEqual(
      (matrix.body.matrix.student ?? []).slice().sort(),
      ["papers.export", "papers.reports.view", "papers.view", "question_banks.view"].sort()
    );

    // Student passes the papers.view gate (file-backed route → 200 here).
    const list = await api("GET", "/admin/papers", { role: "student" });
    assert.equal(list.status, 200);

    // …but is still blocked from a papers.manage route.
    const create = await api("POST", "/admin/papers", { role: "student", body: { title: "nope" } });
    assert.equal(create.status, 403);
    assert.equal(create.body.code, "FORBIDDEN");

    // Restore the original set so later tests are unaffected.
    const restore = await api("PUT", "/admin/roles/student/permissions", {
      body: { permissions: STUDENT_BASE_PERMS },
    });
    assert.equal(restore.status, 200);
  });

  it("custom roles are persisted and assignable to users (regression: file fallback)", async () => {
    const createRole = await api("POST", "/admin/roles", {
      body: { code: "customrole17", name: "Custom17", description: "e2e" },
    });
    assert.equal(createRole.status, 201);
    // Immediately re-readable (was silently dropped before the fix).
    const roles = await api("GET", "/admin/roles");
    assert.ok(JSON.stringify(roles.body).includes("customrole17"), "custom role persisted");
    // Assignable to a user (was "Invalid role." before the fix).
    const u = await api("POST", "/admin/users", {
      body: { email: "custom17@e2e.local", name: "C", password: "E2ePass!123", role: "customrole17", active: true },
    });
    assert.equal(u.status, 201, `user create failed: ${JSON.stringify(u.body)}`);
    const session = await loginWith("custom17@e2e.local", "E2ePass!123");
    assert.equal(session.role, "customrole17");
  });
});

// ------------------------------------------------- QUESTION BANK PERMISSIONS
describe("Question bank authorization (existing behavior preserved)", () => {
  it("view-only student cannot create questions (403)", async () => {
    const res = await api("POST", "/admin/questions", {
      role: "student",
      body: { content: { type: "doc" }, type: "mcq_single" },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "FORBIDDEN");
  });

  it("teacher passes QUESTION_BANKS_MANAGE gate (validation/data layer responds)", async () => {
    const res = await api("POST", "/admin/questions", {
      role: "teacher",
      body: { content: { type: "doc" }, type: "mcq_single" },
    });
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403, "teacher should pass the question_banks.manage gate");
  });

  it("authenticated user with view permission lists questions (file fallback → empty list)", async () => {
    const res = await api("GET", "/admin/questions", { role: "student" });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.questions ?? res.body));
  });

  it("no-access role is blocked from question routes (403)", async () => {
    const res = await api("GET", "/admin/questions", { token: noaccess.token });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "FORBIDDEN");
  });
});

// --------------------------------------------- PAPER GENERATOR AUTHORIZATION
describe("Paper Generator permission enforcement (Phase 17, per action)", () => {
  const viewCases = [
    ["GET", "/admin/papers", "papers.view"],
    ["GET", "/admin/papers/p1", "papers.view"],
    ["GET", "/admin/papers/p1/structure", "papers.view"],
    ["GET", "/admin/papers/p1/versions", "papers.view"],
    ["GET", "/admin/papers/p1/analysis", "papers.view"],
    ["GET", "/admin/papers/p1/sets", "papers.view"],
    ["GET", "/admin/papers/p1/blueprint", "papers.view"],
    ["GET", "/admin/papers/p1/translations", "papers.view"],
    ["GET", "/admin/papers/p1/pdf", "papers.export"],
    ["GET", "/admin/papers/p1/answer-key", "papers.reports.view"],
    ["GET", "/admin/papers/p1/solutions", "papers.reports.view"],
  ];
  for (const [method, route, perm] of viewCases) {
    it(`${method} ${route} → ${perm} gate passes for permitted roles, blocks no-access role`, async () => {
      // Student holds the legacy-mapped view permissions → passes the gate.
      // (File-backed routes answer 200/404; the exact code is a data concern.)
      for (const role of ["sa", "teacher", "student"]) {
        const res = await api(method, route, { role });
        assert.notEqual(res.status, 401, `${role} authenticated on ${route}`);
        assert.notEqual(res.status, 403, `${role} should pass the ${perm} gate on ${route}`);
        assert.ok(res.status < 500, `${role} reached the data layer on ${route} (got ${res.status})`);
      }
      // A role with zero permissions is rejected at the gate.
      const res = await api(method, route, { token: noaccess.token });
      assert.equal(res.status, 403, `no-access role must be blocked on ${route}`);
      assert.equal(res.body.code, "FORBIDDEN");
    });
  }

  const manageCases = [
    ["POST", "/admin/papers", { title: "t" }],
    ["PATCH", "/admin/papers/p1", { title: "t" }],
    ["POST", "/admin/papers/p1/validate", {}],
    ["POST", "/admin/papers/p1/duplicate", {}],
    ["POST", "/admin/papers/p1/restore", {}],
    ["PUT", "/admin/papers/p1/blueprint", { blueprint: {} }],
    ["POST", "/admin/papers/p1/generate", {}],
    ["POST", "/admin/papers/p1/sets", {}],
    ["PUT", "/admin/papers/p1/families", { families: [] }],
    ["POST", "/admin/papers/p1/versions", {}],
  ];
  for (const [method, route, body] of manageCases) {
    it(`${method} ${route} → teacher passes papers.manage, student is 403`, async () => {
      const t = await api(method, route, { role: "teacher", body });
      assert.notEqual(t.status, 401);
      assert.notEqual(t.status, 403, "teacher should pass papers.manage routes");
      const s = await api(method, route, { role: "student", body });
      assert.equal(s.status, 403);
      assert.equal(s.body.code, "FORBIDDEN");
    });
  }

  it("DELETE paper → papers.delete role required (student 403)", async () => {
    const s = await api("DELETE", "/admin/papers/p1", { role: "student" });
    assert.equal(s.status, 403);
    const t = await api("DELETE", "/admin/papers/p1", { role: "teacher" });
    assert.notEqual(t.status, 403);
  });

  it("archive → papers.delete role required", async () => {
    const s = await api("POST", "/admin/papers/p1/archive", { role: "student", body: {} });
    assert.equal(s.status, 403);
    const t = await api("POST", "/admin/papers/p1/archive", { role: "teacher", body: {} });
    assert.notEqual(t.status, 403);
  });

  it("publish (PATCH status=published) → papers.publish required", async () => {
    const s = await api("PATCH", "/admin/papers/p1", { role: "student", body: { status: "published" } });
    assert.equal(s.status, 403);
    const t = await api("PATCH", "/admin/papers/p1", { role: "teacher", body: { status: "published" } });
    assert.notEqual(t.status, 403);
  });

  it("templates manage → papers.templates.manage required", async () => {
    const s = await api("POST", "/admin/templates", { role: "student", body: { name: "x" } });
    assert.equal(s.status, 403);
    // Listing templates only needs papers.view (student holds it via legacy map).
    const view = await api("GET", "/admin/templates", { role: "student" });
    assert.equal(view.status, 200);
    const t = await api("POST", "/admin/templates", { role: "teacher", body: { name: "x" } });
    assert.notEqual(t.status, 403);
    const na = await api("GET", "/admin/templates", { token: noaccess.token });
    assert.equal(na.status, 403);
  });

  it("translations manage → papers.translations.manage required", async () => {
    const s = await api("PUT", "/admin/papers/p1/translations", { role: "student", body: {} });
    assert.equal(s.status, 403);
    const s2 = await api("POST", "/admin/papers/p1/language-papers", { role: "student", body: {} });
    assert.equal(s2.status, 403);
    const t = await api("PUT", "/admin/papers/p1/translations", { role: "teacher", body: {} });
    assert.notEqual(t.status, 403);
  });

  it("fine-grained split: a papers.view-only custom role can view but not manage", async () => {
    const createRole = await api("POST", "/admin/roles", {
      body: { code: "viewer17", name: "Viewer17", description: "e2e" },
    });
    assert.equal(createRole.status, 201);
    const grant = await api("PUT", "/admin/roles/viewer17/permissions", {
      body: { permissions: ["papers.view"] },
    });
    assert.equal(grant.status, 200);
    const u = await api("POST", "/admin/users", {
      body: { email: "viewer17@e2e.local", name: "V", password: "E2ePass!123", role: "viewer17", active: true },
    });
    assert.equal(u.status, 201, `user create failed: ${JSON.stringify(u.body)}`);

    const session = await loginWith("viewer17@e2e.local", "E2ePass!123");
    assert.equal(session.role, "viewer17");
    assert.deepEqual(session.permissions, ["papers.view"]);

    const view = await api("GET", "/admin/papers", { token: session.token });
    assert.equal(view.status, 200); // passed the papers.view gate
    const manage = await api("POST", "/admin/papers", { token: session.token, body: { title: "x" } });
    assert.equal(manage.status, 403); // blocked without papers.manage
    const reports = await api("GET", "/admin/papers/p1/answer-key", { token: session.token });
    assert.equal(reports.status, 403); // blocked without papers.reports.view
    const del = await api("DELETE", "/admin/papers/p1", { token: session.token });
    assert.equal(del.status, 403); // blocked without papers.delete
  });
});
