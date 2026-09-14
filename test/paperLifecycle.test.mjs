// Phase 16 Paper Lifecycle Management tests (node --test). Covers the pure
// status-machine rules (paperService.js) and the pure PDF HTML builder
// (pdfRenderer.js). DB-backed transition endpoints are thin wrappers around
// these + the validation gate already tested in paperValidation tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAPER_STATUSES,
  PAPER_TRANSITIONS,
  canTransitionPaper,
  computeStatusAfterContentEdit,
} from "../paperService.js";
import { buildPaperHtml } from "../pdfRenderer.js";

test("lifecycle exposes the four official statuses", () => {
  assert.deepEqual(PAPER_STATUSES, ["draft", "validated", "published", "archived"]);
});

test("transition allowlist respects the lifecycle", () => {
  assert.equal(canTransitionPaper("draft", "validated"), true);
  assert.equal(canTransitionPaper("draft", "published"), true);
  assert.equal(canTransitionPaper("draft", "archived"), true);
  assert.equal(canTransitionPaper("validated", "published"), true);
  assert.equal(canTransitionPaper("validated", "archived"), true);
  assert.equal(canTransitionPaper("published", "archived"), true);
  assert.equal(canTransitionPaper("archived", "draft"), true); // explicit restore
});

test("published is a sink — it can only go to archived", () => {
  assert.equal(canTransitionPaper("published", "draft"), false);
  assert.equal(canTransitionPaper("published", "validated"), false);
  assert.equal(canTransitionPaper("published", "published"), false);
});

test("archived cannot be edited in place — restore is the only way out", () => {
  assert.equal(canTransitionPaper("archived", "validated"), false);
  assert.equal(canTransitionPaper("archived", "published"), false);
  assert.equal(canTransitionPaper("archived", "archived"), false);
});

test("unknown statuses are rejected rather than silently allowed", () => {
  assert.equal(canTransitionPaper("draft", "deleted"), false);
  assert.equal(canTransitionPaper("reviewing", "draft"), false);
  assert.equal(canTransitionPaper(null, "draft"), false);
  assert.equal(canTransitionPaper("draft", null), false);
});

test("PAPER_TRANSITIONS matches the official allowlist", () => {
  assert.deepEqual(PAPER_TRANSITIONS, {
    draft: ["validated", "published", "archived"],
    validated: ["published", "archived"],
    published: ["archived"],
    archived: ["draft"],
  });
});

test("content edit of a validated paper reverts it to draft", () => {
  assert.equal(computeStatusAfterContentEdit("validated", undefined), "draft");
  assert.equal(computeStatusAfterContentEdit("validated", "draft"), "draft");
});

test("content edit while explicitly re-validating or publishing keeps the target", () => {
  assert.equal(computeStatusAfterContentEdit("validated", "validated"), "validated");
  assert.equal(computeStatusAfterContentEdit("validated", "published"), "published");
});

test("content edit of non-validated papers keeps the target status", () => {
  assert.equal(computeStatusAfterContentEdit("draft", undefined), "draft");
  assert.equal(computeStatusAfterContentEdit("draft", "published"), "published");
  assert.equal(computeStatusAfterContentEdit("published", "archived"), "archived");
});

// --- PDF HTML builder -----------------------------------------------------

const RICH = {
  type: "doc",
  content: [{ type: "para", content: [{ type: "text", text: "Solve for x in 2x + 1 = 5." }] }],
};

const OPT = [
  { label: "A", content: { type: "doc", content: [{ type: "para", content: [{ type: "text", text: "1" }] }] }, is_correct: true },
  { label: "B", content: { type: "doc", content: [{ type: "para", content: [{ type: "text", text: "2" }] }] }, is_correct: false },
];

const Q1 = {
  id: "q1", family_id: "f1", section_key: "sec-a", marks: 2, content: RICH, options: OPT, explanation: null,
};

test("buildPaperHtml renders header meta, question body and options", () => {
  const html = buildPaperHtml({ id: "p1", title: "Maths Paper" }, [Q1], {
    title: "Maths Paper", durationMin: 60, totalMarks: 2, languageName: "English",
  });
  assert.match(html, /Maths Paper/);
  assert.match(html, /Duration: 60 min/);
  assert.match(html, /Total marks: 2/);
  assert.match(html, /Language: English/);
  assert.match(html, /Solve for x in 2x \+ 1 = 5\./);
  assert.match(html, /A\./);
  assert.match(html, /B\./);
});

test("buildPaperHtml escapes HTML in question content (no injection)", () => {
  const malicious = {
    type: "doc",
    content: [{ type: "para", content: [{ type: "text", text: "<script>alert('x')</script>" }] }],
  };
  const html = buildPaperHtml({ id: "p1", title: "Paper" }, [{ ...Q1, content: malicious }], { title: "Paper" });
  assert.ok(!html.includes("<script>alert"), `raw script leaked: ${html}`);
  assert.match(html, /&lt;script&gt;alert/);
});

test("buildPaperHtml renders section labels and per-question marks", () => {
  const html = buildPaperHtml({ id: "p1", title: "Paper" }, [Q1], { title: "Paper" });
  assert.match(html, /sec-a/);
  assert.match(html, /2 marks/);
});

test("buildPaperHtml marks correct answers when showAnswers is on", () => {
  const html = buildPaperHtml({ id: "p1", title: "Paper" }, [Q1], { title: "Paper", showAnswers: true });
  assert.match(html, /class="correct-mark"/);
});

test("buildPaperHtml renders math nodes as KaTeX targets", () => {
  const mathDoc = {
    type: "doc",
    content: [{ type: "para", content: [
      { type: "text", text: "Evaluate " },
      { type: "inlineMath", content: "\\frac{a}{b}" },
      { type: "text", text: " for a=b=1." },
    ] }],
  };
  const html = buildPaperHtml({ id: "p1", title: "Paper" }, [{ ...Q1, content: mathDoc }], { title: "Paper" });
  assert.match(html, /class="math"/);
  assert.match(html, /frac\{a\}\{b\}/);
});

test("buildPaperHtml returns a friendly empty body when no questions", () => {
  const html = buildPaperHtml({ id: "p1", title: "Paper" }, [], { title: "Paper" });
  assert.match(html, /No questions in this paper\./);
});

test("buildPaperHtml includes the answer-key watermark when enabled", () => {
  const html = buildPaperHtml({ id: "p1", title: "Paper" }, [Q1], { title: "Paper", showAnswers: true });
  assert.match(html, /ANSWER KEY/);
});