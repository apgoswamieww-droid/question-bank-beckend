// ---------------------------------------------------------------------------
// Paper Generator targeted regression (engine + real PDF rendering).
// Pure logic + Puppeteer only — no Supabase. Run from backend: `npm test`.
// Covers: selection modes, sections/distribution, duplicates, missing
// translations/images, option randomization correctness, set-specific answer
// keys, Unicode Gujarati/Hindi, formulas, long content, page breaks.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import {
  validateBlueprint,
  selectQuestionsForBlueprint,
  validatePaper,
  generateSetsDoc,
  computeSetAnswerKey,
  resolveSetQuestionAnswer,
  checkInvariants,
  computePaperStructure,
  MAX_SETS,
} from "../paperService.js";
import { buildPaperHtml, htmlToPdfBuffer } from "../pdfRenderer.js";

// --- fixtures ---------------------------------------------------------------

function variant({ id, type = "mcq_single", languageId = "en", status = "approved", content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Question" }] }] }, explanation = null, options = [], payload = null }) {
  return { id, type, language_id: languageId, translation_status: status, content, explanation, options, payload, marks: 1, created_at: "2026-01-01T00:00:00.000Z" };
}

function ref({ family, sortOrder, marks = 1, sectionKey = null, variants }) {
  return { id: `pf_${family}`, family_id: family, sort_order: sortOrder, marks, section_key: sectionKey, locked: false, primary: variants?.[0] ?? null, variants: variants ?? [] };
}

function mcqOptions(correctIndex, n = 3) {
  // Plain-string option content — the stored shape validatePaper checks and
  // the shape produced by older question data ({ html } rich options are
  // covered by the dedicated rich-option test below).
  return Array.from({ length: n }, (_, j) => ({
    content: `Option ${j}`,
    is_correct: j === correctIndex,
    label: String.fromCharCode(65 + j),
  }));
}

const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const countBlueprint = {
  version: 1,
  totalQuestions: 3,
  mode: "count",
  sections: [
    { id: "sec-a", name: "Section A", instructions: "", marksPerQuestion: 1, negativeMarks: 0.25, ruleIds: [], questionCount: 2 },
    { id: "sec-b", name: "Section B", instructions: "", marksPerQuestion: 2, negativeMarks: 0, ruleIds: [], questionCount: 1 },
  ],
  rules: [
    { id: "r1", sectionId: "sec-a", type: "mcq_single", difficulty: "easy", count: 2 },
    { id: "r2", sectionId: "sec-b", type: "number", difficulty: "hard", count: 1 },
  ],
};

// Question bank mock honoring the same filter semantics as listQuestions.
function makeBank(rows) {
  return async (filters = {}) =>
    rows.filter((q) =>
      (!filters.type || q.type === filters.type) &&
      (!filters.difficulty || q.difficulty === filters.difficulty) &&
      (!filters.chapter_id || q.chapter_id === filters.chapter_id) &&
      (!filters.subject_id || q.subject_id === filters.subject_id)
    );
}

const bank = makeBank([
  { id: "q1", family_id: "fam1", type: "mcq_single", difficulty: "easy", chapter_id: "ch1", subject_id: "sub1" },
  { id: "q2", family_id: "fam2", type: "mcq_single", difficulty: "easy", chapter_id: "ch1", subject_id: "sub1" },
  { id: "q3", family_id: "fam3", type: "mcq_single", difficulty: "easy", chapter_id: "ch2", subject_id: "sub1" },
  { id: "q4", family_id: "fam4", type: "number", difficulty: "hard", chapter_id: "ch1", subject_id: "sub1" },
  { id: "q5", family_id: "fam5", type: "number", difficulty: "hard", chapter_id: "ch2", subject_id: "sub1" },
]);

// --- A. Blueprint validation & selection modes -------------------------------

test("blueprint validation: count mode ok, percent mode enforces 100% and totals", () => {
  const ok = validateBlueprint(countBlueprint);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.summary.totalQuestions, 3);

  const badPercent = validateBlueprint({
    version: 1, totalQuestions: 10, mode: "percent",
    sections: [{ id: "s1", name: "S1", marksPerQuestion: 1, negativeMarks: 0, ruleIds: [], questionCount: 0 }],
    rules: [{ id: "r1", sectionId: "s1", percent: 90 }],
  });
  assert.ok(badPercent.errors.some((e) => /100%/.test(e)), "percent must total exactly 100%");
});

