// ---------------------------------------------------------------------------
// Paper PDF Renderer (Paper Generator Phase 12/16)
// Pure-ish module: builds an HTML document string from resolved paper data
// and renders it to PDF via Puppeteer. Math formulas are rendered by KaTeX
// (loaded from CDN in the headless browser).
// ---------------------------------------------------------------------------

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderRichText(rich) {
  if (!rich) return "";
  if (typeof rich === "string") return escHtml(rich);
  // Stored rich-editor format ({ html: "…" } — as saved by the question entry
  // UI). The HTML was produced by the editor and is rendered as-is by the
  // admin/print UIs (storedRichHelper), so render it directly here too.
  if (typeof rich.html === "string") return rich.html;
  if (Array.isArray(rich?.content)) {
    return rich.content.map(renderRichTextNode).join("");
  }
  return escHtml(JSON.stringify(rich));
}

function renderRichTextNode(node) {
  if (!node) return "";
  if (node.type === "text") return escHtml(node.text ?? "");
  if (node.type === "math" || node.type === "inlineMath") {
    const tex = escHtml(node.content ?? node.text ?? node.latex ?? "");
    return `<span class="math" data-expr="${tex}">${tex}</span>`;
  }
  if (node.type === "image") return `<img src="${escHtml(node.src ?? node.url ?? "")}" alt="" class="inline-img"/>`;
  if (node.type === "hardBreak") return "<br/>";
  if (node.type === "paragraph") {
    return `<p>${(node.content ?? []).map(renderRichTextNode).join("")}</p>`;
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    const tag = node.type === "orderedList" ? "ol" : "ul";
    return `<${tag}>${(node.content ?? []).map((li) => `<li>${(li.content ?? []).map(renderRichTextNode).join("")}</li>`).join("")}</${tag}>`;
  }
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(renderRichTextNode).join("");
  }
  return escHtml(node.text ?? "");
}

function renderOption(opt, index) {
  const label = opt.label ?? String.fromCharCode(65 + index);
  return `
    <div class="option">
      <span class="option-label">${escHtml(label)}.</span>
      <span class="option-content">${renderRichText(opt.content)}</span>
      ${opt.is_correct ? '<span class="correct-mark">✓</span>' : ""}
    </div>`;
}

function renderQuestion(q, index, options = {}) {
  const section = q.section_key
    ? `<span class="q-section">${escHtml(q.section_key)}</span>`
    : "";
  return `
    <div class="question">
      <div class="q-header">
        <span class="q-number">${index + 1}.</span>
        ${section}
        <span class="q-marks">[${q.marks ?? 0} mark${(q.marks ?? 0) === 1 ? "" : "s"}]</span>
      </div>
      <div class="q-body">${renderRichText(q.content)}</div>
      ${Array.isArray(q.options) && q.options.length > 0
        ? `<div class="q-options">${q.options.map((o, i) => renderOption(o, i)).join("")}</div>`
        : ""}
      ${options.showAnswers && q.explanation ? `<div class="q-explanation"><strong>Explanation:</strong> ${renderRichText(q.explanation)}</div>` : ""}
    </div>`;
}

/**
 * Build a self-contained HTML document for a paper. The HTML loads KaTeX from
 * CDN and auto-renders all `.math` elements when the page loads (puppeteer
 * captures after KaTeX has processed the DOM).
 */
