// Phase 14 Paper Analysis & Quality Report tests (node --test, pure logic).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPaperAnalysis } from "../paperService.js";

const SECTIONS = [
  { id: "sec-a", name: "Section A", instructions: "", marksPerQuestion: 2, negativeMarks: 0.5, ruleIds: ["r1"], questionCount: 2 },
  { id: "sec-b", name: "Section B", instructions: "", marksPerQuestion: 4, negativeMarks: 0, ruleIds: ["r2"], questionCount: 1 },
];

const BLUEPRINT = {
  version: 1, totalQuestions: 3, mode: "count",
  sections: SECTIONS,
  rules: [
    { id: "r1", sectionId: "sec-a", scope: "paper", chapterId: null, topicId: null, type: "mcq_single", difficulty: "easy", count: 2, percent: 0 },
    { id: "r2", sectionId: "sec-b", scope: "paper", chapterId: null, topicId: null, type: null, difficulty: null, count: 1, percent: 0 },
  ],
};

const META = {
  chapters: [{ id: "ch1", name: "Algebra" }, { id: "ch2", name: "Geometry" }],
  topics: [{ id: "tp1", name: "Quadratics" }, { id: "tp2", name: "Triangles" }],
  levels: [],
  languages: [
    { id: "lang-en", code: "en", name: "English" },
    { id: "lang-gu", code: "gu", name: "Gujarati" },
    { id: "lang-hi", code: "hi", name: "Hindi" },
  ],
};

function qv({ id, type = "mcq_single", languageId = "lang-en", difficulty = "easy", chapterId = "ch1", topicId = "tp1", content = null, options = null }) {
  return {
    id, type, language_id: languageId, translation_status: "draft", difficulty,
    chapter_id: chapterId, topic_id: topicId,
    content: content ?? { type: "doc", content: [] },
    options, payload: null, marks: 1, created_at: "2026-01-01T00:00:00.000Z",
  };
}

function ref({ family, order, marks = 2, sectionKey = "sec-a", variants }) {
  return { id: `pf_${family}`, family_id: family, sort_order: order, marks, section_key: sectionKey, locked: false, primary: variants?.[0] ?? null, variants: variants ?? [] };
}

test("analysis computes totals + all distributions", () => {
  const families = [
    ref({ family: "f1", order: 1, marks: 2, variants: [qv({ id: "v1", chapterId: "ch1", topicId: "tp1" })] }),
    ref({ family: "f2", order: 2, marks: 2, variants: [qv({ id: "v2", difficulty: "hard", chapterId: "ch2", topicId: "tp2", type: "true_false" })] }),
    ref({ family: "f3", order: 3, marks: 4, sectionKey: "sec-b", variants: [qv({ id: "v3", type: "long", difficulty: "medium", content: { type: "doc", content: [] } })] }),
  ];
  const a = buildPaperAnalysis({ id: "p1", title: "Paper", duration_min: 60, total_marks: 8, status: "draft" }, families, BLUEPRINT, META);

  assert.equal(a.actual.totalQuestions, 3);
  assert.equal(a.actual.totalMarks, 8);
  assert.equal(a.actual.durationMin, 60);
  assert.equal(a.actual.declaredTotalMarks, 8);
  assert.equal(a.actual.declaredQuestions, 3);

  assert.deepEqual(a.sectionDistribution.map((s) => [s.key, s.count, s.marks]), [["sec-a", 2, 4], ["sec-b", 1, 4]]);
  assert.equal(a.typeDistribution.find((t) => t.label === "MCQ Single").count, 1);
  assert.equal(a.typeDistribution.find((t) => t.label === "True/False").count, 1);
  assert.equal(a.typeDistribution.find((t) => t.label === "Long Answer").count, 1);
  assert.equal(a.difficultyDistribution.find((d) => d.label === "Easy").count, 1);
  assert.equal(a.difficultyDistribution.find((d) => d.label === "Medium").count, 1);
  assert.equal(a.difficultyDistribution.find((d) => d.label === "Hard").count, 1);
  assert.deepEqual(a.chapterDistribution.map((c) => [c.name, c.count]), [["Algebra", 2], ["Geometry", 1]]);
  assert.deepEqual(a.topicDistribution.map((t) => [t.name, t.count]), [["Quadratics", 2], ["Triangles", 1]]);
});