test("automatic selection: fills sections from rules with no duplicate families", async () => {
  const { selections, shortages, satisfied } = await selectQuestionsForBlueprint(countBlueprint, bank);
  assert.equal(satisfied, true);
  assert.deepEqual(shortages, []);
  assert.equal(selections.length, 3);
  const fams = selections.map((s) => s.familyId);
  assert.equal(new Set(fams).size, 3, "no family picked twice");
  const secA = selections.filter((s) => s.sectionId === "sec-a");
  const secB = selections.filter((s) => s.sectionId === "sec-b");
  assert.equal(secA.length, 2);
  assert.equal(secB.length, 1);
  assert.ok(secA.every((s) => s.marks === 1) && secB.every((s) => s.marks === 2), "section marks applied");
});

test("difficulty/chapter distribution: rules only pick matching candidates", async () => {
  const bp = {
    version: 1, totalQuestions: 2, mode: "count",
    sections: [{ id: "s1", name: "S1", marksPerQuestion: 1, negativeMarks: 0, ruleIds: [], questionCount: 2 }],
    rules: [
      { id: "r1", sectionId: "s1", scope: "chapter", chapterId: "ch2", difficulty: "hard", count: 1 },
      { id: "r2", sectionId: "s1", scope: "chapter", chapterId: "ch1", type: "mcq_single", count: 1 },
    ],
  };
  const { selections, shortages } = await selectQuestionsForBlueprint(bp, bank);
  assert.deepEqual(shortages, []);
  const hard = selections.find((s) => s.ruleId === "r1");
  const mcq = selections.find((s) => s.ruleId === "r2");
  assert.ok(["fam5", "fam3"].includes(hard.familyId), "hard rule picks from ch2 hard pool");
  assert.ok(["fam1", "fam2"].includes(mcq.familyId), "mcq rule picks from ch1 mcq pool");
});

test("hybrid selection: locked questions consume demand first; never re-picked", async () => {
  const { selections, shortages } = await selectQuestionsForBlueprint(
    countBlueprint, bank, ["fam1"]
  );
  assert.ok(!selections.some((s) => s.familyId === "fam1"), "locked family not re-selected");
  assert.equal(selections.length, 2, "1 locked consumed demand, 2 filled fresh");
  assert.deepEqual(shortages, []);
  // locked family that does not exist in the bank is also fine
  const again = await selectQuestionsForBlueprint(countBlueprint, bank, ["famZ"]);
  assert.equal(again.selections.length, 2);
});

test("selection shortage is reported even though overflow fill keeps sections full", async () => {
  const bp = {
    version: 1, totalQuestions: 3, mode: "count",
    sections: [{ id: "s1", name: "S1", marksPerQuestion: 1, negativeMarks: 0, ruleIds: [], questionCount: 3 }],
    rules: [{ id: "r1", sectionId: "s1", difficulty: "extreme", count: 3 }],
  };
  const { selections, shortages, satisfied } = await selectQuestionsForBlueprint(bp, bank);
  // The rule matches nothing (no 'extreme' questions); the paper-level overflow
  // fill then tops the section up from the general pool (5 candidates).
  assert.equal(selections.length, 3, "overflow fill completes section demand");
  assert.ok(selections.every((s) => s.ruleId === null), "overflow-filled slots carry no rule");
  // The rule-level shortage is still surfaced so the admin can act on it.
  const ruleShortage = shortages.find((s) => s.ruleId === "r1");
  assert.ok(ruleShortage, "rule shortage reported");
  assert.equal(ruleShortage.missing, 3);
  assert.equal(satisfied, false);
});