export function buildPaperHtml(paper, questions, options = {}) {
  const {
    title = "Paper",
    description = null,
    durationMin = null,
    totalMarks = null,
    languageName = null,
    showAnswers = false,
    setKey = null,
    examName = null,
  } = options;

  const qHtml = questions.map((q, i) => renderQuestion(q, i, { showAnswers })).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${escHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css"/>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: 'Noto Sans', 'Segoe UI', Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #1e293b;
    margin: 0;
    padding: 24pt;
  }
  .header { text-align: center; margin-bottom: 18pt; border-bottom: 2px solid #e2e8f0; padding-bottom: 14pt; }
  .header h1 { font-size: 18pt; margin: 0 0 4pt; }
  .header .subtitle { font-size: 10pt; color: #64748b; margin: 0; }
  .meta { display: flex; justify-content: center; gap: 24pt; font-size: 9.5pt; color: #475569; margin: 8pt 0 0; flex-wrap: wrap; }
  .meta span { white-space: nowrap; }
  .section-heading { font-size: 12pt; font-weight: 700; margin: 18pt 0 8pt; padding-bottom: 4pt; border-bottom: 1px solid #cbd5e1; }
  .question { margin-bottom: 14pt; page-break-inside: avoid; }
  .q-header { display: flex; align-items: baseline; gap: 6pt; margin-bottom: 4pt; }
  .q-number { font-weight: 700; }
  .q-section { font-size: 8.5pt; color: #6366f1; background: #eef2ff; border-radius: 3pt; padding: 1pt 5pt; }
  .q-marks { font-size: 9pt; color: #94a3b8; margin-left: auto; }
  .q-body { margin: 0 0 6pt; }
  .q-body p { margin: 0 0 4pt; }
  .q-options { padding-left: 16pt; }
  .option { margin-bottom: 3pt; display: flex; gap: 5pt; }
  .option-label { font-weight: 600; }
  .correct-mark { color: #16a34a; font-weight: 700; margin-left: auto; }
  .q-explanation { margin-top: 6pt; padding: 8pt; background: #f8fafc; border-left: 3px solid #94a3b8; font-size: 9.5pt; color: #475569; }
  .math { font-style: italic; }
  .inline-img { max-height: 16pt; vertical-align: middle; }
  .footer { text-align: center; font-size: 8pt; color: #94a3b8; margin-top: 24pt; border-top: 1px solid #e2e8f0; padding-top: 8pt; }
  @media print {
    body { padding: 12pt; }
    .question { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>${escHtml(title)}</h1>
    ${description ? `<p class="subtitle">${escHtml(description)}</p>` : ""}
    <div class="meta">
      ${durationMin != null ? `<span>Duration: ${durationMin} min</span>` : ""}
      ${totalMarks != null ? `<span>Total marks: ${totalMarks}</span>` : ""}
      ${languageName ? `<span>Language: ${escHtml(languageName)}</span>` : ""}
      ${setKey ? `<span>Set: ${escHtml(setKey)}</span>` : ""}
      ${examName ? `<span>${escHtml(examName)}</span>` : ""}
    </div>
  </div>
  ${qHtml || '<p style="text-align:center;color:#94a3b8;">No questions in this paper.</p>'}
  <div class="footer">
    Generated by Question Bank · ${new Date().toISOString().slice(0, 10)}
    ${showAnswers ? " · ANSWER KEY" : ""}
  </div>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/contrib/auto-render.min.js"></script>
  <script>
    if (typeof renderMathInElement === 'function') {
      renderMathInElement(document.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
      });
    }
  </script>
</body>
</html>`;
}

/**
 * Render an HTML string to a PDF Buffer via Puppeteer.
 * The headless browser loads the HTML, waits for KaTeX to finish, then
 * captures the page as a single-page PDF.
 *
 * Production hardening (Paper Generator):
 *  - ONE Chromium instance is shared and recycled across renders instead of a
 *    fresh launch per PDF (launch is ~300-800ms + heavy memory). A semaphore
 *    bounds concurrent renders so a burst of exports cannot exhaust memory.
 *  - The browser is lazily re-launched if it crashed or was closed.
 *  - Waits are bounded: networkidle with a hard timeout plus a best-effort
 *    fonts/KaTeX wait, so a slow CDN can delay a render but never hang it.
 */
const MAX_CONCURRENT_RENDERS = Number(process.env.PDF_MAX_CONCURRENT_RENDERS) || 3;
const PDF_NAV_TIMEOUT_MS = Number(process.env.PDF_NAV_TIMEOUT_MS) || 45000;

let sharedBrowser = null;
let browserLaunching = null;
let activeRenders = 0;
const renderQueue = [];

// Idle reaper: close the shared browser after this much inactivity so an idle
// server releases Chromium's memory, and short-lived processes (tests, CLI)
// can exit naturally instead of being kept alive by the browser handle. The
// timer itself is unref'd so it never keeps the event loop alive.
const PDF_BROWSER_IDLE_MS = Number(process.env.PDF_BROWSER_IDLE_MS) || 30000;
let idleTimer = null;

function armIdleReaper() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (activeRenders === 0) void closeSharedBrowser();
    else armIdleReaper();
  }, PDF_BROWSER_IDLE_MS);
  idleTimer.unref?.();
}

async function getSharedBrowser() {
  if (sharedBrowser && sharedBrowser.connected) return sharedBrowser;
  if (!browserLaunching) {
    // Dynamic import so the module remains testable without puppeteer installed.
    const puppeteer = await import("puppeteer");
    browserLaunching = puppeteer.default
      .launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      })
      .then((browser) => {
        sharedBrowser = browser;
        // A disconnected browser must be re-launched on the next render.
        browser.once("disconnected", () => {
          sharedBrowser = null;
          browserLaunching = null;
        });
        return browser;
      })
      .catch((err) => {
        browserLaunching = null;
        throw err;
      });
  }
  return browserLaunching;
}

async function acquireRenderSlot() {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders += 1;
    return;
  }
  await new Promise((resolve) => renderQueue.push(resolve));
  activeRenders += 1;
}

function releaseRenderSlot() {
  activeRenders -= 1;
  const next = renderQueue.shift();
  if (next) next();
}

async function closeSharedBrowser() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  const browser = sharedBrowser;
  sharedBrowser = null;
  browserLaunching = null;
  if (browser) await browser.close().catch(() => {});
}

export async function htmlToPdfBuffer(html, { width = "A4", printBackground = true } = {}) {
  await acquireRenderSlot();
  try {
    const browser = await getSharedBrowser();
    const page = await browser.newPage();
    try {
      // networkidle0 waits for images/CDN assets, but the hard timeout bounds
      // it: a slow CDN delays the render instead of hanging the request.
      await page.setContent(html, { waitUntil: ["load", "networkidle0"], timeout: PDF_NAV_TIMEOUT_MS });
      // Best-effort: wait for KaTeX fonts / pending font loads, never fatal.
      await page
        .waitForFunction(() => {
          const fonts = document.fonts;
          return fonts && fonts.status === "loaded";
        }, { timeout: 10000 })
        .catch(() => {});
      const pdf = await page.pdf({ width, format: "A4", printBackground, margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" } });
      return pdf;
    } finally {
      // Always release the page; guard against a crashed browser on close.
      await page.close().catch(() => {});
    }
  } catch (err) {
    // A crashed/OOM'd shared browser poisons every future render — reset it so
    // the next request gets a fresh launch.
    if (err && (err.message?.includes("Target closed") || err.message?.includes("Session closed") || err.message?.includes("Protocol error"))) {
      await closeSharedBrowser();
    }
    throw err;
  } finally {
    releaseRenderSlot();
    // Schedule browser release after inactivity (memory + clean process exit).
    armIdleReaper();
  }
}

/**
 * Test/ops hook: dispose the shared browser (e.g. on server shutdown).
 */
export async function disposePdfRenderer() {
  await closeSharedBrowser();
}