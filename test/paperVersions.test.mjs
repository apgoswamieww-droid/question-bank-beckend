// Phase 15 Paper Versioning & History tests (node --test, pure logic only —
// snapshot building + change diffs; storage/restore is layered in supabase.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPaperSnapshot, diffPaperSnapshots } from "../paperService.js";

function qv({ id, languageId = "lang-en", content = "Q", options = null }) {
  return {
    id, type: "mcq_single", language_id: languageId, translation_status: "draft",
    difficulty: "easy", chapter_id: null, topic_id: null,
    content: { type: "doc", content: [{ type: "para", content: [{ type: "text", text: content }] }] },
    options, payload: null, marks: 1, created_at: "2026-01-01T00:00:00.000Z",
  };
}

function ref({ family, order, marks = 2, sectionKey = null, locked = false, variants }) {
  return {
    id: `pf_${family}`, family_id: family, sort_order: order, marks,
    section_key: sectionKey, locked, primary: variants?.[0] ?? null, variants: variants ?? [],
  };
}

const PAPER = { id: "p1", title: "Maths Paper", description: null, standard_id: null, subject_id: null, exam_type_id: null, duration_min: 60, total_marks: 8, status: "draft" };

const BLUEPRINT = { version: 1, sections: [{ id: "sec-a", name: "Section A" }], rules: [] };

function snapshotFor(entries) {
  // Build directly from family refs like the storage layer does.
  return buildPaperSnapshot(PAPER, entries, null, null, null, [], null);
}

test("buildPaperSnapshot pins composition, digests and totals", () => {
  const families = [
    ref({ family: "f1", order: 0, marks: 2, sectionKey: "sec-a", locked: true, variants: [qv({ id: "v1" }), qv({ id: "v1gu", languageId: "lang-gu" })] }),
    ref({ family: "f2", order: 1, marks: 4, variants: [qv({ id: "v2", content: "Different", options: [{ label: "A", content: "x", is_correct: true }] })] }),
  ];
  const s = buildPaperSnapshot(PAPER, families, BLUEPRINT, { setA: true }, { languages: {} }, [], { id: "tpl-1", name: "Default" });
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.paper.title, "Maths Paper");
  assert.deepEqual(s.template, { id: "tpl-1", name: "Default" });
  assert.equal(s.blueprint.sections[0].id, "sec-a");
  assert.ok(s.sets.setA);
  assert.ok(s.translations.languages);
  assert.equal(s.totals.questionCount, 2);
  assert.equal(s.totals.totalMarks, 6);
  assert.equal(s.families.length, 2);
  assert.equal(s.families[0].family_id, "f1");
  assert.deepEqual(s.families[0].languages, ["lang-en", "lang-gu"]);
  assert.equal(s.families[0].locked, true);
  assert.equal(s.families[0].section_key, "sec-a");
  assert.ok(typeof s.families[1].question_digest === "string" && s.families[1].question_digest.length >= 10);
});

test("diff detects additions and removals", () => {
  const prev = snapshotFor([ref({ family: "f1", order: 0, variants: [qv({ id: "v1" })] }), ref({ family: "f2", order: 1, variants: [qv({ id: "v2" })] })]);
  const next = snapshotFor([ref({ family: "f1", order: 0, variants: [qv({ id: "v1" })] }), ref({ family: "f3", order: 1, variants: [qv({ id: "v3" })] }), ref({ family: "f4", order: 2, variants: [qv({ id: "v4" })] })]);
  const d = diffPaperSnapshots(prev, next);
  assert.deepEqual(d.removals, ["f2"]);
  assert.deepEqual(d.additions, ["f3", "f4"]);
  assert.equal(d.changed, true);
  assert.match(d.summary, /Added 2 questions/);
  assert.match(d.summary, /Removed 1 question/);
});

test("diff detects a same-slot replacement separately from add/remove", () => {
  const prev = snapshotFor([ref({ family: "f1", order: 0, variants: [qv({ id: "v1" })] }), ref({ family: "f2", order: 1, variants: [qv({ id: "v2" })] })]);
  const next = snapshotFor([ref({ family: "f1", order: 0, variants: [qv({ id: "v1" })] }), ref({ family: "f9", order: 1, variants: [qv({ id: "v9" })] })]);
  const d = diffPaperSnapshots(prev, next);
  assert.deepEqual(d.replacements, [{ from: "f2", to: "f9" }]);
  assert.deepEqual(d.additions, []);
  assert.deepEqual(d.removals, []);
  assert.match(d.summary, /Replaced 1 question/);
});