test("rich-editor option content ({ html }) is not flagged as empty (regression)", () => {
  const refs = [
    ref({ family: "f1", sortOrder: 1, sectionKey: "sec-a", variants: [variant({ id: "v1", options: mcqOptions(0).map((o) => ({ ...o, content: { html: `<p>${o.content}</p>` } })) })] }),
  ];
  const report = validatePaper({ id: "p1" }, refs, countBlueprint);
  assert.ok(
    !report.results.some((r) => r.field === "options" && /no content/.test(r.problem)),
    "rich options must not be flagged empty"
  );
  // Truly empty rich options are still caught.
  const empty = validatePaper({ id: "p1" }, [
    ref({ family: "f1", sortOrder: 1, sectionKey: "sec-a", variants: [variant({ id: "v1", options: mcqOptions(0).map((o, j) => ({ ...o, content: { html: j === 1 ? "<p></p>" : o.content } })) })] }),
  ], countBlueprint);
  assert.ok(empty.results.some((r) => r.field === "options" && /no content/.test(r.problem)));
});

test("selection determinism: same seed produces the same picks", async () => {
  const a = await selectQuestionsForBlueprint(countBlueprint, bank, [], "seed-x");
  const b = await selectQuestionsForBlueprint(countBlueprint, bank, [], "seed-x");
  assert.deepEqual(a.selections, b.selections);
});

test("sets config boundaries: MAX_SETS and label-count mismatches are rejected", () => {
  const tooMany = generateSetsDoc({ id: "p1" }, [ref({ family: "f1", sortOrder: 1, variants: [variant({ id: "v1", options: mcqOptions(0) })] })], { count: MAX_SETS + 1 });
  assert.ok(tooMany.errors.some((e) => /between 1 and/.test(e)));
  const badLabels = generateSetsDoc({ id: "p1" }, [ref({ family: "f1", sortOrder: 1, variants: [variant({ id: "v1" })] })], { count: 2, labels: ["only-one"] });
  assert.ok(badLabels.errors.some((e) => /labels/i.test(e)));
});

// --- B. Structure, duplicates, translations, images --------------------------

test("paper structure: sections in blueprint order, numbering continues, marks effective", () => {
  const structure = computePaperStructure(
    { id: "p1" },
    [
      ref({ family: "f1", sortOrder: 2, sectionKey: "sec-b", marks: 0, variants: [variant({ id: "v1", payload: { answer: "7" }, type: "number" })] }),
      ref({ family: "f2", sortOrder: 1, sectionKey: "sec-a", variants: [variant({ id: "v2", options: mcqOptions(1) })] }),
    ],
    countBlueprint
  );
  assert.deepEqual(structure.sections.map((s) => s.key), ["sec-a", "sec-b"]);
  const flat = structure.sections.flatMap((s) => s.questions ?? s.families ?? []);
  assert.deepEqual(flat.map((q) => q.number), [1, 2], "global numbering across sections");
  const bQ = flat.find((q) => q.family_id === "f1");
  assert.equal(bQ.effectiveMarks, 2, "falls back to section marksPerQuestion");
});

test("duplicate family references are critical validation errors", () => {
  const report = validatePaper(
    { id: "p1" },
    [
      ref({ family: "f1", sortOrder: 1, sectionKey: "sec-a", variants: [variant({ id: "v1", options: mcqOptions(0) })] }),
      ref({ family: "f1", sortOrder: 2, sectionKey: "sec-a", variants: [variant({ id: "v1", options: mcqOptions(0) })] }),
    ],
    countBlueprint
  );
  const dup = report.results.find((r) => r.field === "family_id" && /duplicate|appears/i.test(r.problem));
  assert.ok(dup, "duplicate family flagged");
  assert.equal(dup.level, "ERROR");
  assert.equal(report.summary.canPublish, false);
});

test("missing primary variant (empty family) blocks publication", () => {
  const report = validatePaper(
    { id: "p1" },
    [ref({ family: "f1", sortOrder: 1, sectionKey: "sec-a", variants: [] })],
    countBlueprint
  );
  assert.ok(report.results.some((r) => r.field === "primary" && r.level === "ERROR"));
  assert.equal(report.summary.canPublish, false);
});

