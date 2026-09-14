// ---------------------------------------------------------------------------
// Paper Blueprint Engine (Paper Generator Phase 2)
//
// Pure logic for paper blueprints: normalization, validation and availability
// preview against the existing Question Bank. No route or Question Bank
// behavior changes — the Question Bank taxonomy (subject/chapter/topic/type/
// difficulty) is reused as-is via `questionAggregateCounts` / `countQuestions`.
//
// Blueprint shape (see migrations/008_paper_blueprints.sql):
// {
//   version: 1,
//   totalQuestions: number,
//   mode: "count" | "percent",
//   sections: [{ id, name, instructions, marksPerQuestion, negativeMarks,
//                ruleIds: string[], questionCount }],
//   rules: [{ id, sectionId, scope: "paper"|"chapter"|"topic",
//             chapterId, topicId, type, difficulty, count, percent }]
// }
// ---------------------------------------------------------------------------

export const VALID_SCOPES = ["paper", "chapter", "topic"];
export const VALID_MODES = ["count", "percent"];

// Mirrors the DB check constraint on questions.type / questions.difficulty —
// kept as a soft validation here; the source of truth remains the DB.
export const VALID_QUESTION_TYPES = new Set([
  "mcq_single", "mcq_multi", "true_false", "fill_blank",
  "short_answer", "long_answer", "match", "ordering", "image_based", "numeric",
]);
export const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard", "expert"]);

export function emptyBlueprint() {
  return { version: 1, totalQuestions: 0, mode: "count", sections: [], rules: [] };
}

/**
 * Coerce an untrusted JSON value into a normalized blueprint. Throws nothing;
 * returns { blueprint, errors } where errors lists fields that were dropped or
 * clamped. Unparseable input yields an empty blueprint with an error entry.
 */
export function normalizeBlueprint(input) {
  const errors = [];
  const bp = emptyBlueprint();
  if (input === null || input === undefined) return { blueprint: bp, errors };

  if (typeof input !== "object") {
    return { blueprint: bp, errors: ["Blueprint must be a JSON object."] };
  }

  const total = Number(input.totalQuestions);
  bp.totalQuestions = Number.isInteger(total) && total > 0 ? total : 0;

  bp.mode = input.mode === "percent" ? "percent" : "count";

  const sectionIds = new Set();
  const sections = Array.isArray(input.sections) ? input.sections : [];
  for (const s of sections.slice(0, 50)) {
    if (!s || typeof s !== "object") continue;
    const id = typeof s.id === "string" && s.id.trim() ? s.id.trim() : null;
    if (!id || sectionIds.has(id)) {
      errors.push(`Section with missing or duplicate id skipped.`);
      continue;
    }
    sectionIds.add(id);
    const marks = Number(s.marksPerQuestion);
    const neg = Number(s.negativeMarks);
    bp.sections.push({
      id,
      name: typeof s.name === "string" ? s.name.slice(0, 120) : `Section ${bp.sections.length + 1}`,
      instructions: typeof s.instructions === "string" ? s.instructions.slice(0, 2000) : "",
      marksPerQuestion: Number.isFinite(marks) && marks > 0 ? marks : 1,
      negativeMarks: Number.isFinite(neg) && neg >= 0 ? neg : 0,
      ruleIds: Array.isArray(s.ruleIds) ? s.ruleIds.filter((r) => typeof r === "string") : [],
      questionCount: 0, // computed during validation, always stored normalized
    });
  }

  const ruleIds = new Set();
  const rules = Array.isArray(input.rules) ? input.rules : [];
  for (const r of rules.slice(0, 200)) {
    if (!r || typeof r !== "object") continue;
    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : null;
    if (!id || ruleIds.has(id)) {
      errors.push(`Rule with missing or duplicate id skipped.`);
      continue;
    }
    ruleIds.add(id);
    const count = Number(r.count);
    const percent = Number(r.percent);
    bp.rules.push({
      id,
      sectionId: typeof r.sectionId === "string" && sectionIds.has(r.sectionId) ? r.sectionId : null,
      scope: VALID_SCOPES.includes(r.scope) ? r.scope : "paper",
      chapterId: typeof r.chapterId === "string" && r.chapterId ? r.chapterId : null,
      topicId: typeof r.topicId === "string" && r.topicId ? r.topicId : null,
      type: VALID_QUESTION_TYPES.has(r.type) ? r.type : null,
      difficulty: VALID_DIFFICULTIES.has(r.difficulty) ? r.difficulty : null,
      count: Number.isInteger(count) && count > 0 ? count : 0,
      percent: Number.isFinite(percent) && percent > 0 && percent <= 100 ? percent : 0,
    });
  }

  if (errors.length) errors.unshift("Some blueprint fields were normalized or dropped:");
  return { blueprint: bp, errors };
}

/**
 * Validate logical consistency of a blueprint.
 * Returns { errors: string[], warnings: string[], summary }.
 */
export function validateBlueprint(bp) {
  const errors = [];
  const warnings = [];
  if (!bp || typeof bp !== "object") {
    return { errors: ["Blueprint is missing or malformed."], warnings, summary: null };
  }

  const sections = Array.isArray(bp.sections) ? bp.sections : [];
  const rules = Array.isArray(bp.rules) ? bp.rules : [];

  // Rule → section integrity
  const sectionIds = new Set(sections.map((s) => s.id));
  for (const r of rules) {
    if (!r.sectionId || !sectionIds.has(r.sectionId)) {
      errors.push(`Rule "${r.id}" is not assigned to a valid section.`);
    }
  }

  // Percent mode: rule percentages are shares of the paper's totalQuestions,
  // distributed across sections (sections partition the paper). So the
  // paper-level sum of all rule percents must be exactly 100%.
  if (bp.mode === "percent") {
    const activeRules = rules.filter((r) => r.sectionId && sectionIds.has(r.sectionId));
    if (activeRules.length === 0) {
      warnings.push("No distribution rules defined yet.");
    } else {
      const total = activeRules.reduce((sum, r) => sum + (Number(r.percent) || 0), 0);
      if (Math.abs(total - 100) > 0.01) {
        errors.push(
          `Distribution totals ${total}% across the paper (must be exactly 100%).`
        );
      }
    }
    for (const s of sections) {
      const secRules = rules.filter((r) => r.sectionId === s.id);
      if (secRules.length === 0) {
        warnings.push(`Section "${s.name}" has no distribution rules.`);
      }
    }
  }

  // Compute per-section question counts from rules.
  const rulesBySection = new Map();
  for (const r of rules) {
    if (!r.sectionId || !sectionIds.has(r.sectionId)) continue;
    if (!rulesBySection.has(r.sectionId)) rulesBySection.set(r.sectionId, []);
    rulesBySection.get(r.sectionId).push(r);
  }

  for (const s of sections) {
    const secRules = rulesBySection.get(s.id) ?? [];
    let count = 0;
    if (bp.mode === "count") {
      count = secRules.reduce((sum, r) => sum + (Number(r.count) || 0), 0);
      if (count === 0) warnings.push(`Section "${s.name}" has no questions.`);
    } else {
      // Percent mode: each section's share of the paper's totalQuestions.
      // Rounding drift is absorbed at generation time; warn if it appears.
      const totalQ = Number(bp.totalQuestions) || 0;
      const secPercent = secRules.reduce((sum, r) => sum + (Number(r.percent) || 0), 0);
      count = Math.round((totalQ * secPercent) / 100);
    }
    s.questionCount = count;
  }

  // Paper-level totals.
  const sectionTotal = sections.reduce((sum, s) => sum + (s.questionCount || 0), 0);
  if (bp.totalQuestions > 0 && sectionTotal !== bp.totalQuestions) {
    if (bp.mode === "count") {
      errors.push(
        `Sections total ${sectionTotal} questions but paper declares ${bp.totalQuestions}.`
      );
    } else if (Math.abs(sectionTotal - bp.totalQuestions) > sections.length) {
      // Percent rounding can drift by at most ~½ question per section; larger
      // drift means the percents don't actually cover the declared total.
      errors.push(
        `Sections total ${sectionTotal} questions but paper declares ${bp.totalQuestions}.`
      );
    } else if (sectionTotal !== bp.totalQuestions) {
      warnings.push(
        `Rounding drift: sections total ${sectionTotal} of ${bp.totalQuestions} questions; adjusted at generation time.`
      );
    }
  }
  if (bp.totalQuestions <= 0 && sectionTotal > 0) {
    warnings.push("Paper-level total questions is not set; using section totals.");
  }

  // Marks consistency (informational warnings against the paper's own fields).
  const marksPerQuestion = sections.map((s) => Number(s.marksPerQuestion) || 0);
  const totalMarksEstimate = sections.reduce(
    (sum, s) => sum + (s.questionCount || 0) * (Number(s.marksPerQuestion) || 0),
    0
  );
  if (sections.length === 0) {
    warnings.push("Blueprint has no sections yet.");
  }
  if (marksPerQuestion.some((m) => m <= 0) && sections.length > 0) {
    warnings.push("One or more sections have zero marks per question.");
  }

  return {
    errors,
    warnings,
    summary: {
      totalQuestions: bp.totalQuestions > 0 ? bp.totalQuestions : sectionTotal,
      sectionTotal,
      totalMarksEstimate,
      marksPerQuestion,
    },
  };
}

/**
 * Availability preview: for each rule, how many matching questions exist in
 * the Question Bank right now. `loadCounts(filters)` must return a count for
 * a filter object (standard/subject/chapter/topic/type/difficulty/status...).
 * Returns { rules: [{ ruleId, available, shortfall }], sectionShortfalls }.
 */
export async function previewBlueprintAvailability(bp, loadCounts) {
  const rules = Array.isArray(bp?.rules) ? bp.rules : [];
  const sections = Array.isArray(bp?.sections) ? bp.sections : [];

  // Paper-level context (standard/subject) is applied to every rule — rules
  // only ever narrow it down (chapter/topic/type/difficulty).
  const paperFilters = {};
  if (bp?.standardId) paperFilters.standard_id = bp.standardId;
  if (bp?.subjectId) paperFilters.subject_id = bp.subjectId;

  const ruleResults = [];
  for (const r of rules) {
    const filters = { ...paperFilters };
    if (r.scope === "chapter" && r.chapterId) filters.chapter_id = r.chapterId;
    if (r.scope === "topic" && r.topicId) filters.topic_id = r.topicId;
    if (r.type) filters.type = r.type;
    if (r.difficulty) filters.difficulty = r.difficulty;

    let available = null;
    try {
      available = await loadCounts(filters);
    } catch {
      available = null;
    }
    const demanded = bp.mode === "percent"
      ? Math.round(((Number(bp.totalQuestions) || 0) * (Number(r.percent) || 0)) / 100)
      : Number(r.count) || 0;
    ruleResults.push({
      ruleId: r.id,
      sectionId: r.sectionId,
      available,
      demanded: demanded || null,
      shortfall: demanded > 0 && available !== null ? Math.max(0, demanded - available) : 0,
    });
  }

  const sectionShortfalls = {};
  for (const s of sections) {
    sectionShortfalls[s.id] = ruleResults
      .filter((x) => x.sectionId === s.id)
      .reduce((sum, x) => sum + (x.shortfall || 0), 0);
  }

  return { rules: ruleResults, sectionShortfalls };
}

// ---------------------------------------------------------------------------
// Question Selection Engine (Paper Generator Phase 3)
// ---------------------------------------------------------------------------

