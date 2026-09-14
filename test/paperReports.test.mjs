// Phase 13 Answer Key & Solution Engine tests (node --test, pure logic only —
// no Supabase client involved). Run from the backend dir: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePaperQuestionAnswer,
  listPaperReportQuestions,
  buildPaperReport,
} from "../paperService.js";

// --- fixtures ---------------------------------------------------------------

function variant({ id, type = "mcq_single", languageId = "en", status = "approved", content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Question" }] }] }, explanation = null, options = [], payload = null }) {
  return { id, type, language_id: languageId, translation_status: status, content, explanation, options, payload, marks: 1, created_at: "2026-01-01T00:00:00.000Z" };
}

function ref({ family, sortOrder, marks = 1, sectionKey = "__default__", variants }) {
  return { id: `pf_${family}`, family_id: family, sort_order: sortOrder, marks, section_key: sectionKey, locked: false, primary: variants?.[0] ?? null, variants: variants ?? [] };
}

const blueprint = {
  version: 1,
  totalQuestions: 3,
  mode: "count",
  sections: [
    { id: "sec-a", name: "Section A", instructions: "", marksPerQuestion: 1, negativeMarks: 0.25, ruleIds: [], questionCount: 2 },
    { id: "sec-b", name: "Section B", instructions: "", marksPerQuestion: 2, negativeMarks: 0, ruleIds: [], questionCount: 1 },
  ],
  rules: [],
};

function mcq(family, correctIndexes, id, extra = {}) {
  const options = ["Opt 0", "Opt 1", "Opt 2"].map((label, j) => ({ content: { type: "text", text: label }, is_correct: correctIndexes.includes(j), label: String.fromCharCode(65 + j) }));
  return variant({ id, options, ...extra });
}

// --- tests ------------------------------------------------------------------

test("master paper report: order, numbering, sections, compact answers", () => {
  const f1 = ref({ family: "f1", sortOrder: 1, sectionKey: "sec-a", variants: [mcq("f1", [0], "v1")], marks: 1 });
  const f2 = ref({ family: "f2", sortOrder: 2, sectionKey: "sec-a", variants: [mcq("f2", [2], "v2")], marks: 1 });
  const f3 = ref({ family: "f3", sortOrder: 3, sectionKey: "sec-b", variants: [variant({ id: "v3", type: "number", explanation: null, payload: { answer: "42" } })], marks: 2 });

  const report = buildPaperReport({ paper: { id: "p1" }, familyRefs: [f1, f2, f3], blueprint, setsDoc: null, setKey: null });

  assert.equal(report.scope, "master");
  assert.equal(report.summary.appliedOrder, "master");
  assert.equal(report.summary.questionCount, 3);
  assert.equal(report.summary.totalMarks, 4);
  assert.equal(report.summary.answered, 3);
  assert.equal(report.summary.complete, true);
  assert.deepEqual(report.summary.warnings, []);

  assert.deepEqual(report.sections.map((s) => s.key), ["sec-a", "sec-b"]);
  assert.equal(report.sections[0].name, "Section A");
  assert.equal(report.sections[0].negativeMarks, 0.25);
  assert.deepEqual(report.sections[0].entries.map((e) => e.number), [1, 2]);
  assert.deepEqual(report.sections[1].entries.map((e) => e.number), [3]);

  const [q1, q2, q3] = report.sections.flatMap((s) => s.entries);
  assert.equal(q1.answer, "A");
  assert.equal(q2.answer, "C");
  assert.equal(q3.answer, "42");
  assert.equal(q3.type, "number");
});

test("set report: stored order + option permutation applied", () => {
  const f1 = ref({ family: "f1", sortOrder: 1, variants: [mcq("f1", [0], "v1")], marks: 1 });
  const f2 = ref({ family: "f2", sortOrder: 2, variants: [mcq("f2", [1], "v2")], marks: 1 });
  const f3 = ref({ family: "f3", sortOrder: 3, variants: [mcq("f3", [2], "v3")], marks: 1 });

  const setsDoc = {
    schemaVersion: 1, baseSeed: "b", version: 1, shuffleQuestions: true, shuffleOptions: true,
    generatedAt: "2026-01-01T00:00:00.000Z", count: 1,
    sets: [{
      key: "A", name: "Set A", seed: "s", version: 1, generatedAt: "", questionCount: 3, totalMarks: 3,
      questions: [
        { familyId: "f3", number: 1, marks: 1, sectionKey: null, optionPermutation: [2, 1, 0] },
        { familyId: "f1", number: 2, marks: 1, sectionKey: null, optionPermutation: [1, 0, 2] },
        { familyId: "f2", number: 3, marks: 1, sectionKey: null, optionPermutation: [0, 2, 1] },
      ],
    }],
  };

  const report = buildPaperReport({ paper: { id: "p1" }, familyRefs: [f1, f2, f3], blueprint: null, setsDoc, setKey: "A" });

  assert.equal(report.scope, "set");
  assert.deepEqual(report.sections.flatMap((s) => s.entries).map((e) => e.familyId), ["f3", "f1", "f2"]);
  const entries = report.sections.flatMap((s) => s.entries);
  assert.deepEqual(entries.map((e) => e.number), [1, 2, 3]);

  // f3: original correct index 2 -> permutation [2,1,0] puts it at display 0 => A
  assert.equal(entries[0].answer, "A");
  // f1: original correct index 0 -> permutation [1,0,2] puts it at display 1 => B
  assert.equal(entries[1].answer, "B");
  // f2: original correct index 1 -> permutation [0,2,1] puts it at display 2 => C
  assert.equal(entries[2].answer, "C");
  assert.equal(entries.every((e) => e.permutationApplied), true);
  assert.equal(entries.every((e) => e.permutationDrift), false);
  assert.equal(report.summary.complete, true);
});

test("stale set falls back to master order with a warning", () => {
  const f1 = ref({ family: "f1", sortOrder: 1, variants: [mcq("f1", [0], "v1")] });
  const f2 = ref({ family: "f2", sortOrder: 2, variants: [mcq("f2", [1], "v2")] });
  // Stored set references a family that has since been deleted from the paper.
  const setsDoc = {
    schemaVersion: 1, baseSeed: "b", version: 1, shuffleQuestions: true, shuffleOptions: true,
    generatedAt: "2026-01-01T00:00:00.000Z", count: 1,
    sets: [{ key: "A", name: "Set A", seed: "s", version: 1, generatedAt: "", questionCount: 3, totalMarks: 2,
      questions: [
        { familyId: "f2", number: 1, marks: 1, sectionKey: null, optionPermutation: null },
        { familyId: "f1", number: 2, marks: 1, sectionKey: null, optionPermutation: null },
        { familyId: "fX", number: 3, marks: 1, sectionKey: null, optionPermutation: null },
      ] }],
  };

  const report = buildPaperReport({ paper: { id: "p1" }, familyRefs: [f1, f2], blueprint: null, setsDoc, setKey: "A" });

  assert.equal(report.scope, "master");
  assert.deepEqual(report.sections.flatMap((s) => s.entries).map((e) => e.familyId), ["f1", "f2"]);
  assert.ok(report.summary.warnings.some((w) => /no longer matches/.test(w)));
  assert.equal(report.summary.appliedOrder, "master");
});

test("missing answer, missing solution and missing variant are reported, never invented", () => {
  const bad = ref({ family: "f1", sortOrder: 1, variants: [variant({ id: "v1", options: [], payload: {} })], marks: 1 });
  const none = ref({ family: "f2", sortOrder: 2, variants: [], marks: 1 });
  const solved = ref({ family: "f3", sortOrder: 3, variants: [mcq("f3", [1], "v3", { explanation: { type: "text", text: "Because." } })], marks: 1 });

  const compact = buildPaperReport({ paper: { id: "p1" }, familyRefs: [bad, none, solved], blueprint: null, setsDoc: null, includeContent: false });
  assert.equal(compact.summary.missingAnswer, 2);
  assert.equal(compact.summary.answered, 1);
  assert.equal(compact.summary.complete, false);

  const solutions = buildPaperReport({ paper: { id: "p1" }, familyRefs: [bad, none, solved], blueprint: null, setsDoc: null, includeContent: true });
  const entries = solutions.sections.flatMap((s) => s.entries);
  assert.equal(entries[0].answerMissing, true);
  assert.equal(entries[1].questionMissing, true);
  assert.equal(entries[1].answerMissing, true);
  assert.equal(entries[2].explanationPresent, true);
  assert.equal(solutions.summary.missingExplanation, 2);
  assert.ok(solutions.summary.warnings.some((w) => /no correct answer/.test(w)));
  assert.ok(solutions.summary.warnings.some((w) => /no solution is available/.test(w)));
});

test("requested-language report falls back and flags substitution", () => {
  const f1 = ref({ family: "f1", sortOrder: 1, variants: [mcq("f1", [0], "v-en")] });
  const f2 = ref({ family: "f2", sortOrder: 2, variants: [mcq("f2", [1], "v-gu", { languageId: "gu" }), mcq("f2", [1], "v-en2")] });
  const paper = { id: "p1" };

  const report = buildPaperReport({ paper, familyRefs: [f1, f2], blueprint: null, setsDoc: null, languageId: "gu" });
  const entries = report.sections.flatMap((s) => s.entries);

  assert.equal(entries[0].languageId, "en");
  assert.equal(entries[0].substituted, true);
  assert.equal(entries[1].languageId, "gu");
  assert.equal(entries[1].substituted, false);
  assert.equal(report.summary.substituted, 1);
  assert.equal(report.summary.complete, false);
});

test("option permutation that no longer fits the variant is dropped + flagged", () => {
  // Variant has 2 options; a stale set stores a 3-index permutation.
  const f1 = ref({ family: "f1", sortOrder: 1, variants: [variant({ id: "v1", options: [
    { content: "a", is_correct: true, label: "A" },
    { content: "b", is_correct: false, label: "B" },
  ] })] });
  const setsDoc = {
    schemaVersion: 1, baseSeed: "b", version: 1, shuffleQuestions: false, shuffleOptions: true,
    generatedAt: "2026-01-01T00:00:00.000Z", count: 1,
    sets: [{ key: "A", name: "Set A", seed: "s", version: 1, generatedAt: "", questionCount: 1, totalMarks: 1,
      questions: [{ familyId: "f1", number: 1, marks: 1, sectionKey: null, optionPermutation: [2, 1, 0] }] }],
  };

  const resolved = resolvePaperQuestionAnswer(f1.variants[0], [2, 1, 0]);
  assert.equal(resolved.permutationDrift, true);
  assert.equal(resolved.permutationApplied, false);
  assert.equal(resolved.answer, "A");

  const report = buildPaperReport({ paper: { id: "p1" }, familyRefs: [f1], blueprint: null, setsDoc, setKey: "A" });
  const e = report.sections.flatMap((s) => s.entries)[0];
  assert.equal(e.permutationDrift, true);
  assert.equal(e.answer, "A");
  assert.ok(report.summary.warnings.some((w) => /stored option order/.test(w)));
});

test("requested set that does not exist falls back to master with a warning", () => {
  const f1 = ref({ family: "f1", sortOrder: 1, variants: [mcq("f1", [0], "v1")] });
  const setsDoc = {
    schemaVersion: 1, baseSeed: "b", version: 1, shuffleQuestions: false, shuffleOptions: true,
    generatedAt: "2026-01-01T00:00:00.000Z", count: 1,
    sets: [{ key: "A", name: "Set A", seed: "s", version: 1, generatedAt: "", questionCount: 1, totalMarks: 1,
      questions: [{ familyId: "f1", number: 1, marks: 1, sectionKey: null, optionPermutation: null }] }],
  };

  const report = buildPaperReport({ paper: { id: "p1" }, familyRefs: [f1], blueprint: null, setsDoc, setKey: "Z" });
  assert.equal(report.scope, "master");
  assert.ok(report.summary.warnings.some((w) => /was not found/.test(w)));
});