test("missing required-language translations block publication; full coverage is INFO", () => {
  // Blueprint demand is 2+1=3 questions; provide 3 valid refs so only the
  // language dimension varies between the two runs.
  const refs = [
    ref({ family: "f1", sortOrder: 1, sectionKey: "sec-a", variants: [variant({ id: "v1", options: mcqOptions(0) }), variant({ id: "v1-gu", languageId: "gu", options: mcqOptions(0) })] }),
    ref({ family: "f2", sortOrder: 2, sectionKey: "sec-a", variants: [variant({ id: "v2", options: mcqOptions(1) })] }),
    ref({ family: "f3", sortOrder: 3, sectionKey: "sec-b", variants: [variant({ id: "v3", type: "numeric", payload: { answer: "1" } })] }),
  ];
  const missing = validatePaper({ id: "p1" }, refs, countBlueprint, { requiredLanguages: [{ id: "gu", name: "Gujarati" }] });
  const langIssue = missing.results.find((r) => r.field === "language:Gujarati");
  assert.ok(langIssue && langIssue.level === "ERROR");
  assert.match(langIssue.problem, /2 of 3/);
  assert.equal(missing.summary.canPublish, false);

  const covered = validatePaper(
    { id: "p1" },
    refs,
    countBlueprint,
    { requiredLanguages: [{ id: "en", name: "English" }] }
  );
  assert.equal(covered.summary.canPublish, true, `expected publishable, got: ${JSON.stringify(covered.results.filter((r) => r.level === "ERROR"))}`);
  assert.ok(covered.results.some((r) => r.field === "language:English" && r.level === "INFO"));
});

test("invariant integrity: changed numbers and missing images are detected", () => {
  const base = variant({
    id: "b",
    content: { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "A car travels 120 km in 2 hours." },
      { type: "image", attrs: { src: "diagram1.png" } },
    ] }] },
  });
  const okTrans = variant({
    id: "t", languageId: "gu",
    content: { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "કાર 120 કિમી 2 કલાકમાં." },
      { type: "image", attrs: { src: "diagram1.png" } },
    ] }] },
  });
  assert.deepEqual(checkInvariants(base, okTrans), [], "matching numbers + media pass");

  const changedNumbers = variant({
    id: "t2", languageId: "gu",
    content: { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "કાર 150 કિમી 3 કલાકમાં." },
      { type: "image", attrs: { src: "diagram1.png" } },
    ] }] },
  });
  const numIssues = checkInvariants(base, changedNumbers);
  assert.ok(numIssues.some((i) => i.field === "content.numbers"), "number drift detected");

  const missingImage = variant({
    id: "t3", languageId: "gu",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "કાર 120 કિમી 2 કલાકમાં." }] }] },
  });
  const imgIssues = checkInvariants(base, missingImage);
  assert.ok(imgIssues.some((i) => i.field === "content.media"), "missing diagram detected");
});

// --- C. Sets, option randomization, set-specific answer keys ------------------

const setsRefs = [
  ref({ family: "f1", sortOrder: 1, sectionKey: "sec-a", variants: [variant({ id: "v1", options: mcqOptions(1) })] }),
  ref({ family: "f2", sortOrder: 2, sectionKey: "sec-a", variants: [variant({ id: "v2", options: mcqOptions(2) })] }),
  ref({ family: "f3", sortOrder: 3, sectionKey: "sec-a", variants: [variant({ id: "v3", options: mcqOptions(0) })] }),
  ref({ family: "f4", sortOrder: 4, sectionKey: "sec-b", marks: 2, variants: [variant({ id: "v4", type: "numeric", payload: { answer: "42" } })] }),
];

