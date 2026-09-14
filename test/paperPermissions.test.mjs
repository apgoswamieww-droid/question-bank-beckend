// Paper Generator Permission Integration (Phase 17) — pure mapping tests.
// The permission system itself is DB-backed and exercised via requirePermission;
// here we verify the legacy-access mapping helpers stay consistent with
// migration 014 and seed.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  PAPER_VIEW_PERMISSIONS,
  PAPER_MANAGE_PERMISSIONS,
  paperPermissionsForLegacy,
} from "../supabase.js";

test("Paper Generator permission codes are registered in PERMISSIONS", () => {
  const expected = [
    "papers.view",
    "papers.manage",
    "papers.delete",
    "papers.publish",
    "papers.generate",
    "papers.export",
    "papers.templates.manage",
    "papers.translations.manage",
    "papers.reports.view",
  ];
  for (const code of expected) {
    assert.ok(
      Object.values(PERMISSIONS).includes(code),
      `PERMISSIONS should include ${code}`
    );
    assert.ok(ALL_PERMISSIONS.includes(code), `ALL_PERMISSIONS should include ${code}`);
  }
});

test("every Paper Generator code maps to the Paper Generator module", async () => {
  const { PERMISSION_MODULE_MAP } = await import("../supabase.js");
  for (const code of [...PAPER_VIEW_PERMISSIONS, ...PAPER_MANAGE_PERMISSIONS]) {
    assert.equal(PERMISSION_MODULE_MAP[code], "Paper Generator");
  }
});

test("view-level and manage-level sets do not overlap", () => {
  const view = new Set(PAPER_VIEW_PERMISSIONS);
  for (const code of PAPER_MANAGE_PERMISSIONS) {
    assert.ok(!view.has(code), `overlap on ${code}`);
  }
});

test("legacy question_banks.view maps to the view-level paper permissions", () => {
  const mapped = paperPermissionsForLegacy(["question_banks.view"]);
  assert.deepEqual([...mapped].sort(), [...PAPER_VIEW_PERMISSIONS].sort());
});

test("legacy question_banks.manage maps to view + manage paper permissions", () => {
  const mapped = paperPermissionsForLegacy(["question_banks.manage"]);
  const expected = [...PAPER_VIEW_PERMISSIONS, ...PAPER_MANAGE_PERMISSIONS].sort();
  assert.deepEqual([...mapped].sort(), expected);
});

test("roles without question bank access get no paper permissions", () => {
  assert.deepEqual(paperPermissionsForLegacy([]), []);
  assert.deepEqual(paperPermissionsForLegacy(["users.view"]), []);
});

test("manage implies view: a manage-only legacy role still gets the view set", () => {
  const mapped = paperPermissionsForLegacy(["question_banks.manage"]);
  for (const code of PAPER_VIEW_PERMISSIONS) {
    assert.ok(mapped.includes(code), `manage-only role should still receive ${code}`);
  }
});

test("migration 014 seeds exactly the codes the helpers emit", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(new URL("../migrations/014_paper_generator_permissions.sql", import.meta.url), "utf-8");
  for (const code of [...PAPER_VIEW_PERMISSIONS, ...PAPER_MANAGE_PERMISSIONS]) {
    assert.ok(sql.includes(`('${code}'`), `migration 014 should seed ${code}`);
  }
  // The manage-level grant list must include every manage + view code.
  const manageBlock = sql.split("-- manage-level:")[1] ?? "";
  for (const code of [...PAPER_VIEW_PERMISSIONS, ...PAPER_MANAGE_PERMISSIONS]) {
    assert.ok(manageBlock.includes(`'${code}'`), `manage-level grant should include ${code}`);
  }
  // The view-level grant list must include every view code.
  const viewBlock = sql.split("-- manage-level:")[0].split("-- view-level:")[1] ?? "";
  for (const code of PAPER_VIEW_PERMISSIONS) {
    assert.ok(viewBlock.includes(`'${code}'`), `view-level grant should include ${code}`);
  }
});