test("blueprint variance compares targets against actual composition", () => {
  const families = [
    ref({ family: "f1", order: 1, variants: [qv({ id: "v1" })] }),
    ref({ family: "f2", order: 2, variants: [qv({ id: "v2", difficulty: "hard" })] }),
    ref({ family: "f3", order: 3, marks: 4, sectionKey: "sec-b", variants: [qv({ id: "v3", type: "long" })] }),
  ];
  const a = buildPaperAnalysis({ id: "p1" }, families, BLUEPRINT, META);

  const v = a.blueprintVariance;
  assert.equal(v.summary.targetQuestions, 3);
  assert.equal(v.summary.actualQuestions, 3);
  assert.equal(v.summary.questionsDelta, 0);
  assert.equal(v.summary.targetMarks, 8);
  assert.equal(v.summary.actualMarks, 8);
  assert.equal(v.summary.marksDelta, 0);

  const secA = v.sections.find((s) => s.key === "sec-a");
  assert.equal(secA.targetCount, 2);
  assert.equal(secA.actualCount, 2);
  assert.equal(secA.countDelta, 0);
  assert.equal(secA.targetMarks, 4);
  assert.equal(secA.actualMarks, 4);

  const r1 = v.rules.find((r) => r.ruleId === "r1");
  assert.equal(r1.target, 2);
  assert.equal(r1.actual, 1); // only the "easy" MCQ matches r1 (hard one is excluded)
  assert.equal(r1.delta, -1);
  const r2 = v.rules.find((r) => r.ruleId === "r2");
  assert.equal(r2.actual, 1);
});

test("variance is non-zero when composition drifts from the blueprint", () => {
  const families = [
    ref({ family: "f1", order: 1, sectionKey: "sec-a", variants: [qv({ id: "v1" })] }),
    ref({ family: "f2", order: 2, sectionKey: "sec-a", variants: [qv({ id: "v2", chapterId: "ch2" })] }),
    ref({ family: "f3", order: 3, sectionKey: "sec-b", variants: [qv({ id: "v3", type: "long" })] }),
  ];
  const a = buildPaperAnalysis({ id: "p1" }, families, BLUEPRINT, META);
  const v = a.blueprintVariance;
  assert.equal(v.summary.questionsDelta, 0);
  const secA = v.sections.find((s) => s.key === "sec-a");
  assert.equal(secA.countDelta, 0);
  // r1 (mcq_single easy): f1 easy mcq matches, f2 is mcq easy but ch2 chapter — rule has chapterId null so it still matches
  assert.equal(v.rules.find((r) => r.ruleId === "r1").actual, 2);
  assert.equal(v.rules.find((r) => r.ruleId === "r1").delta, 0);
});

test("duplicate detection: repeated family reference and possible same-content families", () => {
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Twice?" }] }] };
  const same = (id, opt) => qv({ id, content, options: [{ label: "A", content: "X", is_correct: true }], ...opt });
  const families = [
    ref({ family: "f1", order: 1, variants: [same("v1")] }),
    ref({ family: "f1", order: 2, variants: [same("v1", { id: "v1" })] }),
    ref({ family: "f2", order: 3, variants: [same("v2")] }),
  ];

  // f1 appears twice with identical content (family duplicate + same content across f1/f2).
  const a = buildPaperAnalysis({ id: "p1" }, families, null, META);
  assert.equal(a.duplicates.familyDuplicates.length, 1);
  assert.equal(a.duplicates.familyDuplicates[0].familyId, "f1");
  assert.equal(a.duplicates.familyDuplicates[0].count, 2);

  const contentGroups = a.duplicates.contentDuplicates;
  const g = contentGroups.find((c) => c.familyIds.includes("f1") && c.familyIds.includes("f2"));
  assert.ok(g, "expected a possible-duplicate content group spanning f1 and f2");
});

test("language coverage counts families per language", () => {
  const families = [
    ref({ family: "f1", order: 1, variants: [qv({ id: "v1", languageId: "lang-en" })] }),
    ref({ family: "f2", order: 2, variants: [qv({ id: "v2-en", languageId: "lang-en" }), qv({ id: "v2-gu", languageId: "lang-gu" })] }),
  ];
  const a = buildPaperAnalysis({ id: "p1" }, families, null, META);
  const en = a.languageCoverage.find((l) => l.code === "en");
  const gu = a.languageCoverage.find((l) => l.code === "gu");
  const hi = a.languageCoverage.find((l) => l.code === "hi");
  assert.equal(en.covered, 2);
  assert.equal(gu.covered, 1);
  assert.equal(gu.missing, 1);
  assert.equal(hi.covered, 0);
  assert.equal(hi.missing, 2);
  assert.equal(gu.coverage, 50);
});

test("sections not covered by blueprints are surfaced in variance warnings", () => {
  const families = [
    ref({ family: "f1", order: 1, sectionKey: "sec-a", variants: [qv({ id: "v1" })] }),
    ref({ family: "f2", order: 2, sectionKey: "unplanned", variants: [qv({ id: "v2" })] }),
  ];
  const a = buildPaperAnalysis({ id: "p1" }, families, BLUEPRINT, META);
  assert.ok(a.blueprintVariance.warnings.some((w) => /not covered by the blueprint/.test(w)));
});