test("set generation: valid permutations, section boundaries preserved, totals consistent", () => {
  const { doc: setsDoc, errors } = generateSetsDoc({ id: "p1" }, setsRefs, { count: 4, baseSeed: "regression" });
  assert.deepEqual(errors, []);
  assert.equal(setsDoc.count, 4);

  for (const set of setsDoc.sets) {
    assert.equal(set.questions.length, 4);
    assert.equal(set.totalMarks, 5, "1+1+1+2 marks");
    // option permutations must be true permutations of [0..n-1]
    for (const q of set.questions) {
      if (q.optionPermutation) {
        assert.deepEqual([...q.optionPermutation].sort((a, b) => a - b), [0, 1, 2], `perm valid for ${q.familyId}`);
      }
    }
    // section grouping: sec-a questions never appear after sec-b ones
    const keys = set.questions.map((q) => q.sectionKey);
    const firstB = keys.indexOf("sec-b");
    assert.ok(!keys.slice(firstB + 1).includes("sec-a"), "no cross-section reordering");
  }
  // randomization actually varies across sets (not all identical)
  const sigs = new Set(setsDoc.sets.map((s) => JSON.stringify(s.questions.map((q) => [q.familyId, q.optionPermutation]))));
  assert.ok(sigs.size > 1, "different sets differ in order/permutation");
});

test("option randomization correctness: permutation maps display letters to the right content", () => {
  const opts = mcqOptions(2); // correct original index 2 ("Option 2")
  const v = variant({ id: "v1", options: opts });

  // master (no permutation): correct at C
  const master = resolveSetQuestionAnswer(v, null);
  assert.equal(master.answer, "C");
  assert.equal(master.displayOptions[2].content, "Option 2");

  // perm [2,1,0]: display A shows original index 2 → answer A, content follows
  const shuffled = resolveSetQuestionAnswer(v, [2, 1, 0]);
  assert.equal(shuffled.answer, "A");
  assert.equal(shuffled.displayOptions[0].content, "Option 2");
  assert.equal(shuffled.displayOptions[0].originalLabel, "C");
  assert.equal(shuffled.displayOptions[1].content, "Option 1");

  // perm [1,0,2]: correct original 2 stays at display C
  const shuffled2 = resolveSetQuestionAnswer(v, [1, 0, 2]);
  assert.equal(shuffled2.answer, "C");
});

test("set-specific answer keys match each set's own permutation and recompute identically", async () => {
  const { doc: setsDoc } = generateSetsDoc({ id: "p1" }, setsRefs, { count: 4, baseSeed: "regression" });
  const loadVariants = async (familyId) => setsRefs.find((r) => r.family_id === familyId).variants;

  const keys = {};
  for (const set of setsDoc.sets) {
    const key = await computeSetAnswerKey(setsDoc, set.key, loadVariants);
    assert.equal(key.warnings.length, 0, `no warnings in ${set.key}`);
    assert.equal(key.answers.length, 4);
    assert.equal(key.totalMarks, 5);
    // every answer must equal resolveSetQuestionAnswer of that set's permutation
    for (const a of key.answers) {
      if (a.type === "mcq_single") {
        const variantRow = (await loadVariants(a.familyId))[0];
        const expected = resolveSetQuestionAnswer(variantRow, set.questions.find((q) => q.familyId === a.familyId).optionPermutation).answer;
        assert.equal(a.answer, expected, `${set.key} Q${a.number} matches its permutation`);
      }
    }
    keys[set.key] = key.answers.map((a) => a.answer).join("|");
  }
  // different sets genuinely carry different answer strings for the MCQs
  assert.ok(new Set(Object.values(keys)).size > 1, "set keys differ (randomization is real)");
  // determinism: recomputing yields identical output
  const again = await computeSetAnswerKey(setsDoc, setsDoc.sets[0].key, loadVariants);
  assert.deepEqual(again.answers, (await computeSetAnswerKey(setsDoc, setsDoc.sets[0].key, loadVariants)).answers);
});