/** xmurm-style 32-bit string hash → integer seed. */
export function hashSeed(str) {
  let h = 2166136261;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — small, fast, deterministic for a given seed. */
export function createRng(seed) {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle driven by an rng() function (does not mutate input). */
export function seededShuffle(array, rng) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Question demand for one rule (count mode: rule.count; percent: share of paper total). */
function ruleDemand(bp, rule) {
  if (bp.mode === "percent") {
    return Math.round(((Number(bp.totalQuestions) || 0) * (Number(rule.percent) || 0)) / 100);
  }
  return Number(rule.count) || 0;
}

/**
 * Select questions for a blueprint from the existing Question Bank.
 *
 * `loadCandidates(filters)` must return an array of question rows (at minimum
 * `{ id, family_id, ... }`) matching the filter object — wire it to the
 * EXISTING `listQuestions()` (same filter semantics: standard_id, subject_id,
 * chapter_id, topic_id, type, difficulty, status...). Use a generous `limit`
 * (e.g. 500); family-level uniqueness is enforced in this service.
 *
 * Selection modes:
 *   - automatic: no existing families → blueprint fills everything
 *   - hybrid:    `existingFamilyIds` (locked) are a paper-level pool consumed
 *                against section demand in section order; only the remainder
 *                is selected automatically (and never duplicates a locked one)
 *
 * The same logical question (family) is never picked twice. Questions without
 * a family_id are skipped (paper_families requires a family reference).
 *
 * Returns { selections, shortages, satisfied } — never mutates anything and
 * never creates Question Bank records. On shortage the caller must NOT save a
 * partial paper; return `shortages` to the admin instead.
 */
export async function selectQuestionsForBlueprint(bp, loadCandidates, existingFamilyIds = [], seed = null) {
  const sections = Array.isArray(bp?.sections) ? bp.sections : [];
  const rules = Array.isArray(bp?.rules) ? bp.rules : [];
  const rng = createRng(seed ?? "");

  const usedFamilies = new Set(
    (Array.isArray(existingFamilyIds) ? existingFamilyIds : []).filter(Boolean)
  );
  const selections = [];
  const shortages = [];
  // Hybrid locked pool: consumed against section demand in section order.
  let lockedPool = (Array.isArray(existingFamilyIds) ? existingFamilyIds : [])
    .filter(Boolean).length;

  const paperFilters = {};
  if (bp?.standardId) paperFilters.standard_id = bp.standardId;
  if (bp?.subjectId) paperFilters.subject_id = bp.subjectId;

  const pickFresh = (candidates, need) => {
    const taken = [];
    for (const q of seededShuffle(candidates ?? [], rng)) {
      if (taken.length >= need) break;
      // paper_families requires a family reference; questions without one
      // cannot participate in paper composition (createQuestion auto-assigns
      // families, so this only guards legacy rows).
      const fam = q.family_id ?? null;
      if (!fam || usedFamilies.has(fam)) continue;
      taken.push(q);
      usedFamilies.add(fam);
    }
    return taken;
  };

  for (const section of sections) {
    const secRules = rules.filter(
      (r) => r.sectionId === section.id
    );

    // Section demand (mirrors validateBlueprint's questionCount computation).
    let demand;
    if (bp.mode === "count") {
      demand = secRules.reduce((sum, r) => sum + (Number(r.count) || 0), 0);
    } else {
      const secPercent = secRules.reduce((sum, r) => sum + (Number(r.percent) || 0), 0);
      demand = Math.round(((Number(bp.totalQuestions) || 0) * secPercent) / 100);
    }

    // Hybrid: locked questions already in the paper consume demand first.
    const lockedUsedHere = Math.min(lockedPool, demand);
    lockedPool -= lockedUsedHere;
    const remaining = Math.max(0, demand - lockedUsedHere);
    let filled = 0;

    for (const rule of secRules) {
      if (filled >= remaining) break;
      const need = Math.min(ruleDemand(bp, rule), remaining - filled);
      if (need <= 0) continue;

      const filters = { ...paperFilters };
      if (rule.scope === "chapter" && rule.chapterId) filters.chapter_id = rule.chapterId;
      if (rule.scope === "topic" && rule.topicId) filters.topic_id = rule.topicId;
      if (rule.type) filters.type = rule.type;
      if (rule.difficulty) filters.difficulty = rule.difficulty;

      let candidates = [];
      try {
        candidates = await loadCandidates({ ...filters, limit: 500 });
      } catch {
        candidates = [];
      }
      const taken = pickFresh(candidates, need);
      for (const q of taken) {
        selections.push({
          familyId: q.family_id ?? null,
          questionId: q.id,
          sectionId: section.id,
          ruleId: rule.id,
          marks: Number(section.marksPerQuestion) || 0,
        });
      }
      filled += taken.length;

      if (taken.length < need) {
        shortages.push({
          ruleId: rule.id,
          sectionId: section.id,
          scope: rule.scope,
          chapterId: rule.chapterId ?? null,
          topicId: rule.topicId ?? null,
          type: rule.type ?? null,
          difficulty: rule.difficulty ?? null,
          demanded: need,
          filled: taken.length,
          missing: need - taken.length,
        });
      }
    }

    // Overflow fill: blueprint under-specified for this section (e.g. locked
    // questions + rules that don't sum to the section demand). Fill remaining
    // slots from the paper-level pool so sections are never silently short.
    if (filled < remaining && remaining > 0) {
      let candidates = [];
      try {
        candidates = await loadCandidates({ ...paperFilters, limit: 500 });
      } catch {
        candidates = [];
      }
      const taken = pickFresh(candidates, remaining - filled);
      for (const q of taken) {
        selections.push({
          familyId: q.family_id ?? null,
          questionId: q.id,
          sectionId: section.id,
          ruleId: null,
          marks: Number(section.marksPerQuestion) || 0,
        });
      }
      filled += taken.length;
    }

    if (filled < remaining) {
      shortages.push({
        ruleId: null,
        sectionId: section.id,
        scope: "paper",
        chapterId: null,
        topicId: null,
        type: null,
        difficulty: null,
        demanded: remaining,
        filled,
        missing: remaining - filled,
      });
    }
  }

  return {
    selections,
    shortages,
    satisfied: shortages.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Section & Paper Structure Engine (Paper Generator Phase 4)
// ---------------------------------------------------------------------------

const DEFAULT_SECTION_KEY = "__default__";

/**
 * Compute the effective paper structure from a paper, its ordered family
 * references and (optionally) its blueprint.
 *
 * Backward compatible by design:
 *   - papers without a blueprint → one implicit section holding every family
 *   - families without a section_key (created before Phase 4) → trailing
 *     implicit "Unassigned" section, preserving their relative order
 *
 * Returns per-section metadata (title, instructions, marks/negative rules,
 * question type & difficulty constraints), global question numbering and
 * paper totals: total questions, total marks, maximum possible score and the
 * minimum possible score under negative marking.
 *
 * Pure function — no data access, safe to unit test.
 */
export function computePaperStructure(paper, familyRefs, blueprint) {
  const families = (Array.isArray(familyRefs) ? familyRefs : [])
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

  const bpSections = Array.isArray(blueprint?.sections) ? blueprint.sections : [];
  const bpRules = Array.isArray(blueprint?.rules) ? blueprint.rules : [];

  const sectionMeta = new Map();
  for (const s of bpSections) {
    const secRules = bpRules.filter((r) => r.sectionId === s.id);
    sectionMeta.set(s.id, {
      key: s.id,
      name: s.name || `Section`,
      instructions: s.instructions || "",
      marksPerQuestion: Number(s.marksPerQuestion) || 1,
      negativeMarks: Number(s.negativeMarks) || 0,
      types: [...new Set(secRules.map((r) => r.type).filter(Boolean))],
      difficulties: [...new Set(secRules.map((r) => r.difficulty).filter(Boolean))],
      families: [],
    });
  }

  // Assign families to sections; anything unassigned trails in an implicit
  // section so pre-Phase-4 records keep rendering.
  const unassigned = [];
  for (const f of families) {
    const bucket = f.section_key ? sectionMeta.get(f.section_key) : null;
    if (bucket) bucket.families.push(f);
    else unassigned.push(f);
  }
  if (unassigned.length > 0) {
    sectionMeta.set(DEFAULT_SECTION_KEY, {
      key: DEFAULT_SECTION_KEY,
      name: bpSections.length > 0 ? "Unassigned" : "Questions",
      instructions: "",
      marksPerQuestion: 1,
      negativeMarks: 0,
      types: [],
      difficulties: [],
      families: unassigned,
    });
  }

  // Global numbering continues across sections (existing convention).
  let number = 0;
  let totalMarks = 0;
  let negativeMarksTotal = 0;
  const sectionsOut = [...sectionMeta.values()]
    // Blueprint order first, implicit unassigned section last.
    .sort((a, b) => {
      const ai = bpSections.findIndex((s) => s.id === a.key);
      const bi = bpSections.findIndex((s) => s.id === b.key);
      return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    })
    .map((section) => {
      const familiesOut = section.families.map((f) => {
        number += 1;
        const effectiveMarks =
          Number(f.marks) > 0 ? Number(f.marks) : section.marksPerQuestion || 1;
        totalMarks += effectiveMarks;
        negativeMarksTotal += section.negativeMarks;
        return {
          family_id: f.family_id,
          sort_order: Number(f.sort_order) || 0,
          marks: Number(f.marks) || 0,
          effectiveMarks,
          number,
          title: f.title ?? null,
        };
      });
      return {
        key: section.key,
        name: section.name,
        instructions: section.instructions,
        marksPerQuestion: section.marksPerQuestion,
        negativeMarks: section.negativeMarks,
        types: section.types,
        difficulties: section.difficulties,
        families: familiesOut,
        questionCount: familiesOut.length,
        marksTotal: familiesOut.reduce((sum, f) => sum + f.effectiveMarks, 0),
      };
    });

  const warnings = [];
  if (bpSections.length > 0 && unassigned.length > 0) {
    warnings.push(
      `${unassigned.length} question(s) are not assigned to any blueprint section and render last.`
    );
  }
  if (paper?.total_marks !== undefined && paper?.total_marks !== null) {
    const declared = Number(paper.total_marks) || 0;
    if (declared > 0 && Math.abs(declared - totalMarks) > 0.001) {
      warnings.push(
        `Paper declares ${declared} total marks but its questions sum to ${totalMarks}.`
      );
    }
  }

  return {
    sections: sectionsOut,
    totals: {
      totalQuestions: families.length,
      totalMarks,
      maxScore: totalMarks,
      minScore: -negativeMarksTotal,
      negativeMarksTotal,
      sectionsCount: sectionsOut.length,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Replace Question (Paper Generator Phase 5)
// ---------------------------------------------------------------------------

const marksEqual = (a, b) => Number(a) === Number(b);

/**
 * Pick the best replacement for a question from a candidate list.
 *
 * `candidates` are Question Bank rows (reuse of the existing listQuestions
 * filter engine — the route constrains standard/subject at query level, so
 * "same subject/class" is guaranteed before this runs). The ladder prefers
 * the tightest match and relaxes stepwise; questions already in the paper
 * (excludeFamilyIds) are never offered — no duplicates, ever. The original
 * Question Bank question is never modified here (the caller swaps references
 * inside the paper only).
 *
 * Deterministic for a given seed. Returns { question, match, exact } or
 * { question: null, reason } when nothing suitable exists.
 */
export function findReplacement(candidates, current, excludeFamilyIds = [], seed = null) {
  const rng = createRng(seed ?? "");
  const exclude = new Set(
    (Array.isArray(excludeFamilyIds) ? excludeFamilyIds : []).filter(Boolean)
  );
  const pool = (Array.isArray(candidates) ? candidates : []).filter((q) => {
    if (!q.family_id) return false; // paper_families requires a family reference
    if (exclude.has(q.family_id)) return false;
    if (current.familyId && q.family_id === current.familyId) return false;
    return true;
  });
  if (pool.length === 0) {
    return {
      question: null,
      reason: exclude.size > 0
        ? "Every matching question is already used in this paper."
        : "No eligible published questions are available.",
    };
  }

  const sameChapter = current.chapterId
    ? (q) => q.chapter_id === current.chapterId
    : () => false;
  const sameTopic = current.topicId
    ? (q) => q.topic_id === current.topicId
    : () => false;
  const sameType = current.type ? (q) => q.type === current.type : () => false;
  const sameDifficulty = current.difficulty
    ? (q) => q.difficulty === current.difficulty
    : () => false;
  const sameMarks = current.marks !== undefined && current.marks !== null
    ? (q) => marksEqual(q.marks, current.marks)
    : () => false;

  // Relaxation ladder: tightest constraints first.
  const levels = [
    { label: "exact match (topic, type, difficulty, marks)", test: (q) =>
        sameTopic(q) && sameType(q) && sameDifficulty(q) && sameMarks(q) },
    { label: "same chapter, type, difficulty and marks", test: (q) =>
        sameChapter(q) && sameType(q) && sameDifficulty(q) && sameMarks(q) },
    { label: "same chapter, type and marks", test: (q) =>
        sameChapter(q) && sameType(q) && sameMarks(q) },
    { label: "same chapter and type", test: (q) => sameChapter(q) && sameType(q) },
    { label: "same type and difficulty", test: (q) => sameType(q) && sameDifficulty(q) },
    { label: "same type", test: (q) => sameType(q) },
    { label: "any eligible question", test: () => true },
  ];

  for (let i = 0; i < levels.length; i++) {
    const matches = pool.filter(levels[i].test);
    if (matches.length > 0) {
      const picked = seededShuffle(matches, rng)[0];
      return { question: picked, match: levels[i].label, exact: i === 0 };
    }
  }
  // Unreachable (last level matches everything) — kept for safety.
  return { question: null, reason: "No suitable replacement exists." };
}

// ---------------------------------------------------------------------------
// Paper Validation Engine (Paper Generator Phase 6)
// ---------------------------------------------------------------------------
// Read-only validation of a complete paper before publish/export. Takes the
// loaded paper + family variants (getPaperById) and the stored blueprint
// (getPaperBlueprint); never mutates question content — it only reports.

// TipTap node types that reference external media (see ResizableImage.ts).
const MEDIA_NODE_TYPES = new Set(["resizableImage"]);
// Question types that require options (mirrors the Question Entry form).
const OPTION_TYPES = new Set(["mcq_single", "mcq_multi", "true_false"]);

function collectContentMedia(doc, out = []) {
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (MEDIA_NODE_TYPES.has(node.type)) out.push(node);
    const children = Array.isArray(node.content) ? node.content : [];
    for (const child of children) walk(child);
  };
  walk(doc);
  return out;
}

function textLengthOfDoc(doc) {
  let len = 0;
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string") len += node.text.trim().length;
    const children = Array.isArray(node.content) ? node.content : [];
    for (const child of children) walk(child);
  };
  walk(doc);
  return len;
}

/**
 * True when an option/content value carries usable content. Accepts the two
 * stored formats: plain strings and the rich-editor format ({ html: "…" })
 * saved by the question entry UI (rendered by storedRichHelper in the admin
 * UI). Prevents false "empty option" validation errors for rich options.
 */
function optionHasContent(content) {
  if (typeof content === "string") return content.trim().length > 0;
  if (content && typeof content === "object" && typeof content.html === "string") {
    return content.html.replace(/<[^>]*>/g, "").trim().length > 0;
  }
  return false;
}

/**
 * Validate a paper for publication readiness.
 *
 * @param {object} paper      rowToPaper output
 * @param {Array}  familyRefs paper families from getPaperById (primary + variants)
 * @param {object|null} blueprint stored blueprint (normalized shape)
 * @param {object} [options]
 * @param {Array}  [options.languages]         all languages (availability info)
 * @param {Array}  [options.requiredLanguages] languages the paper must fully cover
 * @param {boolean} [options.migrationRequired] true when migration 008 is unapplied
 * @returns {{ results: Array<{level, section, question, field, problem, action}>,
 *                  summary: {errors, warnings, infos, canPublish, computedMarks,
 *                            questionCount, migrationRequired, migrationNote} }}
 */
export function validatePaper(paper, familyRefs, blueprint, options = {}) {
  const results = [];
  const add = (level, section, question, field, problem, action) =>
    results.push({
      level,
      section: section ?? null,
      question: question ?? null,
      field: field ?? null,
      problem,
      action,
    });

  const families = (Array.isArray(familyRefs) ? familyRefs : [])
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  const bpSections = Array.isArray(blueprint?.sections) ? blueprint.sections : [];
  const bpRules = Array.isArray(blueprint?.rules) ? blueprint.rules : [];

  const sectionMeta = new Map();
  for (const s of bpSections) {
    const secRules = bpRules.filter((r) => r.sectionId === s.id);
    sectionMeta.set(s.id, {
      name: s.name || "Section",
      marksPerQuestion: Number(s.marksPerQuestion) || 1,
      negativeMarks: Number(s.negativeMarks) || 0,
      types: [...new Set(secRules.map((r) => r.type).filter(Boolean))],
      difficulties: [...new Set(secRules.map((r) => r.difficulty).filter(Boolean))],
    });
  }
  const sectionNameOf = (key) =>
    key && sectionMeta.has(key) ? sectionMeta.get(key).name : "Unassigned";

  // 1) Duplicate questions (family-level, per the paper_families schema).
  const byFamily = new Map();
  families.forEach((f, idx) => {
    const list = byFamily.get(f.family_id) ?? [];
    list.push({ f, idx });
    byFamily.set(f.family_id, list);
  });
  for (const [familyId, entries] of byFamily) {
    if (entries.length > 1) {
      add(
        "ERROR",
        entries.map((e) => sectionNameOf(e.f.section_key)).join(", "),
        `family ${String(familyId).slice(0, 8)}…`,
        "family_id",
        `Question family appears ${entries.length} times in the paper.`,
        "Remove the duplicate entries (Questions page)."
      );
    }
  }

  // 2) Per-question checks + section compliance.
  let computedMarks = 0;
  let negativeTotal = 0;
  const familyLanguages = new Map(); // family_id -> Set(language_id)
  for (const f of families) {
    const langs = new Set();
    for (const v of f.variants ?? []) if (v.language_id) langs.add(v.language_id);
    familyLanguages.set(f.family_id, langs);
  }
  const assignment = new Map(); // section key -> count

  for (let idx = 0; idx < families.length; idx++) {
    const f = families[idx];
    const secKey = f.section_key || null;
    const secMeta = secKey ? sectionMeta.get(secKey) ?? null : null;
    const sectionLabel = secKey ? sectionNameOf(secKey) : "Unassigned";
    const label = `Q${idx + 1}`;
    assignment.set(secKey, (assignment.get(secKey) || 0) + 1);

    if (secKey && !sectionMeta.has(secKey)) {
      add(
        "ERROR",
        sectionLabel,
        label,
        "section_key",
        `Assigned to section "${secKey}" which does not exist in the blueprint.`,
        "Re-assign the question to a blueprint section (Questions page)."
      );
    }
    if (!secKey && bpSections.length > 0) {
      add(
        "WARNING",
        "Unassigned",
        label,
        "section_key",
        "Question is not assigned to any blueprint section.",
        "Assign it to a section (Questions page)."
      );
    }

    const v = f.primary;
    if (!v) {
      add(
        "ERROR",
        sectionLabel,
        label,
        "primary",
        "Question family has no question variants — the paper question cannot be rendered.",
        "Re-select a valid question for this slot (replace or re-generate)."
      );
      continue;
    }

    // 2a) Required data.
    if (!v.type || !VALID_QUESTION_TYPES.has(v.type)) {
      add(
        "ERROR",
        sectionLabel,
        label,
        "type",
        `Invalid or unknown question type${v.type ? ` "${v.type}"` : ""}.`,
        "Fix the question in the Question Bank or replace it in the paper."
      );
    }
    if (!(Number(v.marks) > 0) && !(Number(f.marks) > 0)) {
      add(
        "ERROR",
        sectionLabel,
        label,
        "marks",
        "Question has no positive marks value.",
        "Set marks in the Question Bank or on the paper (Questions page)."
      );
    }
    const mediaNodes = collectContentMedia(v.content);
    if (textLengthOfDoc(v.content) === 0 && mediaNodes.length === 0) {
      add(
        "ERROR",
        sectionLabel,
        label,
        "content",
        "Question content is empty.",
        "Add content in the Question Bank or replace the question."
      );
    }

    // 2b) Media checks.
    const requiredImage = v.type === "image_based";
    if (requiredImage && !v.image_url && mediaNodes.length === 0) {
      add(
        "ERROR",
        sectionLabel,
        label,
        "image",
        "Image-based question has no image (neither a content image nor image_url).",
        "Add the image in the Question Bank or replace the question."
      );
    }
    for (const node of mediaNodes) {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : null;
      if (!src) {
        add(
          "ERROR",
          sectionLabel,
          label,
          "image.src",
          "Image node has no source (broken media reference).",
          "Re-upload the image in the Question Bank or replace the question."
        );
      } else if (!/^https?:\/\//i.test(src) && !/^data:image\//i.test(src)) {
        add(
          "WARNING",
          sectionLabel,
          label,
          "image.src",
          `Image src may not resolve at print time: ${src.slice(0, 80)}`,
          "Re-upload the image so it is served over http(s) or embedded as a data URL."
        );
      }
      if (requiredImage && !v.image_url && !node.attrs?.alt) {
        add(
          "INFO",
          sectionLabel,
          label,
          "image.alt",
          "Image has no alt text (accessibility / print fallback).",
          "Optionally add alt text in the Question Bank."
        );
      }
    }

    // 2c) Options / answers for option-based types.
    if (OPTION_TYPES.has(v.type)) {
      const opts = Array.isArray(v.options) ? v.options : [];
      if (opts.length === 0) {
        add(
          "ERROR",
          sectionLabel,
          label,
          "options",
          `Question type "${v.type}" requires options but none are configured.`,
          "Add options in the Question Bank or replace the question."
        );
      } else {
        const blank = opts.filter((o) => !optionHasContent(o.content));
        if (blank.length > 0) {
          add(
            "ERROR",
            sectionLabel,
            label,
            "options",
            blank.length === 1
              ? "One option has no content."
              : `${blank.length} options have no content.`,
            "Fill in or remove the empty options in the Question Bank."
          );
        }
        const correct = opts.filter((o) => o.is_correct);
        if (correct.length === 0) {
          add(
            "ERROR",
            sectionLabel,
            label,
            "options.is_correct",
            "No correct option is marked.",
            "Mark a correct option in the Question Bank."
          );
        } else if (v.type === "mcq_single" && correct.length > 1) {
          add(
            "ERROR",
            sectionLabel,
            label,
            "options.is_correct",
            `Single-answer MCQ has ${correct.length} correct options marked.`,
            "Keep exactly one correct option in the Question Bank."
          );
        }
      }
    }

    // 2d) Section rule compliance (type / difficulty) + marks accounting.
    if (secMeta && secMeta.types.length > 0 && !secMeta.types.includes(v.type)) {
      add(
        "WARNING",
        sectionLabel,
        label,
        "type",
        `Question type "${v.type}" is not among the section's blueprint types (${secMeta.types.join(", ")}).`,
        "Move the question to a matching section or adjust the blueprint rule."
      );
    }
    if (
      secMeta &&
      secMeta.difficulties.length > 0 &&
      !secMeta.difficulties.includes(v.difficulty)
    ) {
      add(
        "WARNING",
        sectionLabel,
        label,
        "difficulty",
        `Difficulty "${v.difficulty ?? "—"}" is not among the section's blueprint difficulties (${secMeta.difficulties.join(", ")}).`,
        "Replace with a matching-difficulty question or adjust the blueprint rule."
      );
    }
    const effectiveMarks = Number(f.marks) > 0 ? Number(f.marks) : Number(v.marks) || 0;
    computedMarks += effectiveMarks;
    negativeTotal += secMeta?.negativeMarks ?? 0;
    if (secMeta && Number(f.marks) > 0 && Number(f.marks) !== secMeta.marksPerQuestion) {
      add(
        "INFO",
        sectionLabel,
        label,
        "marks",
        `Marks (${f.marks}) override the section default (${secMeta.marksPerQuestion}).`,
        "No action needed — override is intentional."
      );
    }
  }

  // 3) Paper totals & negative marking configuration.
  const declaredTotal = Number(paper?.total_marks);
  if (
    Number.isFinite(declaredTotal) &&
    declaredTotal > 0 &&
    declaredTotal !== computedMarks &&
    families.length > 0
  ) {
    add(
      "WARNING",
      "Paper",
      null,
      "total_marks",
      `Declared total marks (${declaredTotal}) do not match the computed total (${computedMarks}).`,
      "Update the paper's total_marks or adjust per-question marks."
    );
  }
  add(
    "INFO",
    "Paper",
    null,
    "negative_marks",
    negativeTotal > 0
      ? `Negative marking active: maximum penalty ${negativeTotal} marks across the paper.`
      : "No negative marking configured for any section.",
    negativeTotal > 0
      ? "Confirm this matches the exam's marking scheme."
      : "Configure negativeMarks in blueprint sections if the exam requires it."
  );

  // 4) Question count vs blueprint demand (per section + paper total).
  if (bpSections.length > 0 && blueprint) {
    let totalDemand = 0;
    for (const s of bpSections) {
      const d = bpRules
        .filter((r) => r.sectionId === s.id)
        .reduce((sum, r) => sum + (Number(r.count) || 0), 0);
      if (blueprint.mode === "percent") {
        const pct = bpRules
          .filter((r) => r.sectionId === s.id)
          .reduce((sum, r) => sum + (Number(r.percent) || 0), 0);
        totalDemand += Math.round(((Number(blueprint.totalQuestions) || 0) * pct) / 100);
      } else {
        totalDemand += d;
      }
      const got = assignment.get(s.id) || 0;
      if (d > 0 && got !== d) {
        add(
          "WARNING",
          s.name,
          null,
          "questionCount",
          `Section has ${got} question(s) but the blueprint requires ${d}.`,
          "Regenerate, add or remove questions to match the blueprint."
        );
      } else if (d === 0 && got > 0) {
        add(
          "WARNING",
          s.name,
          null,
          "questionCount",
          `Section has ${got} question(s) but its blueprint rules demand none.`,
          "Regenerate, remove the extra questions, or add rules to the section."
        );
      }
    }
    if (totalDemand > 0 && families.length !== totalDemand) {
      add(
        "WARNING",
        "Paper",
        null,
        "questionCount",
        `Paper has ${families.length} question(s) but the blueprint requires ${totalDemand}.`,
        "Regenerate or adjust the blueprint."
      );
    }
  }

  // 5) Blueprint structural sanity — reuse the Phase 2 validator.
  if (blueprint) {
    const { errors: bpErrors, warnings: bpWarnings } = validateBlueprint(blueprint);
    for (const msg of bpErrors) {
      add("ERROR", "Paper", null, "blueprint", msg, "Fix the blueprint (Blueprint page).");
    }
    for (const msg of bpWarnings) {
      add("WARNING", "Paper", null, "blueprint", msg, "Review the blueprint (Blueprint page).");
    }
  }

  // 6) Language availability / translation completeness.
  const languages = Array.isArray(options.languages) ? options.languages : [];
  const required = Array.isArray(options.requiredLanguages)
    ? options.requiredLanguages
    : [];
  if (families.length > 0) {
    for (const lang of required) {
      const langId = typeof lang === "object" ? lang.id : lang;
      const langName = typeof lang === "object" ? lang.name ?? langId : langId;
      const missing = families.filter(
        (f) => !familyLanguages.get(f.family_id)?.has(langId)
      ).length;
      if (missing > 0) {
        add(
          "ERROR",
          "Paper",
          null,
          `language:${langName}`,
          `${missing} of ${families.length} question families lack a "${langName}" translation.`,
          "Add translations via Link Variant (Question Bank) or restrict printing to available languages."
        );
      } else {
        add(
          "INFO",
          "Paper",
          null,
          `language:${langName}`,
          `Required language "${langName}" fully covered (${families.length}/${families.length}).`,
          "No action needed."
        );
      }
    }
    if (required.length === 0 && languages.length > 1) {
      const singleLang = families.filter(
        (f) => (familyLanguages.get(f.family_id)?.size ?? 0) < 2
      ).length;
      if (singleLang > 0) {
        add(
          "INFO",
          "Paper",
          null,
          "language",
          `${singleLang} of ${families.length} question families have fewer translations than the ${languages.length} configured languages.`,
          "Add translations via Link Variant if this paper will be printed in multiple languages."
        );
      }
    }
  }

  const errors = results.filter((r) => r.level === "ERROR").length;
  const warnings = results.filter((r) => r.level === "WARNING").length;
  const infos = results.filter((r) => r.level === "INFO").length;
  return {
    results,
    summary: {
      errors,
      warnings,
      infos,
      canPublish: errors === 0,
      computedMarks,
      questionCount: families.length,
      migrationRequired: options.migrationRequired === true,
      migrationNote:
        options.migrationRequired === true
          ? "Migration 008 is not applied — section assignments and locked flags are not persisted yet, so section compliance runs on degraded data."
          : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Paper Sets & Randomization (Paper Generator Phase 7)
//
// A master paper generates multiple sets (A/B/C/D/custom) by reshuffling the
// SAME logical questions — never duplicating Question Bank records. Per set:
//   - question order is shuffled (section boundaries preserved)
//   - option order is shuffled for types where option order carries no
//     meaning (mcq_single/mcq_multi); true_false (A=True/B=False), match and
//     ordering (where order IS the question) are never permuted
// Every set stores its own seed + version, so any set can be regenerated
// bit-for-bit later. A per-set answer key is derived from the stored option
// permutation — the underlying question and its correct answer are untouched.
// ---------------------------------------------------------------------------

export const MAX_SETS = 26;
export const SET_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Question types whose options may be reordered without changing meaning. */
export const SHUFFLEABLE_OPTION_TYPES = new Set(["mcq_single", "mcq_multi"]);

const SETS_SCHEMA_VERSION = 1;

function setLabel(i) {
  return SET_LABELS[i] ?? `Set ${i + 1}`;
}

function effectiveMarksOf(ref) {
  if (Number(ref?.marks) > 0) return Number(ref.marks);
  return Number(ref?.primary?.marks) || 0;
}

/**
 * Build the sets document for a master paper.
 *
 * `familyRefs` is the paper's ordered family list (as returned by
 * getPaperById — { family_id, marks, section_key, primary }). Options:
 *   count            number of sets, 1..MAX_SETS (default 4 → A..D)
 *   labels           optional custom labels array (defaults A, B, C, …)
 *   shuffleQuestions reshuffle question order per set (default true)
 *   shuffleOptions   permute options where the type permits (default true)
 *   baseSeed         deterministic seed base (default `paper:<id>`)
 *   version          increments to deliberately re-randomize (default 1)
 *
 * Returns { doc, errors } — errors is non-empty when the master paper cannot
 * support sets (e.g. families without references); nothing is generated then.
 */
export function generateSetsDoc(paper, familyRefs, options = {}) {
  const errors = [];
  const rawCount = Number(options.count);
  const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 4;
  if (Number.isFinite(rawCount) && rawCount > 0 && count !== rawCount) {
    return { doc: null, errors: ["Number of sets must be a whole number."] };
  }
  if (options.count !== undefined && (!Number.isFinite(rawCount) || rawCount < 1 || rawCount > MAX_SETS)) {
    return { doc: null, errors: [`Number of sets must be between 1 and ${MAX_SETS}.`] };
  }

  const refs = (Array.isArray(familyRefs) ? familyRefs : [])
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  if (refs.length === 0) {
    return { doc: null, errors: ["The master paper has no questions. Generate or add questions before creating sets."] };
  }
  const familyless = refs.filter((r) => !r.family_id);
  if (familyless.length > 0) {
    errors.push(
      `${familyless.length} paper question(s) have no question-family reference and cannot be placed into sets.`
    );
  }
  const usable = refs.filter((r) => r.family_id);

  const labelsInput = Array.isArray(options.labels) ? options.labels.filter((l) => typeof l === "string" && l.trim()) : null;
  if (labelsInput && labelsInput.length !== count) {
    return { doc: null, errors: ["Custom labels count must match the number of sets."] };
  }

  const shuffleQuestions = options.shuffleQuestions !== false;
  const shuffleOptions = options.shuffleOptions !== false;
  const baseSeed =
    (typeof options.baseSeed === "string" && options.baseSeed.trim()) ||
    `paper:${paper?.id ?? "unknown"}`;
  const version = Math.max(1, Math.floor(Number(options.version) || 1));

  // Master sequence grouped by section (blueprint order = master order) so a
  // set never moves a question across section boundaries.
  const sectionOrder = [];
  const bySection = new Map();
  for (const ref of usable) {
    const key = ref.section_key ?? null;
    if (!bySection.has(key)) {
      bySection.set(key, []);
      sectionOrder.push(key);
    }
    bySection.get(key).push(ref);
  }

  const generatedAt = new Date().toISOString();
  const sets = [];
  for (let i = 0; i < count; i++) {
    const label = labelsInput ? labelsInput[i].trim() : setLabel(i);
    const seed = `${baseSeed}:set${label}:v${version}`;
    const rng = createRng(seed);

    // Question order: shuffle within each section, keep section order.
    const ordered = [];
    for (const key of sectionOrder) {
      const group = bySection.get(key) ?? [];
      ordered.push(...(shuffleQuestions ? seededShuffle(group, rng) : group));
    }

    const questions = ordered.map((ref, idx) => {
      const type = ref.primary?.type ?? null;
      const opts = Array.isArray(ref.primary?.options) ? ref.primary.options : [];
      const canShuffleOptions =
        shuffleOptions &&
        SHUFFLEABLE_OPTION_TYPES.has(type) &&
        opts.length >= 2;
      return {
        familyId: ref.family_id,
        number: idx + 1,
        marks: effectiveMarksOf(ref),
        sectionKey: ref.section_key ?? null,
        optionPermutation: canShuffleOptions
          ? seededShuffle(opts.map((_, j) => j), rng)
          : null,
      };
    });

    sets.push({
      key: label,
      name: `Set ${label}`,
      seed,
      version,
      generatedAt,
      questionCount: questions.length,
      totalMarks: questions.reduce((sum, q) => sum + q.marks, 0),
      questions,
    });
  }

  if (errors.length) errors.unshift("Master paper issues that limit set generation:");
  return {
    doc: {
      schemaVersion: SETS_SCHEMA_VERSION,
      baseSeed,
      version,
      shuffleQuestions,
      shuffleOptions,
      generatedAt,
      count: sets.length,
      sets,
    },
    errors,
  };
}

/**
 * Resolve the displayed options + correct answer for one set question from a
 * stored permutation. Pure: the underlying question/options are never read or
 * written — permutation maps display position -> original option index.
 */
export function resolveSetQuestionAnswer(variant, optionPermutation) {
  const type = variant?.type ?? null;
  const opts = Array.isArray(variant?.options) ? variant.options : [];
  const perm = Array.isArray(optionPermutation) ? optionPermutation : null;

  const letterAt = (originalIdx) => {
    const displayIdx = perm ? perm.indexOf(originalIdx) : originalIdx;
    return displayIdx >= 0 ? String.fromCharCode(65 + displayIdx) : null;
  };

  const displayOptions = opts.length
    ? (perm ?? opts.map((_, j) => j)).map((origIdx, displayIdx) => ({
        label: String.fromCharCode(65 + displayIdx),
        content: opts[origIdx]?.content ?? null,
        originalLabel: opts[origIdx]?.label ?? String.fromCharCode(65 + origIdx),
      }))
    : null;

  if (OPTION_TYPES.has(type)) {
    const correctOriginal = opts
      .map((o, j) => (o?.is_correct ? j : -1))
      .filter((j) => j >= 0);
    const fromPayload = Array.isArray(variant?.payload?.correctIndexes)
      ? variant.payload.correctIndexes
      : null;
    const indexes = correctOriginal.length > 0
      ? correctOriginal
      : (fromPayload ?? []).filter((j) => Number.isInteger(j) && j >= 0 && j < opts.length);
    const letters = indexes.map(letterAt).filter(Boolean);
    return {
      displayOptions,
      answer:
        type === "mcq_multi"
          ? letters.sort().join(", ")
          : letters[0] ?? null,
    };
  }

  // Non-option types: answer lives in the question payload (never permuted).
  const payload = variant?.payload ?? null;
  const answer =
    payload?.answer ??
    (Array.isArray(payload?.answers) ? payload.answers.join(", ") : payload?.answers) ??
    payload?.correct ??
    null;
  return { displayOptions, answer };
}

/**
 * Independent answer key for one stored set. `loadVariants(familyId)` must
 * return the family's variants (existing listQuestionVariants). The key is
 * computed from the set's STORED option permutation, so it always matches the
 * printed set — and recomputing with the same seed/version reproduces it.
 */
/**
 * Normalize a variant loader into a batched one. Accepts either the classic
 * per-family loader `(familyId) => variants[]` or a batch loader
 * `(familyIds[]) => Map<familyId, variants[]>`. Callers can pass the batched
 * listQuestionVariantsByFamilies so answer keys need 3 queries total instead
 * of 2 per question (N+1).
 */
function toBatchLoader(loadVariants) {
  return async (familyIds) => {
    const ids = familyIds.filter(Boolean);
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    // Prefer a batch-capable loader (returns a Map). If the loader is the
    // classic per-family kind it will reject the array — fall back to per-id
    // calls so existing callers stay backward compatible.
    try {
      const res = await loadVariants(unique);
      if (res instanceof Map) return res;
    } catch {
      /* classic loader — fall through */
    }
    const map = new Map(unique.map((id) => [id, []]));
    const results = await Promise.all(unique.map((id) => loadVariants(id).catch(() => [])));
    for (let i = 0; i < unique.length; i++) map.set(unique[i], results[i] ?? []);
    return map;
  };
}

export async function computeSetAnswerKey(setsDoc, setKey, loadVariants) {
  const set = (setsDoc?.sets ?? []).find((s) => s.key === setKey);
  if (!set) return null;

  // Performance: prefetch every family's variants in one batched call when the
  // loader supports it, instead of one options+payload pair per question.
  const batchLoad = toBatchLoader(loadVariants);
  const variantsByFamily = await batchLoad(set.questions.map((q) => q.familyId));

  const answers = [];
  const warnings = [];
  for (const q of set.questions) {
    let variants = [];
    try {
      variants = variantsByFamily.get(q.familyId) ?? [];
    } catch {
      variants = [];
    }
    const variant = variants.find((v) => v.language_id) || variants[0] || null;
    if (!variant) {
      warnings.push(`Q${q.number}: no question variant found for family ${String(q.familyId).slice(0, 8)}…`);
      answers.push({ number: q.number, familyId: q.familyId, questionId: null, type: null, marks: q.marks, answer: null, displayOptions: null });
      continue;
    }
    const { displayOptions, answer } = resolveSetQuestionAnswer(variant, q.optionPermutation);
    if (answer === null || answer === undefined) {
      warnings.push(`Q${q.number}: question has no resolvable correct answer in its data.`);
    }
    answers.push({
      number: q.number,
      familyId: q.familyId,
      questionId: variant.id,
      type: variant.type,
      marks: q.marks,
      answer: answer ?? null,
      displayOptions,
    });
  }

  return {
    setKey: set.key,
    setName: set.name,
    seed: set.seed,
    version: set.version,
    generatedAt: set.generatedAt,
    questionCount: answers.length,
    totalMarks: answers.reduce((sum, a) => sum + a.marks, 0),
    answers,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Translation workflow & language-aware readiness (Paper Generator Phase 8)
// ---------------------------------------------------------------------------

export const TRANSLATION_STATES = ["missing", "draft", "translated", "reviewed", "approved"];

// Numeric/format tokens that must survive translation unchanged: numbers,
// variables, units, currency and scientific notation.
const INVARIANT_NUMBER_RE = /-?\d+(?:\.\d+)?/g;
const INVARIANT_UNIT_RE = /\b(?:kg|km|cm|mm|mL|L|mol|J|N|Hz|Pa|K|°C|°F|km\/h|m\/s|%|Rs\.?|₹|USD|\$)\b/;

function extractNumbers(doc) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string") out.push(...(node.text.match(INVARIANT_NUMBER_RE) ?? []));
    const attrs = node.attrs ?? {};
    if (typeof attrs.src === "string" && attrs.src) out.push(`img:${attrs.src}`);
    const children = Array.isArray(node.content) ? node.content : [];
    for (const child of children) walk(child);
  };
  walk(doc);
  return out;
}

/**
 * Invariant integrity between a translated variant and its base variant.
 * Translation may change any text; it must NOT change numbers, units or
 * media (formulas, variables, diagrams, scientific/chemical notation are
 * stored inside the same content nodes, so numeric/media equality guards
 * them). Pure — never mutates or corrects anything, only reports.
 */
export function checkInvariants(baseVariant, translatedVariant) {
  if (!baseVariant || !translatedVariant) return [];
  const issues = [];
  const baseNums = extractNumbers(baseVariant.content).filter((t) => !t.startsWith("img:"));
  const transNums = extractNumbers(translatedVariant.content).filter((t) => !t.startsWith("img:"));
  const baseImgs = extractNumbers(baseVariant.content).filter((t) => t.startsWith("img:"));
  const transImgs = extractNumbers(translatedVariant.content).filter((t) => t.startsWith("img:"));

  const sameCounts = (a, b) => {
    if (a.length !== b.length) return false;
    const bs = [...b];
    for (const v of a) {
      const i = bs.indexOf(v);
      if (i === -1) return false;
      bs.splice(i, 1);
    }
    return true;
  };

  if (!sameCounts(baseNums, transNums)) {
    issues.push({
      field: "content.numbers",
      problem: `Numeric values differ between the base language and the translation (base: ${baseNums.join(", ") || "none"}; translation: ${transNums.join(", ") || "none"}).`,
      action: "Restore the original numbers, variables, units or scientific notation in the translation.",
    });
  }
  const baseUnitHit = baseNums.length === 0 && INVARIANT_UNIT_RE.test(baseVariant.content ? JSON.stringify(baseVariant.content) : "");
  if (baseUnitHit) {
    issues.push({
      field: "content.units",
      problem: "The base question contains unit tokens that should be verified in the translation.",
      action: "Confirm units (kg, km, %, ₹, …) are unchanged in the translated text.",
    });
  }
  if (!sameCounts(baseImgs, transImgs)) {
    issues.push({
      field: "content.media",
      problem: "Diagrams/media referenced by the base question are missing or changed in the translation.",
      action: "Re-attach the same diagrams/images to the translated variant.",
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Separate Language Paper Generation (Paper Generator Phase 9)
//
// A language paper is a CONCRETE, derived artifact of one master paper. It
// records the exact representation generated for a language: family ordering,
// sections, marks, resolved question variants and invariant integrity. It
// NEVER re-selects questions — the master paper's question families are the
// only source of logical questions, and each family resolves to the requested
// language's variant (never an invented or renamed question).
// ---------------------------------------------------------------------------

export const LANGUAGE_PAPER_STATES = ["draft", "generated", "approved", "archived"];
const LANGUAGE_PAPER_SCHEMA_VERSION = 1;

/** Stable JSON stringify (sorted keys) so equal payloads hash equal. */
function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
}

/**
 * Deterministic invariant fingerprint of a resolved question variant. Covers
 * the question text, options, payload and media references — so a change in
 * numbers/formulas/diagrams between generation and rendering is detectable.
 */
export function contentHashOf(variant) {
  if (!variant) return null;
  return String(hashSeed(stableJson({
    content: variant.content ?? null,
    options: Array.isArray(variant.options)
      ? variant.options.map((o) => ({ label: o.label, content: o.content, is_correct: o.is_correct }))
      : [],
    payload: variant.payload ?? null,
    image_url: variant.image_url ?? null,
  }))).padStart(10, "0");
}

/**
 * Resolve one family to the requested language's variant.
 * Priority: exact-language variant by workflow state (approved > reviewed >
 * translated > draft, then newest); otherwise substitution (best variant) or
 * none. Mirrors getPaperInLanguageStrict so language papers agree with the
 * interactive language preview.
 */
function resolveFamilyVariant(family, languageId) {
  const variants = Array.isArray(family.variants) ? family.variants : [];
  const order = { approved: 0, reviewed: 1, translated: 2, draft: 3 };
  const stateOf = (v) => v?.translation_status ?? "draft";
  const sortPreferred = (a, b) =>
    (order[stateOf(a)] ?? 3) - (order[stateOf(b)] ?? 3) ||
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  const exact = variants.filter((v) => v.language_id === languageId);
  if (exact.length > 0) return { variant: [...exact].sort(sortPreferred)[0], substituted: false };
  if (variants.length > 0) return { variant: [...variants].sort(sortPreferred)[0], substituted: true };
  return { variant: null, substituted: false };
}

/**
 * Build the versioned snapshot document for a generated language paper.
 *
 * @param {object} paper      master paper row (at minimum id, title, duration_min, total_marks)
 * @param {Array}  familyRefs master families, as returned by getPaperById
 * @param {string} languageId requested language (papers.language_id)
 * @param {object} [blueprint] master blueprint (for per-section negative marks)
 * @param {object} [options]
 * @param {string|null} [options.setKey] source randomization set — when given,
 *   question order comes from that set's stored permutation (never re-shuffled);
 *   otherwise the master paper order is preserved exactly.
 * @param {Array<string>} [options.orderFamilyIds] family ids in the set's display order
 * @param {"strict"|"substitute"} [options.mode] strict refuses to generate when a
 *   family has no variant in the requested language (translation missing);
 *   substitute generates best-available and flags each substituted question.
 *
 * Pure: never mutates question content, never persists anything. Returns
 * { snapshot, errors, warnings } so the caller can refuse incomplete writes.
 */
export function buildLanguagePaperSnapshot(paper, familyRefs, languageId, blueprint, options = {}) {
  const errors = [];
  const warnings = [];
  const refs = (Array.isArray(familyRefs) ? familyRefs : [])
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  const familyless = refs.filter((r) => !r.family_id);
  if (familyless.length > 0) {
    errors.push(
      `${familyless.length} paper question(s) have no question-family reference and cannot be included in a language paper.`
    );
  }
  const usable = refs.filter((r) => r.family_id);
  if (usable.length === 0) {
    return { snapshot: null, errors: ["The master paper has no questions to render in this language."], warnings };
  }

  const mode = options.mode === "strict" ? "strict" : "substitute";

  // Explicit randomization only ever RE-ORDERS the same families; it never
  // changes the question set. When a set key is given, honor its stored
  // family order; otherwise preserve the master paper order exactly.
  const explicitOrder = Array.isArray(options.orderFamilyIds)
    ? options.orderFamilyIds.filter(Boolean)
    : null;
  let ordered = usable;
  if (options.setKey && explicitOrder && explicitOrder.length === usable.length) {
    const byFamily = new Map(usable.map((r) => [r.family_id, r]));
    const orderedList = explicitOrder.map((fid) => byFamily.get(fid)).filter(Boolean);
    if (orderedList.length === usable.length) ordered = orderedList;
    else warnings.push("Stored randomization set does not match the master paper's families — using master order.");
  } else if (options.setKey) {
    warnings.push("No matching randomization set found — using master paper (unrandomized) order.");
  }

  // Per-section metadata from the blueprint (name, negative marks).
  const bpSections = Array.isArray(blueprint?.sections) ? blueprint.sections : [];
  const sectionMeta = new Map();
  for (const s of bpSections) {
    sectionMeta.set(s.id, { name: s.name || s.id, negativeMarks: Number(s.negativeMarks) || 0 });
  }

  const categories = [];
  const bySection = new Map();
  for (const ref of ordered) {
    const key = ref.section_key ?? "__default__";
    if (!bySection.has(key)) {
      bySection.set(key, { key, name: key === "__default__" ? "Questions" : sectionMeta.get(key)?.name || key, negativeMarks: sectionMeta.get(key)?.negativeMarks ?? 0 });
      categories.push(key);
    }
    bySection.get(key).families = bySection.get(key).families || [];
    bySection.get(key).families.push(ref);
  }
  const sectionByName = new Map(categories.map((k) => [k, bySection.get(k)]));
  const snapSections = [...categories].map((k) => {
    const s = sectionByName.get(k);
    return { key: s.key, name: s.name, negativeMarks: s.negativeMarks, questionCount: s.families.length };
  });

  const questions = [];
  let number = 0;
  let substitutedCount = 0;
  let missingCount = 0;
  let totalMarks = 0;
  for (const ref of ordered) {
    number += 1;
    const { variant, substituted } = resolveFamilyVariant(ref, languageId);
    const marks = Number(ref.marks) > 0 ? Number(ref.marks) : Number(ref.primary?.marks) || 0;
    totalMarks += marks;

    if (!variant) {
      missingCount += 1;
      questions.push({
        family_id: ref.family_id,
        number,
        sort_order: Number(ref.sort_order) || 0,
        marks,
        section_key: ref.section_key ?? null,
        resolved_variant_id: null,
        resolved_language_id: languageId,
        substituted: false,
        invariant_issues: [],
        content_hash: null,
        translation_status: "missing",
      });
      continue;
    }

    if (substituted) substitutedCount += 1;

    // Base variant = a DIFFERENT-language variant (or the only variant) — used
    // to verify that numbers/formulas/units/diagrams survived translation.
    const base =
      variantsOf(ref).find((v) => v.language_id && v.language_id !== variant.language_id) ||
      variantsOf(ref)[0] ||
      null;

    questions.push({
      family_id: ref.family_id,
      number,
      sort_order: Number(ref.sort_order) || 0,
      marks,
      section_key: ref.section_key ?? null,
      resolved_variant_id: variant.id,
      resolved_language_id: variant.language_id,
      substituted,
      invariant_issues: checkInvariants(base, variant),
      content_hash: contentHashOf(variant),
      translation_status: variant.translation_status ?? "draft",
    });
  }

  if (missingCount > 0) {
    errors.push(
      `${missingCount} question family(ies) have no variant in the requested language.`
    );
  }

  const snapshot = {
    schemaVersion: LANGUAGE_PAPER_SCHEMA_VERSION,
    language_id: languageId,
    master_paper_id: paper.id,
    set_key: options.setKey ?? null,
    ordered_by: options.setKey ? `set:${options.setKey}` : "master",
    generated_at: new Date().toISOString(),
    complete: missingCount === 0 && substitutedCount === 0,
    missing_count: missingCount,
    substituted_count: substitutedCount,
    question_count: questions.length,
    total_marks: totalMarks,
    sections: snapSections,
    questions,
  };

  if (errors.length) errors.unshift("Language paper generation issues:");
  return {
    snapshot,
    errors: mode === "strict" && missingCount > 0
      ? errors
      : mode === "strict"
        ? errors
        : errors.filter((e) => !/have no variant in the requested language/.test(e)),
    warnings,
  };
}

function variantsOf(ref) {
  return Array.isArray(ref.variants) ? ref.variants : [];
}

/**
 * Language-aware set answer keys. Re-derives each answer from the requested
 * language's variant (falling back exactly as getPaperInLanguageStrict does)
 * while keeping the set's stored option permutation. Reports substituted and
 * missing entries so callers can block printing keys in missing languages.
 */
export async function computeSetAnswerKeyInLanguage(setsDoc, setKey, languageId, loadVariants) {
  const set = (setsDoc?.sets ?? []).find((s) => s.key === setKey);
  if (!set) return null;

  // Same batched prefetch as computeSetAnswerKey (translation lookup perf).
  const batchLoad = toBatchLoader(loadVariants);
  const variantsByFamily = await batchLoad(set.questions.map((q) => q.familyId));

  const answers = [];
  const warnings = [];
  let substituted = 0;
  let missing = 0;

  for (const q of set.questions) {
    let variants = [];
    try {
      variants = variantsByFamily.get(q.familyId) ?? [];
    } catch {
      variants = [];
    }
    const exact = variants.filter((v) => v.language_id === languageId);
    let variant = exact[0] ?? null;
    if (!variant && variants.length > 0) {
      variant = variants.find((v) => v.translation_status === "approved") ?? variants[0];
      substituted += 1;
      warnings.push(
        `Q${q.number}: no variant in the requested language — answer shown from the question's base language.`
      );
    }
    if (!variant) {
      missing += 1;
      warnings.push(`Q${q.number}: no question variant found for family ${String(q.familyId).slice(0, 8)}…`);
      answers.push({
        number: q.number,
        familyId: q.familyId,
        questionId: null,
        type: null,
        marks: q.marks,
        answer: null,
        displayOptions: null,
        languageId: null,
      });
      continue;
    }
    const { displayOptions, answer } = resolveSetQuestionAnswer(variant, q.optionPermutation);
    if (answer === null || answer === undefined) {
      warnings.push(`Q${q.number}: question has no resolvable correct answer in its data.`);
    }
    answers.push({
      number: q.number,
      familyId: q.familyId,
      questionId: variant.id,
      type: variant.type,
      marks: q.marks,
      answer: answer ?? null,
      displayOptions,
      languageId: variant.language_id ?? null,
    });
  }

  return {
    setKey: set.key,
    setName: set.name,
    seed: set.seed,
    version: set.version,
    requested_language_id: languageId,
    questionCount: answers.length,
    totalMarks: answers.reduce((sum, a) => sum + a.marks, 0),
    complete: missing === 0 && substituted === 0,
    substituted,
    missing,
    answers,
    warnings,
  };
}
export function computeTranslationReport(familyRefs, languages, paperTranslations = null) {
  const langList = Array.isArray(languages) ? languages : [];
  const refs = (Array.isArray(familyRefs) ? familyRefs : [])
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  const docLanguages = paperTranslations?.languages ?? {};
  const stateRank = (s) => TRANSLATION_STATES.indexOf(s ?? "draft");

  const perLanguage = langList.map((lang) => {
    const prepared = docLanguages[lang.id] ?? null;
    const questions = refs.map((ref, idx) => {
      const variants = Array.isArray(ref.variants) ? ref.variants : [];
      const base =
        variants.find((v) => v.language_id && v.language_id !== lang.id) || variants[0] || null;
      const exact = variants.filter((v) => v.language_id === lang.id);
      const best = exact.length
        ? [...exact].sort((a, b) => stateRank(a) - stateRank(b)).pop()
        : null;

      return {
        number: idx + 1,
        familyId: ref.family_id,
        questionId: best?.id ?? null,
        state: best ? best.translation_status ?? "draft" : "missing",
        invariantIssues: best ? checkInvariants(base, best) : [],
      };
    });

    const counts = { missing: 0, draft: 0, translated: 0, reviewed: 0, approved: 0 };
    for (const q of questions) counts[q.state] += 1;
    const worst = questions.reduce(
      (acc, q) => Math.min(acc, Math.max(stateRank(q.state), 0)),
      TRANSLATION_STATES.length - 1
    );

    const invariantCount = questions.reduce((sum, q) => sum + q.invariantIssues.length, 0);

    return {
      language: { id: lang.id, code: lang.code ?? null, name: lang.name },
      paperState: prepared?.state ?? (counts.missing === refs.length && refs.length > 0 ? "missing" : "draft"),
      note: prepared?.note ?? null,
      sectionInstructions: prepared?.sections ?? {},
      counts,
      coverage: refs.length > 0 ? Math.round(((refs.length - counts.missing) / refs.length) * 100) : 100,
      ready: counts.missing === 0 && counts.approved === refs.length && invariantCount === 0,
      worstState: TRANSLATION_STATES[Math.max(worst, 0)],
      invariantIssues: invariantCount,
      questions,
    };
  });

  return {
    languages: perLanguage,
    totals: {
      languages: langList.length,
      questions: refs.length,
      fullyApprovedLanguages: perLanguage.filter((l) => l.ready).length,
      invariantIssues: perLanguage.reduce((sum, l) => sum + l.invariantIssues, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Answer Key & Solution Engine (Paper Generator Phase 13)
// ---------------------------------------------------------------------------
// Answer keys / solutions are derived from the paper's ACTUAL final structure
// on every request — they never read from an old snapshot that could drift
// when questions are replaced, deleted, reordered or their options edited.
//
//   * Master paper (setKey = null): families in master paper order; numbering
//     matches the print pipeline (1..N, section order preserved).
//   * Any generated set (A–D/custom): the set's STORED question order, but only
//     while it still matches the current families; otherwise the master order
//     with a warning so numbering is always correct.
//   * Option randomization from a set is honored ONLY while the stored
//     permutation still fits the resolved variant's CURRENT options; otherwise
//     it is dropped (current option order shown) and flagged. This guards the
//     answer mapping against option edits and question replacement.
//   * Answers/solutions come exclusively from the Question Bank's own
//     correct-answer and explanation data. Nothing is invented or overwritten;
//     missing answers/solutions are reported, never synthesized.

/** True when `perm` is a full permutation of indexes 0..optionCount-1. */
function isValidOptionPermutation(optionPermutation, optionCount) {
  if (!Array.isArray(optionPermutation) || optionCount === 0) return false;
  if (optionPermutation.length !== optionCount) return false;
  if (optionPermutation.some((x) => !Number.isInteger(x) || x < 0 || x >= optionCount)) return false;
  return new Set(optionPermutation).size === optionCount;
}

/**
 * Resolve one variant's displayed options + correct answer under a stored
 * option permutation. The permutation is applied only when it exactly fits the
 * variant's CURRENT options (drop + flag otherwise) — never invents data.
 */
export function resolvePaperQuestionAnswer(variant, optionPermutation) {
  const opts = Array.isArray(variant?.options) ? variant.options : [];
  const wasProvided = optionPermutation !== null && optionPermutation !== undefined;
  const safePermutation = isValidOptionPermutation(optionPermutation, opts.length) ? optionPermutation : null;
  const { displayOptions, answer } = resolveSetQuestionAnswer(variant, safePermutation);
  return {
    answer: answer ?? null,
    displayOptions,
    permutationApplied: safePermutation !== null,
    permutationDrift: wasProvided && safePermutation === null,
  };
}

/**
 * Decide the order + option permutations a report must use so that numbering
 * and answers always match the paper. Pure. Returns the ordered family refs
 * (families without a question reference are excluded and reported), the
 * applied order ("master" | "set"), a per-family option permutation map, and
 * warnings describing any fallback that was needed.
 */
export function listPaperReportQuestions(familyRefs, setsDoc, setKey) {
  const warnings = [];
  const refs = (Array.isArray(familyRefs) ? familyRefs : [])
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  const familyless = refs.filter((r) => !r.family_id);
  if (familyless.length > 0) {
    warnings.push(
      `${familyless.length} paper question(s) have no question-family reference and are excluded from the report.`
    );
  }
  const usable = refs.filter((r) => r.family_id);
  let ordered = usable;
  let appliedOrder = "master";
  const permutations = new Map();

  const set = setKey ? (setsDoc?.sets ?? []).find((s) => s.key === setKey) ?? null : null;
  if (setKey && !set) {
    warnings.push(`Set "${setKey}" was not found — the report uses the master paper order.`);
  } else if (set) {
    const byFamily = new Map(usable.map((r) => [r.family_id, r]));
    // The stored randomization is honored only while the set references
    // EXACTLY the paper's current families (same multiset); a reference to a
    // family the paper no longer has invalidates the whole ordering.
    const usableIds = usable.map((r) => r.family_id).slice().sort();
    const setIds = set.questions.map((q) => q.familyId).filter(Boolean).slice().sort();
    const exactMatch =
      usableIds.length > 0 &&
      usableIds.length === setIds.length &&
      usableIds.every((id, i) => id === setIds[i]);
    if (exactMatch) {
      const orderedList = set.questions.map((q) => byFamily.get(q.familyId)).filter(Boolean);
      ordered = orderedList;
      appliedOrder = "set";
      for (const q of set.questions) permutations.set(q.familyId, q.optionPermutation ?? null);
    } else {
      warnings.push(
        "The stored randomization no longer matches the paper's current question families (questions were added, replaced or deleted), so answers are shown in the master paper order and stored option permutations are ignored."
      );
    }
  }
  return { ordered, appliedOrder, permutations, warnings };
}

/**
 * Build the answer-key / solutions report for a paper from its actual final
 * structure. Answers + solutions are re-derived from the Question Bank each
 * call; missing or substituted content is flagged so it can never be silently
 * passed off as correct.
 *
 * @param {object} input
 * @param {object} input.paper master paper row (id/title at minimum)
 * @param {Array}  input.familyRefs families as returned by getPaperById
 * @param {object|null} input.blueprint stored blueprint (section names/marks)
 * @param {object|null} input.setsDoc stored sets document
 * @param {string|null} [input.setKey] requested set; null = master paper
 * @param {string|null} [input.languageId] resolve from that language's variants
 * @param {boolean}      [input.includeContent] include question text, options
 *                        and explanations (solutions); false = compact key
 */
export function buildPaperReport({
  paper,
  familyRefs,
  blueprint,
  setsDoc,
  setKey = null,
  languageId = null,
  includeContent = false,
}) {
  const warnings = [];
  const { ordered, appliedOrder, permutations, warnings: orderWarnings } = listPaperReportQuestions(familyRefs, setsDoc, setKey);
  warnings.push(...orderWarnings);

  const bpSections = Array.isArray(blueprint?.sections) ? blueprint.sections : [];
  const sectionMeta = new Map(
    bpSections.map((s) => [s.id, { name: s.name || s.id, negativeMarks: Number(s.negativeMarks) || 0 }])
  );

  const sections = [];
  const bySection = new Map();
  let questionCount = 0;
  let answered = 0;
  let missingAnswer = 0;
  let missingExplanation = 0;
  let substituted = 0;
  let totalMarks = 0;

  for (const ref of ordered) {
    const number = questionCount + 1;
    questionCount += 1;
    const marks = Number(ref.marks) > 0 ? Number(ref.marks) : Number(ref.primary?.marks) || 0;
    totalMarks += marks;
    const sectionKey = ref.section_key ?? "__default__";

    const { variant, substituted: sub } = languageId
      ? resolveFamilyVariant(ref, languageId)
      : { variant: variantsOf(ref).find((v) => v.language_id) || variantsOf(ref)[0] || null, substituted: false };
    if (sub) substituted += 1;

    const questionMissing = !variant;
    let answer = null;
    let answerMissing = true;
    let permutationApplied = false;
    let permutationDrift = false;
    let displayOptions = null;
    let explanation = null;
    let explanationMissing = false;
    let explanationPresent = false;

    if (variant) {
      const resolved = resolvePaperQuestionAnswer(variant, permutations.get(ref.family_id) ?? null);
      answer = resolved.answer;
      displayOptions = resolved.displayOptions;
      permutationApplied = resolved.permutationApplied;
      permutationDrift = resolved.permutationDrift;
      answerMissing = resolved.answer === null;
      explanation = variant.explanation ?? null;
      explanationMissing = explanation === null || explanation === undefined || (typeof explanation === "string" && !String(explanation).trim());
      if (permutationDrift) {
        warnings.push(`Q${number}: stored option order no longer matches the resolved options (options were edited or the question replaced) — shown in the current option order.`);
      }
      if (answerMissing) {
        warnings.push(`Q${number}: the question's data has no correct answer to report.`);
      }
      // Only a solutions report includes explanations — missing ones are
      // reported there, never silently omitted from a solutions export.
      if (includeContent && explanationMissing) {
        warnings.push(`Q${number}: no solution is available for this question.`);
      }
    } else {
      warnings.push(`Q${number}: no question variant found for family ${String(ref.family_id).slice(0, 8)}…`);
    }

    if (!bySection.has(sectionKey)) {
      bySection.set(sectionKey, {
        key: sectionKey,
        name: sectionKey === "__default__" ? "Questions" : sectionMeta.get(sectionKey)?.name || sectionKey,
        negativeMarks: sectionMeta.get(sectionKey)?.negativeMarks ?? 0,
        entries: [],
      });
      sections.push(sectionKey);
    }

    explanationPresent = !questionMissing && !explanationMissing;

    const entry = {
      number,
      familyId: ref.family_id,
      questionId: variant?.id ?? null,
      type: variant?.type ?? null,
      marks,
      answer,
      answerMissing,
      substituted: !!sub,
      languageId: variant?.language_id ?? null,
      permutationApplied,
      permutationDrift,
      questionMissing,
      explanationPresent,
    };
    if (includeContent) {
      entry.question = variant ? variant.content ?? null : null;
      entry.options = displayOptions;
      entry.explanation = questionMissing ? null : explanation;
      entry.explanationMissing = explanationMissing;
    }
    bySection.get(sectionKey).entries.push(entry);

    if (answerMissing) missingAnswer += 1;
    else answered += 1;
    if (!questionMissing && explanationMissing) missingExplanation += 1;
    if (questionMissing) missingExplanation += 1;
  }

  return {
    paperId: paper?.id ?? null,
    scope: appliedOrder,
    setKey: setKey ?? null,
    requestedLanguage: languageId,
    sections: sections.map((k) => bySection.get(k)),
    summary: {
      appliedOrder,
      questionCount,
      totalMarks,
      answered,
      missingAnswer,
      missingExplanation,
      substituted,
      complete:
        missingAnswer === 0 &&
        substituted === 0 &&
        (!includeContent || missingExplanation === 0),
      warnings,
    },
  };
}

// ---------------------------------------------------------------------------
// Paper Analysis & Quality Report (Paper Generator Phase 14)
// ---------------------------------------------------------------------------
// Composition + blueprint-variance report for one paper. Pure: duplicate
// detection, distributions and blueprint comparison are computed from the
// paper's own families/variants and the stored blueprint — no question content
// is modified. Master data (chapters/topics/levels/languages) is passed in via
// `meta` so this function stays unit-testable without a database.

const ANALYSIS_TYPE_LABELS = {
  mcq_single: "MCQ Single",
  mcq_multi: "MCQ Multi",
  true_false: "True/False",
  match: "Matching",
  fill_blank: "Fill in the Blank",
  sq: "Short Answer",
  short: "Short Answer",
  long: "Long Answer",
  essay: "Essay",
  number: "Numerical",
  image_based: "Image Based",
  other: "Other",
};

const ANALYSIS_DIFFICULTY_LABELS = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  advanced: "Advanced",
};

function prettyTypeLabel(type) {
  if (!type) return "Unspecified";
  if (ANALYSIS_TYPE_LABELS[type]) return ANALYSIS_TYPE_LABELS[type];
  return type
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function prettyDifficultyLabel(difficulty) {
  if (!difficulty || !String(difficulty).trim()) return "Unknown";
  const key = String(difficulty);
  if (ANALYSIS_DIFFICULTY_LABELS[key]) return ANALYSIS_DIFFICULTY_LABELS[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Pretty human label for a blueprint rule from its filters. */
export function describeBlueprintRule(rule, chapterNames = new Map(), topicNames = new Map()) {
  const parts = [];
  if (rule.scope === "chapter" && rule.chapterId) parts.push(`Chapter: ${chapterNames.get(rule.chapterId) ?? String(rule.chapterId).slice(0, 8)}`);
  else if (rule.scope === "topic" && rule.topicId) parts.push(`Topic: ${topicNames.get(rule.topicId) ?? String(rule.topicId).slice(0, 8)}`);
  if (rule.type) parts.push(prettyTypeLabel(rule.type));
  if (rule.difficulty) parts.push(prettyDifficultyLabel(rule.difficulty));
  if (rule.chapterId && rule.scope === "paper" && !rule.topicId) parts.push(`Chapter: ${chapterNames.get(rule.chapterId) ?? String(rule.chapterId).slice(0, 8)}`);
  if (rule.topicId && rule.scope === "paper" && !rule.chapterId) parts.push(`Topic: ${topicNames.get(rule.topicId) ?? String(rule.topicId).slice(0, 8)}`);
  return parts.length ? parts.join(" · ") : "All questions";
}

/**
 * Build the analysis/quality report for a paper.
 *
 * @param {object} paper master paper row
 * @param {Array}  familyRefs families from getPaperById
 * @param {object|null} blueprint stored blueprint
 * @param {object} [meta]
 * @param {Array}  [meta.chapters]   chapter master rows
 * @param {Array}  [meta.topics]     topic master rows
 * @param {Array}  [meta.levels]     question_levels master rows
 * @param {Array}  [meta.languages]  language master rows
 */
export function buildPaperAnalysis(paper, familyRefs, blueprint, meta = {}) {
  const chapterNames = new Map((meta.chapters ?? []).map((c) => [c.id, c.name]));
  const topicNames = new Map((meta.topics ?? []).map((t) => [t.id, t.name]));
  const allLanguages = Array.isArray(meta.languages) ? meta.languages : [];

  const refs = (Array.isArray(familyRefs) ? familyRefs : [])
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  const usable = refs.filter((r) => r.family_id);
  const marksOf = (f) => (Number(f.marks) > 0 ? Number(f.marks) : Number(f.primary?.marks) || 0);

  const bpSections = Array.isArray(blueprint?.sections) ? blueprint.sections : [];
  const bpRules = Array.isArray(blueprint?.rules) ? blueprint.rules : [];
  const sectionMeta = new Map(bpSections.map((s) => [s.id, s]));
  const sectionNameOf = (key) => sectionMeta.get(key)?.name || (key === "__default__" ? "Questions" : key ?? "Unassigned");

  // Raw accumulation per family.
  const bySection = new Map();
  const byType = new Map();
  const byDifficulty = new Map();
  const byChapter = new Map();
  const byTopic = new Map();
  const byFamily = new Map();
  const byContentHash = new Map();
  const familyLanguages = new Map();

  let totalMarks = 0;
  for (const f of usable) {
    const v = f.primary ?? null;
    const marks = marksOf(f);
    totalMarks += marks;
    const secKey = f.section_key ?? "__default__";

    const bump = (map, key, label) => {
      const bucket = map.get(key) ?? { key, label, count: 0, marks: 0 };
      bucket.count += 1;
      bucket.marks += marks;
      map.set(key, bucket);
    };
    bump(bySection, secKey, sectionNameOf(secKey));
    bump(byType, v?.type ?? "__none__", prettyTypeLabel(v?.type ?? null));
    bump(byDifficulty, v?.difficulty ? String(v.difficulty) : "__unknown__", prettyDifficultyLabel(v?.difficulty ?? null));
    bump(byChapter, v?.chapter_id ?? "__unassigned__", v?.chapter_id ? chapterNames.get(v.chapter_id) ?? String(v.chapter_id) : "Unassigned");
    bump(byTopic, v?.topic_id ?? "__unassigned__", v?.topic_id ? topicNames.get(v.topic_id) ?? String(v.topic_id) : "Unassigned");

    byFamily.set(f.family_id, (byFamily.get(f.family_id) ?? []).concat(f));
    const languages = new Set();
    for (const vv of f.variants ?? []) if (vv.language_id) languages.add(vv.language_id);
    familyLanguages.set(f.family_id, languages);

    if (v) {
      const hash = contentHashOf(v);
      if (hash) {
        const group = byContentHash.get(hash) ?? new Map();
        group.set(f.family_id, true);
        byContentHash.set(hash, group);
      }
    }
  }

  const sortBuckets = (map, byMarks = false) =>
    [...map.values()].sort(
      byMarks
        ? (a, b) => b.marks - a.marks || b.count - a.count
        : (a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label))
    );

  const sections = sortBuckets(bySection, true).map((s) => ({
    key: s.key,
    name: s.name,
    negativeMarks: Number(sectionMeta.get(s.key)?.negativeMarks) || 0,
    count: s.count,
    marks: s.marks,
  }));

  // Language coverage (all registered languages vs families actually covered).
  const languageCoverage = allLanguages.map((lang) => {
    let covered = 0;
    for (const [familyId, langs] of familyLanguages) {
      if (langs.has(lang.id)) covered += 1;
    }
    const usableCount = usable.length;
    return {
      id: lang.id,
      code: lang.code ?? null,
      name: lang.name,
      covered,
      missing: usableCount - covered,
      coverage: usableCount > 0 ? Math.round((covered / usableCount) * 100) : 100,
    };
  });

  // Duplicates: same family referenced more than once + possible same-content families.
  const familyDuplicates = [];
  for (const [familyId, entries] of byFamily) {
    if (entries.length > 1) {
      familyDuplicates.push({
        familyId,
        count: entries.length,
        sections: [...new Set(entries.map((e) => sectionNameOf(e.section_key ?? "__default__")))],
      });
    }
  }
  const contentDuplicates = [];
  for (const group of byContentHash.values()) {
    if (group.size > 1) {
      contentDuplicates.push({ count: group.size, familyIds: [...group.keys()] });
    }
  }

  // Blueprint variance.
  let blueprintVariance = null;
  if (bpSections.length > 0) {
    const warnings = [];
    const sectionTargets = new Map();
    let targetMarksSum = 0;
    let targetQuestionsSum = 0;
    for (const s of bpSections) {
      const ruleCount = bpRules.filter((r) => r.sectionId === s.id).reduce((sum, r) => sum + r.count, 0);
      const targetCount = Number(s.questionCount) > 0 ? Number(s.questionCount) : ruleCount;
      const targetMarks = targetCount * (Number(s.marksPerQuestion) || 0);
      targetMarksSum += targetMarks;
      targetQuestionsSum += targetCount;
      sectionTargets.set(s.id, { name: s.name || s.id, targetCount, targetMarks });
    }
    const actualBySection = new Map(sections.map((s) => [s.key, s]));
    const actualOnlyCount = sections.filter((s) => !sectionTargets.has(s.key)).reduce((n, s) => n + s.count, 0);
    if (actualOnlyCount > 0) {
      const names = sections.filter((s) => !sectionTargets.has(s.key)).map((s) => s.name).join(", ");
      warnings.push(`${actualOnlyCount} question(s) are in sections not covered by the blueprint (${names}).`);
    }
    const ruleVariances = bpRules.map((rule) => {
      const target = Number(rule.count) || 0;
      let actual = 0;
      for (const f of usable) {
        const v = f.primary ?? null;
        if (rule.sectionId && f.section_key !== rule.sectionId) continue;
        if (rule.chapterId && v?.chapter_id !== rule.chapterId) continue;
        if (rule.topicId && v?.topic_id !== rule.topicId) continue;
        if (rule.type && v?.type !== rule.type) continue;
        if (rule.difficulty && String(v?.difficulty ?? "") !== rule.difficulty) continue;
        actual += 1;
      }
      return {
        ruleId: rule.id,
        sectionKey: rule.sectionId ?? null,
        sectionName: rule.sectionId ? sectionNameOf(rule.sectionId) : "Paper",
        label: describeBlueprintRule(rule, chapterNames, topicNames),
        target,
        actual,
        delta: actual - target,
      };
    });

    const sectionVariances = bpSections.map((s) => {
      const target = sectionTargets.get(s.id);
      const actual = actualBySection.get(s.id) ?? { count: 0, marks: 0 };
      return {
        key: s.id,
        name: target.name,
        targetCount: target.targetCount,
        actualCount: actual.count,
        countDelta: actual.count - target.targetCount,
        targetMarks: target.targetMarks,
        actualMarks: actual.marks,
        marksDelta: actual.marks - target.targetMarks,
      };
    });

    blueprintVariance = {
      summary: {
        hasBlueprint: true,
        targetQuestions: targetQuestionsSum,
        actualQuestions: usable.length,
        questionsDelta: usable.length - targetQuestionsSum,
        targetMarks: targetMarksSum,
        actualMarks: totalMarks,
        marksDelta: totalMarks - targetMarksSum,
      },
      sections: sectionVariances,
      rules: ruleVariances,
      warnings,
    };
  }

  return {
    paperId: paper?.id ?? null,
    paper: {
      id: paper?.id ?? null,
      title: paper?.title ?? null,
      description: paper?.description ?? null,
      duration_min: paper?.duration_min ?? null,
      total_marks: paper?.total_marks ?? null,
      status: paper?.status ?? null,
    },
    actual: {
      totalQuestions: usable.length,
      totalMarks,
      durationMin: paper?.duration_min ?? null,
      declaredTotalMarks: paper?.total_marks ?? null,
      declaredQuestions: blueprint?.totalQuestions ?? null,
    },
    sectionDistribution: sections,
    typeDistribution: sortBuckets(byType),
    difficultyDistribution: sortBuckets(byDifficulty),
    chapterDistribution: sortBuckets(byChapter).map((c) => ({ id: c.key === "__unassigned__" ? null : c.key, name: c.label, count: c.count })),
    topicDistribution: sortBuckets(byTopic).map((t) => ({ id: t.key === "__unassigned__" ? null : t.key, name: t.label, count: t.count })),
    languageCoverage,
    duplicates: { familyDuplicates, contentDuplicates },
    blueprintVariance,
  };
}

// ---------------------------------------------------------------------------
// Paper Versioning & History (Paper Generator Phase 15)
// A published paper is safely versioned with immutable, insert-only snapshots.
// The pure functions below build and diff those snapshots; storage/restore is
// layered on top in supabase.js/index.js. Following the established language
// paper convention (migration 010), snapshots pin COMPOSITION — family ids,
// marks, section/lock state, per-family language coverage and content digests —
// while question variants remain the source of truth for rendered content.
// ---------------------------------------------------------------------------

/**
 * Build an immutable version snapshot of a paper's current state.
 *
 * @param {object} paper master paper row (getPaperById.paper)
 * @param {Array}  familyRefs families from getPaperById
 * @param {object|null} blueprint stored blueprint (getPaperBlueprint.blueprint)
 * @param {object|null} sets stored sets document (getPaperSets.sets)
 * @param {object|null} translations stored translations doc (getPaperSets.translations)
 * @param {Array}  [languagePapers] generated language paper artifacts ({ language_id, version, set_key, status })
 * @param {object|null} [template] optional template descriptor ({ id, name })
 */
export function buildPaperSnapshot(
  paper,
  familyRefs,
  blueprint,
  sets,
  translations,
  languagePapers = [],
  template = null,
) {
  const refs = (Array.isArray(familyRefs) ? familyRefs : [])
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

  const families = [];
  let totalMarks = 0;
  for (const f of refs) {
    const primary = f.primary ?? (Array.isArray(f.variants) ? f.variants[0] : null) ?? null;
    const marks = Number(f.marks) > 0 ? Number(f.marks) : Number(primary?.marks) || 0;
    totalMarks += marks;
    const languages = [];
    for (const v of f.variants ?? []) {
      if (v?.language_id && !languages.includes(v.language_id)) languages.push(v.language_id);
    }
    families.push({
      family_id: f.family_id,
      sort_order: Number(f.sort_order) || 0,
      marks,
      section_key: f.section_key ?? null,
      locked: Boolean(f.locked),
      languages: languages.sort(),
      question_digest: contentHashOf(primary),
    });
  }

  return {
    schemaVersion: 1,
    paper: {
      id: paper?.id ?? null,
      title: paper?.title ?? null,
      description: paper?.description ?? null,
      standard_id: paper?.standard_id ?? null,
      subject_id: paper?.subject_id ?? null,
      exam_type_id: paper?.exam_type_id ?? null,
      duration_min: paper?.duration_min ?? null,
      total_marks: paper?.total_marks ?? null,
      status: paper?.status ?? null,
    },
    template: template && (template.id || template.name)
      ? { id: template.id ?? null, name: template.name ?? String(template.id) }
      : null,
    blueprint: blueprint ?? null,
    families,
    sets: sets ?? null,
    translations: translations ?? null,
    languagePapers: (Array.isArray(languagePapers) ? languagePapers : []).map((lp) => ({
      language_id: lp.language_id,
      version: Number(lp.version) || 1,
      set_key: lp.set_key ?? null,
      status: lp.status ?? "generated",
    })),
    totals: {
      questionCount: families.length,
      totalMarks,
    },
  };
}

function lcsCommonSubsequence(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const common = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      common.push(a[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return common;
}

const VERSION_FIELD_LABELS = {
  title: "title",
  description: "description",
  duration_min: "duration",
  total_marks: "declared marks",
  standard_id: "standard",
  subject_id: "subject",
  exam_type_id: "exam type",
};

/**
 * Diff two version snapshots into the structured change record shown in the
 * version history. Human-readable summary is produced here (pure, unit-testable).
 *
 * @returns {object} changes record with additions/removals/replacements,
 *                   reordering, marks/section/blueprint/language/template/sets/
 *                   translations changes and a `summary` string.
 */
export function diffPaperSnapshots(prev, next) {
  const prevSeq = (prev?.families ?? []).map((f) => f.family_id);
  const nextSeq = (next?.families ?? []).map((f) => f.family_id);
  const prevSet = new Set(prevSeq);
  const nextSet = new Set(nextSeq);

  const rawAdditions = [];
  const rawRemovals = [];
  for (const id of nextSeq) if (!prevSet.has(id)) rawAdditions.push(id);
  for (const id of prevSeq) if (!nextSet.has(id)) rawRemovals.push(id);

  // Pure same-slot replacements: an added family sitting exactly where a
  // removed one was, when the add/remove counts match (a true swap). Anything
  // more complex (mixed edits) shows as plain additions/removals.
  const replacements = [];
  const consumedAdds = new Set();
  const consumedRemoves = new Set();
  if (rawAdditions.length === rawRemovals.length) {
    const maxLen = Math.max(prevSeq.length, nextSeq.length);
    for (let k = 0; k < maxLen; k += 1) {
      const from = prevSeq[k];
      const to = nextSeq[k];
      if (from && to && from !== to && !prevSet.has(to) && !nextSet.has(from)) {
        replacements.push({ from, to });
        consumedAdds.add(to);
        consumedRemoves.add(from);
      }
    }
  }
  const additions = rawAdditions.filter((id) => !consumedAdds.has(id));
  const removals = rawRemovals.filter((id) => !consumedRemoves.has(id));

  const keptPrev = prevSeq.filter((id) => nextSet.has(id));
  const keptNext = nextSeq.filter((id) => prevSet.has(id));
  const lcs = lcsCommonSubsequence(keptPrev, keptNext);
  const lcsNextSet = new Set(lcs);
  // True relative reordering = common elements that fall outside the longest
  // common subsequence (a pure add/remove shifts absolute indexes without
  // reordering anything, so LCS guards against false positives).
  const moved = keptNext.filter((id) => !lcsNextSet.has(id));
  // Display count = how many kept questions actually sit at a new position.
  const prevIndex = new Map(prevSeq.map((id, i) => [id, i]));
  const nextIndex = new Map(nextSeq.map((id, i) => [id, i]));
  const positionChanged = keptPrev.filter((id) => prevIndex.get(id) !== nextIndex.get(id));

  const prevById = new Map((prev?.families ?? []).map((f) => [f.family_id, f]));
  const nextById = new Map((next?.families ?? []).map((f) => [f.family_id, f]));

  const marksChanged = [];
  const sectionsChanged = [];
  const languages = {
    added: [],
    removed: [],
    affectedFamilies: new Set(),
  };
  for (const id of keptPrev) {
    const p = prevById.get(id);
    const n = nextById.get(id);
    if (p && n) {
      if (Number(p.marks) !== Number(n.marks)) marksChanged.push(id);
      if ((p.section_key ?? null) !== (n.section_key ?? null)) sectionsChanged.push(id);
      const pLangs = new Set(p.languages ?? []);
      const nLangs = new Set(n.languages ?? []);
      for (const lang of nLangs) if (!pLangs.has(lang)) { languages.added.push(lang); languages.affectedFamilies.add(id); }
      for (const lang of pLangs) if (!nLangs.has(lang)) { languages.removed.push(lang); languages.affectedFamilies.add(id); }
    }
  }

  const templateOf = (s) => (s?.template && (s.template.id || s.template.name) ? s.template : null);
  const pt = templateOf(prev);
  const nt = templateOf(next);
  const templateChanged =
    (pt?.id ?? pt?.name) !== (nt?.id ?? nt?.name)
      ? { from: pt, to: nt }
      : null;

  const prevLangs = new Set((prev?.languagePapers ?? []).map((l) => l.language_id));
  const nextLangs = new Set((next?.languagePapers ?? []).map((l) => l.language_id));
  const languagePapersChanged = {
    added: (next?.languagePapers ?? []).filter((l) => !prevLangs.has(l.language_id)).map((l) => ({ language_id: l.language_id, version: l.version, status: l.status })),
    removed: (prev?.languagePapers ?? []).filter((l) => !nextLangs.has(l.language_id)).map((l) => ({ language_id: l.language_id, version: l.version, status: l.status })),
  };

  const short = (s) => String(s ?? "").slice(0, 8);
  const fieldChanges = [];
  for (const [key, label] of Object.entries(VERSION_FIELD_LABELS)) {
    const pv = prev?.paper?.[key] ?? null;
    const nv = next?.paper?.[key] ?? null;
    if (pv !== nv) fieldChanges.push(label);
  }
  const movedCount = moved.length;
  const reorderCount = positionChanged.length;

  const changes = {
    changed: false,
    additions: additions.filter((id) => !consumedAdds.has(id)),
    removals: removals.filter((id) => !consumedRemoves.has(id)),
    replacements,
    reorderCount: reorderCount > 0 ? reorderCount : 0,
    reordered: movedCount > 0,
    marksChanged,
    sectionsChanged,
    blueprintChanged: stableJson(prev?.blueprint ?? null) !== stableJson(next?.blueprint ?? null),
    setsChanged: stableJson(prev?.sets ?? null) !== stableJson(next?.sets ?? null),
    translationsChanged: stableJson(prev?.translations ?? null) !== stableJson(next?.translations ?? null),
    languagePapersChanged,
    templateChanged,
    fieldChanges,
    questionCount: {
      from: prev?.totals?.questionCount ?? prevSeq.length,
      to: next?.totals?.questionCount ?? nextSeq.length,
    },
    totalMarks: {
      from: prev?.totals?.totalMarks ?? 0,
      to: next?.totals?.totalMarks ?? 0,
    },
  };
  changes.changed =
    changes.additions.length > 0 ||
    changes.removals.length > 0 ||
    changes.replacements.length > 0 ||
    changes.reordered ||
    changes.marksChanged.length > 0 ||
    changes.sectionsChanged.length > 0 ||
    changes.blueprintChanged ||
    changes.setsChanged ||
    changes.translationsChanged ||
    changes.templateChanged !== null ||
    changes.fieldChanges.length > 0 ||
    languages.added.length > 0 ||
    languages.removed.length > 0 ||
    languagePapersChanged.added.length > 0 ||
    languagePapersChanged.removed.length > 0;

  changes.languagesChanged = {
    added: [...new Set(languages.added)],
    removed: [...new Set(languages.removed)],
    affectedFamilies: languages.affectedFamilies.size,
  };

  // Human-readable summary.
  const parts = [];
  const n = changes.additions.length;
  if (n === 1) parts.push("Added 1 question");
  else if (n > 1) parts.push(`Added ${n} questions`);
  const r = changes.removals.length;
  if (r === 1) parts.push("Removed 1 question");
  else if (r > 1) parts.push(`Removed ${r} questions`);
  if (changes.replacements.length === 1) parts.push("Replaced 1 question");
  else if (changes.replacements.length > 1) parts.push(`Replaced ${changes.replacements.length} questions`);
  if (changes.reordered) parts.push(`Reordered ${changes.reorderCount} question${changes.reorderCount === 1 ? "" : "s"}`);
  if (changes.marksChanged.length === 1) parts.push("Changed marks for 1 question");
  else if (changes.marksChanged.length > 1) parts.push(`Changed marks for ${changes.marksChanged.length} questions`);
  if (changes.sectionsChanged.length > 0) parts.push("Changed sections");
  if (changes.blueprintChanged) parts.push("Blueprint changed");
  if (changes.setsChanged) parts.push("Sets updated");
  if (changes.translationsChanged) parts.push("Translation readiness updated");
  const langLabel = (id) => short(id);
  if (changes.languagesChanged.added.length > 0) parts.push(`Languages added: ${changes.languagesChanged.added.map(langLabel).join(", ")}`);
  if (changes.languagesChanged.removed.length > 0) parts.push(`Languages removed: ${changes.languagesChanged.removed.map(langLabel).join(", ")}`);
  if (languagePapersChanged.added.length > 0) parts.push("Generated language paper(s)");
  if (languagePapersChanged.removed.length > 0) parts.push("Removed language paper(s)");
  if (changes.templateChanged) {
    parts.push(`Template changed${changes.templateChanged.to?.name ? ` to “${changes.templateChanged.to.name}”` : ""}`);
  }
  if (changes.fieldChanges.length > 0) parts.push(`Updated ${changes.fieldChanges.join(", ")}`);
  changes.summary = changes.changed ? parts.join("; ") : "No changes";

  return changes;
}

// ---------------------------------------------------------------------------
// Paper Lifecycle Rules (Paper Generator Phase 16)
// Pure status-machine spec for the Draft → Validated → Published → Archived
// lifecycle. Kept here so transition rules are unit-testable without a
// database; route handlers apply these on top of validation gates.
// ---------------------------------------------------------------------------

export const PAPER_STATUSES = ["draft", "validated", "published", "archived"];

/**
 * Explicit allowlist of lifecycle transitions. Key facts:
 * - archived is a sink (it can only be left by an explicit restore → draft).
 * - published cannot transition to anything except archived (published data
 *   is never destroyed or silently modified in place).
 * - draft may go straight to published when it passes the validation gate.
 * - editing the content of a validated paper reverts it to draft (handled by
 *   computeStatusAfterContentEdit, since it depends on whether content changed).
 */
export const PAPER_TRANSITIONS = {
  draft: ["validated", "published", "archived"],
  validated: ["published", "archived"],
  published: ["archived"],
  archived: ["draft"],
};

export function canTransitionPaper(from, to) {
  if (!PAPER_STATUSES.includes(from) || !PAPER_STATUSES.includes(to)) return false;
  return (PAPER_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Determine the resulting status after a content edit (family list changed or
 * any non-status field changed). Editing a "validated" paper invalidates the
 * previous validation and pushes it back to "draft".
 */
export function computeStatusAfterContentEdit(currentStatus, explicitTarget) {
  if (currentStatus !== "validated") return explicitTarget ?? currentStatus;
  if (explicitTarget === "validated") return "validated";
  if (explicitTarget === "published") return "published";
  return "draft";
}