test("diff detects reordering using the common subsequence", () => {
  const prev = snapshotFor([
    ref({ family: "f1", order: 0, variants: [qv({ id: "v1" })] }),
    ref({ family: "f2", order: 1, variants: [qv({ id: "v2" })] }),
    ref({ family: "f3", order: 2, variants: [qv({ id: "v3" })] }),
  ]);
  const next = snapshotFor([
    ref({ family: "f3", order: 0, variants: [qv({ id: "v3" })] }),
    ref({ family: "f1", order: 1, variants: [qv({ id: "v1" })] }),
    ref({ family: "f2", order: 2, variants: [qv({ id: "v2" })] }),
  ]);
  const d = diffPaperSnapshots(prev, next);
  assert.equal(d.changed, true);
  assert.equal(d.reordered, true);
  assert.equal(d.reorderCount, 3);
  assert.deepEqual(d.additions, []);
  assert.deepEqual(d.removals, []);
});

test("diff detects marks, section, blueprint and field changes", () => {
  const prev = buildPaperSnapshot(PAPER, [
    ref({ family: "f1", order: 0, marks: 2, sectionKey: null, variants: [qv({ id: "v1" })] }),
  ], null, null, null, [], null);
  const next = buildPaperSnapshot({ ...PAPER, total_marks: 6 }, [
    ref({ family: "f1", order: 0, marks: 4, sectionKey: "sec-b", variants: [qv({ id: "v1" })] }),
  ], BLUEPRINT, null, null, [], null);
  const d = diffPaperSnapshots(prev, next);
  assert.deepEqual(d.marksChanged, ["f1"]);
  assert.deepEqual(d.sectionsChanged, ["f1"]);
  assert.equal(d.blueprintChanged, true);
  assert.deepEqual(d.fieldChanges, ["declared marks"]);
  assert.equal(d.totalMarks.to, 4);
});

test("diff detects template and language changes", () => {
  const prev = buildPaperSnapshot(PAPER, [
    ref({ family: "f1", order: 0, variants: [qv({ id: "v1" }), qv({ id: "v1gu", languageId: "lang-gu" })] }),
  ], null, null, null, [], { id: "tpl-a", name: "Layout A" });
  const next = buildPaperSnapshot(PAPER, [
    ref({ family: "f1", order: 0, variants: [qv({ id: "v1" })] }),
  ], null, null, null, [], { id: "tpl-b", name: "Layout B" });
  const d = diffPaperSnapshots(prev, next);
  assert.deepEqual(d.templateChanged, { from: { id: "tpl-a", name: "Layout A" }, to: { id: "tpl-b", name: "Layout B" } });
  assert.deepEqual(d.languagesChanged.removed, ["lang-gu"]);
  assert.equal(d.languagesChanged.affectedFamilies, 1);
  assert.match(d.summary, /Template changed/);
  assert.match(d.summary, /Languages removed/);
});

test("diff detects sets/translations and generated language paper changes", () => {
  const base = (over = {}) => buildPaperSnapshot(PAPER, [
    ref({ family: "f1", order: 0, variants: [qv({ id: "v1" })] }),
  ], null, over.sets ?? null, over.translations ?? null, over.languagePapers ?? [], over.template ?? null);
  const prev = base({ sets: null, translations: null, languagePapers: [] });
  const next = base({
    sets: { setA: { kind: "perm", order: ["f1"] } },
    translations: { languages: { "lang-gu": { state: "approved" } } },
    languagePapers: [{ language_id: "lang-gu", version: 1, set_key: "setA", status: "generated" }],
  });
  const d = diffPaperSnapshots(prev, next);
  assert.equal(d.setsChanged, true);
  assert.equal(d.translationsChanged, true);
  assert.equal(d.languagePapersChanged.added.length, 1);
  assert.match(d.summary, /Sets updated/);
  assert.match(d.summary, /Generated language paper/);
});

test("diff reports no change with a neutral summary", () => {
  const prev = snapshotFor([ref({ family: "f1", order: 0, variants: [qv({ id: "v1" })] })]);
  const next = snapshotFor([ref({ family: "f1", order: 0, variants: [qv({ id: "v1" })] })]);
  const d = diffPaperSnapshots(prev, next);
  assert.equal(d.changed, false);
  assert.equal(d.summary, "No changes");
  assert.equal(d.reordered, false);
  assert.equal(d.blueprintChanged, false);
});