test("answer keys: mcq_multi joins letters; number answers come from payload; missing variants warn", async () => {
  const multiVariant = variant({ id: "vm", type: "mcq_multi", options: mcqOptions(0, 3).map((o, j) => ({ ...o, is_correct: j === 0 || j === 2 })) });
  const multiRefs = [ref({ family: "fm", sortOrder: 1, variants: [multiVariant] })];
  const { doc: setsDoc } = generateSetsDoc({ id: "p1" }, multiRefs, { count: 1, baseSeed: "s" });
  const key = await computeSetAnswerKey(setsDoc, setsDoc.sets[0].key, async () => multiRefs[0].variants);
  const perm = setsDoc.sets[0].questions[0].optionPermutation;
  const expected = resolveSetQuestionAnswer(multiVariant, perm).answer;
  assert.equal(key.answers[0].answer, expected, "multi answer matches its stored permutation");
  const letters = key.answers[0].answer.split(", ");
  assert.equal(letters.length, 2, "both correct options present as letters");
  assert.ok(letters.every((l) => /^[A-Z]$/.test(l)), "letters, not indexes");

  const missing = await computeSetAnswerKey(setsDoc, setsDoc.sets[0].key, async () => []);
  assert.equal(missing.answers[0].answer, null);
  assert.ok(missing.warnings.length > 0);
});

// --- D. Rendering: Unicode, formulas, images, long content, page breaks ------

const GUJARATI = "ગુજરાતી પ્રશ્ન — સૂર્ય કથાવાચક ગ્રહોમાં સૌથી મોટો છે.";
const HINDI = "हिन्दी प्रश्न — पृथ्वी सूर्य के चारों ओर घूमती है।";

// Flat question row — the shape buildPaperHtml consumes (same as the route:
// resolved families flattened to { content, options, section_key, marks }).
const qrow = ({ id, sectionKey = "sec-a", marks = 1, content, options = [], type = "mcq_single", payload = null, explanation = null }) => ({
  id, family_id: id, section_key: sectionKey, marks, content, options, type, payload, explanation,
});

test("buildPaperHtml preserves Gujarati/Hindi text, renders math targets, keeps page-break CSS", () => {
  const html = buildPaperHtml(
    { id: "p1" },
    [
      qrow({ id: "q-gu", content: doc(GUJARATI), options: mcqOptions(0) }),
      qrow({ id: "q-hi", content: doc(HINDI), options: mcqOptions(1) }),
      qrow({ id: "q-math", sectionKey: "sec-b", content: { type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "Energy: " },
        { type: "math", content: "E = mc^2" },
      ] }] }, options: mcqOptions(2) }),
    ],
    { title: "Bilingual Regression Paper", showAnswers: true }
  );
  assert.ok(html.includes(GUJARATI), "Gujarati text verbatim (not mangled/escaped)");
  assert.ok(html.includes(HINDI), "Hindi text verbatim");
  assert.match(html, /<span class="math" data-expr="E = mc\^2">/i, "math node becomes KaTeX target");
  assert.match(html, /charset="UTF-8"/, "UTF-8 declared");
  assert.match(html, /page-break-inside:\s*avoid/, "page-break CSS present");
  assert.match(html, /katex/, "KaTeX wired for formula rendering");
  assert.ok(html.includes("correct-mark"), "answer key marks correct options");
});

test("PDF: short paper is 1 page; long paper paginates across multiple pages", async () => {
  const countPages = (u8) => {
    const s = Buffer.from(u8).toString("latin1");
    let all = s;
    const re = /stream\r?\n([\s\S]*?)endstream/g;
    let m;
    while ((m = re.exec(s))) {
      try { all += zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { /* not deflated */ }
    }
    return (all.match(/\/Type\s*\/Page\b/g) || []).length;
  };
  const shortHtml = buildPaperHtml({ id: "p1" }, [
    qrow({ id: "q1", content: doc("A short question."), options: mcqOptions(0) }),
  ], { title: "One pager" });
  const shortPdf = await htmlToPdfBuffer(shortHtml);
  assert.equal(countPages(shortPdf), 1, "single page for a short paper");

  const manyQuestions = Array.from({ length: 80 }, (_, i) =>
    qrow({ id: `q${i}`, content: doc(`Question ${i}: ` + "body text ".repeat(12)), options: mcqOptions(i % 3) })
  );
  const longHtml = buildPaperHtml({ id: "p1" }, manyQuestions, { title: "Long paper" });
  const longPdf = await htmlToPdfBuffer(longHtml);
  const pages = countPages(longPdf);
  assert.ok(pages > 1, `long paper paginates (got ${pages} pages)`);
});

test("PDF: bilingual Unicode + formula + image + long unbroken token render end-to-end", async () => {
  // 1x1 PNG data URI (image pipeline check)
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const html = buildPaperHtml(
    { id: "p1" },
    [
      qrow({ id: "q-gu", content: { type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: GUJARATI + " " },
        { type: "image", attrs: { src: png } },
      ] }] }, options: mcqOptions(0) }),
      qrow({ id: "q-hi", content: doc(HINDI + " " + "L".repeat(400)), options: mcqOptions(1) }), // long unbroken token (overflow stress)
      qrow({ id: "q-math", sectionKey: "sec-b", content: { type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "Solve " },
        { type: "math", content: "\frac{a}{b} + \sqrt{c}" },
      ] }] }, type: "numeric", payload: { answer: "x" } }),
    ],
    { title: "Bilingual Paper", languageName: "Gujarati + Hindi" }
  );
  const pdf = await htmlToPdfBuffer(html);
  const bytes = Buffer.from(pdf).length;
  assert.ok(bytes > 5000, `bilingual PDF rendered (${bytes} bytes)`);
  assert.equal(Buffer.from(pdf).slice(0, 5).toString(), "%PDF-", "valid PDF header");
});

test("rendered DOM shows Gujarati/Hindi text laid out with real width (real browser)", async () => {
  const puppeteer = await import("puppeteer");
  const html = buildPaperHtml({ id: "p1" }, [
    qrow({ id: "q-gu", content: doc(GUJARATI), options: mcqOptions(0) }),
    qrow({ id: "q-hi", content: doc(HINDI), options: mcqOptions(1) }),
    qrow({ id: "q-math", sectionKey: "sec-b", content: { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "Mass–energy: " },
      { type: "math", content: "E = mc^2" },
    ] }] }, options: mcqOptions(2) }),
  ], { title: "DOM check" });

  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    // Give KaTeX (CDN) a moment when the network is available; harmless offline.
    await new Promise((r) => setTimeout(r, 1500));
    const result = await page.evaluate(() => {
      const bodies = [...document.querySelectorAll(".q-body")];
      const gu = bodies[0]?.textContent ?? "";
      const hi = bodies[1]?.textContent ?? "";
      const guWidth = bodies[0]?.getBoundingClientRect().width ?? 0;
      const hiWidth = bodies[1]?.getBoundingClientRect().width ?? 0;
      const katexRendered = document.querySelectorAll(".katex").length;
      const mathSpans = document.querySelectorAll("span.math[data-expr]").length;
      return {
        guOk: gu.includes("ગુજરાતી") && gu.includes("પ્રશ્ન"),
        hiOk: hi.includes("हिन्दी") && hi.includes("पृथ्वी"),
        guWidth, hiWidth, katexRendered, mathSpans,
        optionsCount: document.querySelectorAll(".option").length,
      };
    });
    assert.equal(result.guOk, true, "Gujarati text preserved in the rendered DOM");
    assert.equal(result.hiOk, true, "Hindi text preserved in the rendered DOM");
    assert.ok(result.guWidth > 0, `Gujarati question laid out with real width (${result.guWidth}px)`);
    assert.ok(result.hiWidth > 0, `Hindi question laid out with real width (${result.hiWidth}px)`);
    assert.equal(result.mathSpans, 1, "math node present");
    if (result.katexRendered > 0) {
      assert.ok(result.katexRendered >= 1, "KaTeX rendered the formula into styled spans");
    }
    assert.ok(result.optionsCount >= 6, "all MCQ options rendered");
  } finally {
    await browser.close();
  }
});
