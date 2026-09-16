import { client } from "./supabase.js";

/**
 * Complete Question Bank Seeder (Paper Generator prerequisite)
 * Run: node seedQuestionBank.js
 *
 * Seeds:
 *  - Std 10 Science chapters + topics
 *  - 40 question families (20 Maths + 20 Science)
 *  - Each family has English + Gujarati variants with options
 *
 * Idempotent — safe to run multiple times (skips existing families by title match).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const html = (text) => ({ html: `<p>${text}</p>` });
const mathHtml = (text, latex) =>
  ({ html: `<p>${text}<span data-latex="${latex}" data-display="false" data-type="math-node" class="math-node-rendered is-inline"></span></p>` });

function log(msg) { process.stdout.write(`${msg}\n`); }

async function getId(table, matchCol, matchVal) {
  const { data } = await client.from(table).select("id").eq(matchCol, matchVal).single();
  return data?.id ?? null;
}

// ── Std 10 Science Chapters & Topics ─────────────────────────────────────────

const CHAPTERS_STD10_SCIENCE = [
  {
    name: "Ch 1 - Chemical Reactions and Equations",
    number: 1,
    topics: [
      { name: "1.1 Chemical Reactions", number: "1.1" },
      { name: "1.2 Types of Chemical Reactions", number: "1.2" },
      { name: "1.3 Effects of Oxidation in Everyday Life", number: "1.3" },
    ],
  },
  {
    name: "Ch 2 - Acids, Bases and Salts",
    number: 2,
    topics: [
      { name: "2.1 Acids and Bases", number: "2.1" },
      { name: "2.2 pH Scale", number: "2.2" },
      { name: "2.3 Chemical Properties of Acids and Bases", number: "2.3" },
      { name: "2.4 Salts", number: "2.4" },
    ],
  },
  {
    name: "Ch 3 - Metals and Non-metals",
    number: 3,
    topics: [
      { name: "3.1 Physical Properties of Metals and Non-metals", number: "3.1" },
      { name: "3.2 Chemical Properties of Metals", number: "3.2" },
      { name: "3.3 Occurrence and Extraction of Metals", number: "3.3" },
      { name: "3.4 Corrosion and its Prevention", number: "3.4" },
    ],
  },
  {
    name: "Ch 4 - Life Processes",
    number: 4,
    topics: [
      { name: "4.1 Nutrition in Living Organisms", number: "4.1" },
      { name: "4.2 Respiration", number: "4.2" },
      { name: "4.3 Transportation in Human Beings", number: "4.3" },
      { name: "4.4 Excretion in Human Beings", number: "4.4" },
    ],
  },
  {
    name: "Ch 5 - Control and Coordination",
    number: 5,
    topics: [
      { name: "5.1 Nervous System in Human Beings", number: "5.1" },
      { name: "5.2 Coordination in Plants", number: "5.2" },
      { name: "5.3 Hormones in Animals", number: "5.3" },
    ],
  },
];

// ── Question Data ────────────────────────────────────────────────────────────
// Each family: { en: { content, explanation, options }, gu: { content, explanation, options }, chapter, topic, difficulty, tags }

const MATH_QUESTIONS = [
  // ── Ch 1: Real Numbers ──
  {
    chapter: "Ch 1 - Real Numbers", topic: "1.3 Revisiting Irrational Numbers", difficulty: "easy",
    tags: ["mathematics", "real-numbers"],
    en: {
      content: html("Which of the following is an irrational number?"),
      explanation: html("An irrational number cannot be expressed as a fraction p/q where p and q are integers."),
      options: [
        { label: "A", content: html("22/7"), is_correct: false },
        { label: "B", content: html("0.141414..."), is_correct: false },
        { label: "C", content: html("&radic;2"), is_correct: true },
        { label: "D", content: html("0.101001000..."), is_correct: true },
      ],
    },
    gu: {
      content: html("નીચેના પૈકી કયો અંકોમેય સંખ્યા છે?"),
      explanation: html("અંકોમેય સંખ્યા p/q સ્વરૂપમાં વ્યક્ત કરી શકાતી નથી જ્યાં p અને q પૂર્ણાંક હોય."),
      options: [
        { label: "A", content: html("22/7"), is_correct: false },
        { label: "B", content: html("0.141414..."), is_correct: false },
        { label: "C", content: html("&radic;2"), is_correct: true },
        { label: "D", content: html("0.101001000..."), is_correct: true },
      ],
    },
  },
  {
    chapter: "Ch 1 - Real Numbers", topic: "1.2 The Fundamental Theorem of Arithmetic", difficulty: "medium",
    tags: ["mathematics", "real-numbers"],
    en: {
      content: html("The prime factorisation of 360 is:"),
      explanation: html("360 = 2 &times; 2 &times; 2 &times; 3 &times; 3 &times; 5 = 2<sup>3</sup> &times; 3<sup>2</sup> &times; 5."),
      options: [
        { label: "A", content: html("2<sup>2</sup> &times; 3<sup>2</sup> &times; 5"), is_correct: false },
        { label: "B", content: html("2<sup>3</sup> &times; 3<sup>2</sup> &times; 5"), is_correct: true },
        { label: "C", content: html("2<sup>3</sup> &times; 3 &times; 5<sup>2</sup>"), is_correct: false },
        { label: "D", content: html("2 &times; 3<sup>3</sup> &times; 5"), is_correct: false },
      ],
    },
    gu: {
      content: html("360 નો અભાજી ગુણનખંડીકરણ છે:"),
      explanation: html("360 = 2 &times; 2 &times; 2 &times; 3 &times; 3 &times; 5 = 2<sup>3</sup> &times; 3<sup>2</sup> &times; 5."),
      options: [
        { label: "A", content: html("2<sup>2</sup> &times; 3<sup>2</sup> &times; 5"), is_correct: false },
        { label: "B", content: html("2<sup>3</sup> &times; 3<sup>2</sup> &times; 5"), is_correct: true },
        { label: "C", content: html("2<sup>3</sup> &times; 3 &times; 5<sup>2</sup>"), is_correct: false },
        { label: "D", content: html("2 &times; 3<sup>3</sup> &times; 5"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 1 - Real Numbers", topic: "1.4 Revisiting Rational Numbers and Their Decimal Expansions", difficulty: "medium",
    tags: ["mathematics", "real-numbers"],
    en: {
      content: html("The decimal expansion of 17/8 is:"),
      explanation: html("17 &divide; 8 = 2.125, which is a terminating decimal."),
      options: [
        { label: "A", content: html("2.125"), is_correct: true },
        { label: "B", content: html("2.125125..."), is_correct: false },
        { label: "C", content: html("2.152552..."), is_correct: false },
        { label: "D", content: html("2.125000..."), is_correct: false },
      ],
    },
    gu: {
      content: html("17/8 નો દશાંશ વિસ્તરણ છે:"),
      explanation: html("17 &divide; 8 = 2.125, જે એક અંતિમ દશાંશ છે."),
      options: [
        { label: "A", content: html("2.125"), is_correct: true },
        { label: "B", content: html("2.125125..."), is_correct: false },
        { label: "C", content: html("2.152552..."), is_correct: false },
        { label: "D", content: html("2.125000..."), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 1 - Real Numbers", topic: "1.1 Euclid's Division Lemma", difficulty: "hard",
    tags: ["mathematics", "real-numbers"],
    en: {
      content: html("Euclid's Division Lemma states that for any two positive integers a and b, there exist unique integers q and r such that:"),
      explanation: html("Euclid's Division Lemma: a = bq + r, where 0 &le; r &lt; b."),
      options: [
        { label: "A", content: html("a = bq + r, where 0 &le; r &lt; b"), is_correct: true },
        { label: "B", content: html("a = bq + r, where 0 &lt; r &le; b"), is_correct: false },
        { label: "C", content: html("a = bq + r, where 0 &le; r &le; b"), is_correct: false },
        { label: "D", content: html("a = bq + r, where 0 &lt; r &lt; b"), is_correct: false },
      ],
    },
    gu: {
      content: html("યુક્લિડ ભાગાકાર ઉપપત્તિ અનુસાર, બે હકારાત્મક પૂર્ણાંક a અને b માટે, અદ્વિતીય પૂર્ણાંક q અને r અસ્તિત્વમાં છે જેથી:"),
      explanation: html("યુક્લિડ ભાગાકાર ઉપપત્તિ: a = bq + r, જ્યાં 0 &le; r &lt; b."),
      options: [
        { label: "A", content: html("a = bq + r, જ્યાં 0 &le; r &lt; b"), is_correct: true },
        { label: "B", content: html("a = bq + r, જ્યાં 0 &lt; r &le; b"), is_correct: false },
        { label: "C", content: html("a = bq + r, જ્યાં 0 &le; r &le; b"), is_correct: false },
        { label: "D", content: html("a = bq + r, જ્યાં 0 &lt; r &lt; b"), is_correct: false },
      ],
    },
  },

  // ── Ch 2: Polynomials ──
  {
    chapter: "Ch 2 - Polynomials", topic: "2.2 Relationship between Zeroes and Coefficients", difficulty: "easy",
    tags: ["mathematics", "polynomials"],
    en: {
      content: html("If the zeroes of the polynomial x<sup>2</sup> - 5x + 6 are &alpha; and &beta;, then &alpha; + &beta; = ?"),
      explanation: html("For ax<sup>2</sup> + bx + c, sum of zeroes = -b/a. Here a=1, b=-5, so &alpha; + &beta; = 5."),
      options: [
        { label: "A", content: html("5"), is_correct: true },
        { label: "B", content: html("-5"), is_correct: false },
        { label: "C", content: html("6"), is_correct: false },
        { label: "D", content: html("-6"), is_correct: false },
      ],
    },
    gu: {
      content: html("જો x<sup>2</sup> - 5x + 6 બહુપદીના શૂન્યકો &alpha; અને &beta; હોય, તો &alpha; + &beta; = ?"),
      explanation: html("ax<sup>2</sup> + bx + c માટે, શૂન્યકોનો સરવાળો = -b/a. અહીં a=1, b=-5, તો &alpha; + &beta; = 5."),
      options: [
        { label: "A", content: html("5"), is_correct: true },
        { label: "B", content: html("-5"), is_correct: false },
        { label: "C", content: html("6"), is_correct: false },
        { label: "D", content: html("-6"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 2 - Polynomials", topic: "2.1 Geometrical Meaning of the Zeroes", difficulty: "medium",
    tags: ["mathematics", "polynomials"],
    en: {
      content: html("The number of zeroes of a polynomial p(x) of degree n is at most:"),
      explanation: html("A polynomial of degree n has at most n zeroes (Fundamental Theorem of Algebra)."),
      options: [
        { label: "A", content: html("n"), is_correct: true },
        { label: "B", content: html("n + 1"), is_correct: false },
        { label: "C", content: html("n - 1"), is_correct: false },
        { label: "D", content: html("2n"), is_correct: false },
      ],
    },
    gu: {
      content: html("degree n ના બહુપદી p(x) ના શૂન્યકોની સંખ્યા બહુમતી છે:"),
      explanation: html("degree n નો બહુપદી બહુમતી n શૂન્યકો ધરાવે છે (બીજગણિતનું મૂળભૂત ઉપપત્તિ)."),
      options: [
        { label: "A", content: html("n"), is_correct: true },
        { label: "B", content: html("n + 1"), is_correct: false },
        { label: "C", content: html("n - 1"), is_correct: false },
        { label: "D", content: html("2n"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 2 - Polynomials", topic: "2.3 Division Algorithm for Polynomials", difficulty: "hard",
    tags: ["mathematics", "polynomials"],
    en: {
      content: html("When p(x) is divided by g(x), the remainder is:"),
      explanation: html("By the Division Algorithm, p(x) = g(x) &middot; q(x) + r(x), where degree of r(x) &lt; degree of g(x)."),
      options: [
        { label: "A", content: html("Always less than the degree of g(x)"), is_correct: true },
        { label: "B", content: html("Always equal to the degree of g(x)"), is_correct: false },
        { label: "C", content: html("Always greater than the degree of g(x)"), is_correct: false },
        { label: "D", content: html("Always zero"), is_correct: false },
      ],
    },
    gu: {
      content: html("p(x) ને g(x) વડે ભાગ કરતી વખતે, બાકી રહેલ છે:"),
      explanation: html("ભાગાકાર ઉપપત્તિ દ્વારા, p(x) = g(x) &middot; q(x) + r(x), જ્યાં r(x) ની degree g(x) ની degree કરતાં ઓછી છે."),
      options: [
        { label: "A", content: html("હંમેશા g(x) ની degree કરતાં ઓછી"), is_correct: true },
        { label: "B", content: html("હંમેશા g(x) ની degree બરાબર"), is_correct: false },
        { label: "C", content: html("હંમેશા g(x) ની degree કરતાં વધુ"), is_correct: false },
        { label: "D", content: html("હંમેશા શૂન્ય"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 2 - Polynomials", topic: "2.2 Relationship between Zeroes and Coefficients", difficulty: "easy",
    tags: ["mathematics", "polynomials"],
    en: {
      content: html("The zeroes of the polynomial x<sup>2</sup> - 3x - 4 are:"),
      explanation: html("x<sup>2</sup> - 3x - 4 = (x - 4)(x + 1), so zeroes are 4 and -1."),
      options: [
        { label: "A", content: html("4 and -1"), is_correct: true },
        { label: "B", content: html("-4 and 1"), is_correct: false },
        { label: "C", content: html("3 and -1"), is_correct: false },
        { label: "D", content: html("-3 and 1"), is_correct: false },
      ],
    },
    gu: {
      content: html("x<sup>2</sup> - 3x - 4 બહુપદીના શૂન્યકો છે:"),
      explanation: html("x<sup>2</sup> - 3x - 4 = (x - 4)(x + 1), તો શૂન્યકો 4 અને -1 છે."),
      options: [
        { label: "A", content: html("4 અને -1"), is_correct: true },
        { label: "B", content: html("-4 અને 1"), is_correct: false },
        { label: "C", content: html("3 અને -1"), is_correct: false },
        { label: "D", content: html("-3 અને 1"), is_correct: false },
      ],
    },
  },

  // ── Ch 3: Pair of Linear Equations ──
  {
    chapter: "Ch 3 - Pair of Linear Equations in Two Variables", topic: "3.2 Graphical Method of Solution", difficulty: "easy",
    tags: ["mathematics", "linear-equations"],
    en: {
      content: html("A pair of linear equations in two variables is said to be consistent if they have:"),
      explanation: html("Consistent equations have at least one solution — they intersect at a point (unique) or are coincident (infinitely many)."),
      options: [
        { label: "A", content: html("At least one solution"), is_correct: true },
        { label: "B", content: html("No solution"), is_correct: false },
        { label: "C", content: html("Exactly two solutions"), is_correct: false },
        { label: "D", content: html("None of these"), is_correct: false },
      ],
    },
    gu: {
      content: html("બે ચલોના રેખીય સમીકરણોની જોડી સુસંગત કહેવાય છે જો તેમની પાસે હોય:"),
      explanation: html("સુસંગત સમીકરણોનો ઓછામાં ઓછો એક ઉકેલ હોય છે — તેઓ એક બિંદુએ છેદે છે (અદ્વિતીય) અથવા સમપત્ર હોય છે (અનંત)."),
      options: [
        { label: "A", content: html("ઓછામાં ઓછો એક ઉકેલ"), is_correct: true },
        { label: "B", content: html("કોઈ ઉકેલ નહીં"), is_correct: false },
        { label: "C", content: html("બિલકુલ બે ઉકેલ"), is_correct: false },
        { label: "D", content: html("આમાંથી કોઈ નહીં"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 3 - Pair of Linear Equations in Two Variables", topic: "3.3 Algebraic Methods of Solving", difficulty: "medium",
    tags: ["mathematics", "linear-equations"],
    en: {
      content: html("The solution of the equations x + y = 5 and x - y = 3 is:"),
      explanation: html("Adding both equations: 2x = 8, so x = 4. Then y = 5 - 4 = 1."),
      options: [
        { label: "A", content: html("x = 4, y = 1"), is_correct: true },
        { label: "B", content: html("x = 3, y = 2"), is_correct: false },
        { label: "C", content: html("x = 2, y = 3"), is_correct: false },
        { label: "D", content: html("x = 1, y = 4"), is_correct: false },
      ],
    },
    gu: {
      content: html("x + y = 5 અને x - y = 3 સમીકરણોનો ઉકેલ છે:"),
      explanation: html("બંને સમીકરણો ઉમેરવાથી: 2x = 8, તો x = 4. પછી y = 5 - 4 = 1."),
      options: [
        { label: "A", content: html("x = 4, y = 1"), is_correct: true },
        { label: "B", content: html("x = 3, y = 2"), is_correct: false },
        { label: "C", content: html("x = 2, y = 3"), is_correct: false },
        { label: "D", content: html("x = 1, y = 4"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 3 - Pair of Linear Equations in Two Variables", topic: "3.1 Pair of Linear Equations in Two Variables", difficulty: "hard",
    tags: ["mathematics", "linear-equations"],
    en: {
      content: html("The pair of equations x = a and y = b graphically represents:"),
      explanation: html("x = a is a vertical line and y = b is a horizontal line. They intersect at exactly one point (a, b)."),
      options: [
        { label: "A", content: html("Two intersecting lines"), is_correct: true },
        { label: "B", content: html("Two parallel lines"), is_correct: false },
        { label: "C", content: html("Two coincident lines"), is_correct: false },
        { label: "D", content: html("A line and a parabola"), is_correct: false },
      ],
    },
    gu: {
      content: html("x = a અને y = b સમીકરણોની જોડી આલેખ રજૂ કરે છે:"),
      explanation: html("x = a એ ઊભી રેખા છે અને y = b એ આડી રેખા છે. તેઓ બિલકુલ એક બિંદુએ (a, b) છેદે છે."),
      options: [
        { label: "A", content: html("બે છેદતી રેખાઓ"), is_correct: true },
        { label: "B", content: html("બે સમાંતર રેખાઓ"), is_correct: false },
        { label: "C", content: html("બે સમપત્ર રેખાઓ"), is_correct: false },
        { label: "D", content: html("એક રેખા અને એક પરાવર્તક"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 3 - Pair of Linear Equations in Two Variables", topic: "3.4 Equations Reducible to Linear Form", difficulty: "easy",
    tags: ["mathematics", "linear-equations"],
    en: {
      content: html("If 1/x + 1/y = 5 and 1/x - 1/y = 1, then x = ?"),
      explanation: html("Adding: 2/x = 6, so x = 1/3. Subtracting: 2/y = 4, so y = 1/2."),
      options: [
        { label: "A", content: html("1/3"), is_correct: true },
        { label: "B", content: html("1/2"), is_correct: false },
        { label: "C", content: html("3"), is_correct: false },
        { label: "D", content: html("2"), is_correct: false },
      ],
    },
    gu: {
      content: html("જો 1/x + 1/y = 5 અને 1/x - 1/y = 1, તો x = ?"),
      explanation: html("ઉમેરવાથી: 2/x = 6, તો x = 1/3. બાદ કરવાથી: 2/y = 4, તો y = 1/2."),
      options: [
        { label: "A", content: html("1/3"), is_correct: true },
        { label: "B", content: html("1/2"), is_correct: false },
        { label: "C", content: html("3"), is_correct: false },
        { label: "D", content: html("2"), is_correct: false },
      ],
    },
  },

  // ── Ch 4: Quadratic Equations ──
  {
    chapter: "Ch 4 - Quadratic Equations", topic: "4.2 Solution by Factorisation", difficulty: "easy",
    tags: ["mathematics", "quadratic-equations"],
    en: {
      content: html("The roots of x<sup>2</sup> - 7x + 12 = 0 are:"),
      explanation: html("x<sup>2</sup> - 7x + 12 = (x - 3)(x - 4) = 0, so x = 3 or x = 4."),
      options: [
        { label: "A", content: html("3 and 4"), is_correct: true },
        { label: "B", content: html("-3 and -4"), is_correct: false },
        { label: "C", content: html("3 and -4"), is_correct: false },
        { label: "D", content: html("-3 and 4"), is_correct: false },
      ],
    },
    gu: {
      content: html("x<sup>2</sup> - 7x + 12 = 0 ના મૂળ છે:"),
      explanation: html("x<sup>2</sup> - 7x + 12 = (x - 3)(x - 4) = 0, તો x = 3 અથવા x = 4."),
      options: [
        { label: "A", content: html("3 અને 4"), is_correct: true },
        { label: "B", content: html("-3 અને -4"), is_correct: false },
        { label: "C", content: html("3 અને -4"), is_correct: false },
        { label: "D", content: html("-3 અને 4"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 4 - Quadratic Equations", topic: "4.4 Nature of Roots", difficulty: "medium",
    tags: ["mathematics", "quadratic-equations"],
    en: {
      content: html("The discriminant of the quadratic equation 2x<sup>2</sup> - 4x + 3 = 0 is:"),
      explanation: html("D = b<sup>2</sup> - 4ac = (-4)<sup>2</sup> - 4(2)(3) = 16 - 24 = -8. Since D &lt; 0, the equation has no real roots."),
      options: [
        { label: "A", content: html("-8"), is_correct: true },
        { label: "B", content: html("8"), is_correct: false },
        { label: "C", content: html("16"), is_correct: false },
        { label: "D", content: html("24"), is_correct: false },
      ],
    },
    gu: {
      content: html("2x<sup>2</sup> - 4x + 3 = 0 દ્વિઘાત સમીકરણનો વિવેચક છે:"),
      explanation: html("D = b<sup>2</sup> - 4ac = (-4)<sup>2</sup> - 4(2)(3) = 16 - 24 = -8. D &lt; 0 હોવાથી, સમીકરણનો કોઈ વાસ્તવિક મૂળ નથી."),
      options: [
        { label: "A", content: html("-8"), is_correct: true },
        { label: "B", content: html("8"), is_correct: false },
        { label: "C", content: html("16"), is_correct: false },
        { label: "D", content: html("24"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 4 - Quadratic Equations", topic: "4.3 Completing the Square", difficulty: "hard",
    tags: ["mathematics", "quadratic-equations"],
    en: {
      content: html("The quadratic formula gives the roots of ax<sup>2</sup> + bx + c = 0 as:"),
      explanation: html("The quadratic formula is x = (-b &plusmn; &radic;(b<sup>2</sup> - 4ac)) / 2a."),
      options: [
        { label: "A", content: html("x = (-b &plusmn; &radic;(b<sup>2</sup> - 4ac)) / 2a"), is_correct: true },
        { label: "B", content: html("x = (b &plusmn; &radic;(b<sup>2</sup> - 4ac)) / 2a"), is_correct: false },
        { label: "C", content: html("x = (-b &plusmn; &radic;(b<sup>2</sup> + 4ac)) / 2a"), is_correct: false },
        { label: "D", content: html("x = (-b &plusmn; &radic;(b<sup>2</sup> - 4ac)) / a"), is_correct: false },
      ],
    },
    gu: {
      content: html("દ્વિઘાત સૂત્ર ax<sup>2</sup> + bx + c = 0 ના મૂળો આપે છે:"),
      explanation: html("દ્વિઘાત સૂત્ર x = (-b &plusmn; &radic;(b<sup>2</sup> - 4ac)) / 2a છે."),
      options: [
        { label: "A", content: html("x = (-b &plusmn; &radic;(b<sup>2</sup> - 4ac)) / 2a"), is_correct: true },
        { label: "B", content: html("x = (b &plusmn; &radic;(b<sup>2</sup> - 4ac)) / 2a"), is_correct: false },
        { label: "C", content: html("x = (-b &plusmn; &radic;(b<sup>2</sup> + 4ac)) / 2a"), is_correct: false },
        { label: "D", content: html("x = (-b &plusmn; &radic;(b<sup>2</sup> - 4ac)) / a"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 4 - Quadratic Equations", topic: "4.1 Quadratic Equations", difficulty: "easy",
    tags: ["mathematics", "quadratic-equations"],
    en: {
      content: html("Which of the following is a quadratic equation?"),
      explanation: html("A quadratic equation has the form ax<sup>2</sup> + bx + c = 0 where a &ne; 0."),
      options: [
        { label: "A", content: html("x<sup>2</sup> + 2x + 1 = 0"), is_correct: true },
        { label: "B", content: html("x + 2 = 0"), is_correct: false },
        { label: "C", content: html("x<sup>3</sup> + x + 1 = 0"), is_correct: false },
        { label: "D", content: html("2x + 3 = 0"), is_correct: false },
      ],
    },
    gu: {
      content: html("નીચેના પૈકી કયું દ્વિઘાત સમીકરણ છે?"),
      explanation: html("દ્વિઘાત સમીકરણ ax<sup>2</sup> + bx + c = 0 સ્વરૂપ ધરાવે છે જ્યાં a &ne; 0."),
      options: [
        { label: "A", content: html("x<sup>2</sup> + 2x + 1 = 0"), is_correct: true },
        { label: "B", content: html("x + 2 = 0"), is_correct: false },
        { label: "C", content: html("x<sup>3</sup> + x + 1 = 0"), is_correct: false },
        { label: "D", content: html("2x + 3 = 0"), is_correct: false },
      ],
    },
  },

  // ── Ch 5: Arithmetic Progressions ──
  {
    chapter: "Ch 5 - Arithmetic Progressions", topic: "5.2 nth Term of an AP", difficulty: "easy",
    tags: ["mathematics", "ap"],
    en: {
      content: html("The 10th term of the AP: 2, 5, 8, 11, ... is:"),
      explanation: html("a = 2, d = 3. a<sub>10</sub> = a + 9d = 2 + 9(3) = 29."),
      options: [
        { label: "A", content: html("29"), is_correct: true },
        { label: "B", content: html("26"), is_correct: false },
        { label: "C", content: html("32"), is_correct: false },
        { label: "D", content: html("23"), is_correct: false },
      ],
    },
    gu: {
      content: html("AP: 2, 5, 8, 11, ... નો 10મો પદ છે:"),
      explanation: html("a = 2, d = 3. a<sub>10</sub> = a + 9d = 2 + 9(3) = 29."),
      options: [
        { label: "A", content: html("29"), is_correct: true },
        { label: "B", content: html("26"), is_correct: false },
        { label: "C", content: html("32"), is_correct: false },
        { label: "D", content: html("23"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 5 - Arithmetic Progressions", topic: "5.3 Sum of First n Terms of an AP", difficulty: "medium",
    tags: ["mathematics", "ap"],
    en: {
      content: html("The sum of the first 20 terms of the AP: 1, 4, 7, 10, ... is:"),
      explanation: html("a = 1, d = 3, n = 20. S<sub>20</sub> = n/2 [2a + (n-1)d] = 20/2 [2 + 19(3)] = 10 [59] = 590."),
      options: [
        { label: "A", content: html("590"), is_correct: true },
        { label: "B", content: html("570"), is_correct: false },
        { label: "C", content: html("600"), is_correct: false },
        { label: "D", content: html("580"), is_correct: false },
      ],
    },
    gu: {
      content: html("AP: 1, 4, 7, 10, ... ના પ્રથમ 20 પદોનો સરવાળો છે:"),
      explanation: html("a = 1, d = 3, n = 20. S<sub>20</sub> = n/2 [2a + (n-1)d] = 20/2 [2 + 19(3)] = 10 [59] = 590."),
      options: [
        { label: "A", content: html("590"), is_correct: true },
        { label: "B", content: html("570"), is_correct: false },
        { label: "C", content: html("600"), is_correct: false },
        { label: "D", content: html("580"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 5 - Arithmetic Progressions", topic: "5.1 Arithmetic Progressions", difficulty: "easy",
    tags: ["mathematics", "ap"],
    en: {
      content: html("Which of the following is an arithmetic progression?"),
      explanation: html("In an AP, the difference between consecutive terms is constant (common difference)."),
      options: [
        { label: "A", content: html("2, 4, 8, 16, ..."), is_correct: false },
        { label: "B", content: html("3, 6, 9, 12, ..."), is_correct: true },
        { label: "C", content: html("1, 1, 2, 3, 5, ..."), is_correct: false },
        { label: "D", content: html("1, 4, 9, 16, ..."), is_correct: false },
      ],
    },
    gu: {
      content: html("નીચેના પૈકી કયું અંકશાસ્ત્રીય પ્રગતિ છે?"),
      explanation: html("AP માં, સળંગ પદો વચ્ચેનો તફાવત સ્થિર હોય છે (સામાન્ય ભેદ)."),
      options: [
        { label: "A", content: html("2, 4, 8, 16, ..."), is_correct: false },
        { label: "B", content: html("3, 6, 9, 12, ..."), is_correct: true },
        { label: "C", content: html("1, 1, 2, 3, 5, ..."), is_correct: false },
        { label: "D", content: html("1, 4, 9, 16, ..."), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 5 - Arithmetic Progressions", topic: "5.2 nth Term of an AP", difficulty: "hard",
    tags: ["mathematics", "ap"],
    en: {
      content: html("If the 5th term of an AP is 13 and the 15th term is 33, then the common difference is:"),
      explanation: html("a<sub>5</sub> = a + 4d = 13 and a<sub>15</sub> = a + 14d = 33. Subtracting: 10d = 20, so d = 2."),
      options: [
        { label: "A", content: html("2"), is_correct: true },
        { label: "B", content: html("3"), is_correct: false },
        { label: "C", content: html("1"), is_correct: false },
        { label: "D", content: html("4"), is_correct: false },
      ],
    },
    gu: {
      content: html("જો AP નો 5મો પદ 13 અને 15મો પદ 33 હોય, તો સામાન્ય ભેદ છે:"),
      explanation: html("a<sub>5</sub> = a + 4d = 13 અને a<sub>15</sub> = a + 14d = 33. બાદ કરવાથી: 10d = 20, તો d = 2."),
      options: [
        { label: "A", content: html("2"), is_correct: true },
        { label: "B", content: html("3"), is_correct: false },
        { label: "C", content: html("1"), is_correct: false },
        { label: "D", content: html("4"), is_correct: false },
      ],
    },
  },

  // ── Science Questions ──

  // ── Ch 1: Chemical Reactions and Equations ──
  {
    chapter: "Ch 1 - Chemical Reactions and Equations", topic: "1.1 Chemical Reactions", difficulty: "easy",
    tags: ["science", "chemical-reactions"],
    en: {
      content: html("Which of the following is a sign of a chemical change?"),
      explanation: html("Formation of a precipitate, gas evolution, change in temperature, and color change are signs of a chemical reaction."),
      options: [
        { label: "A", content: html("Change of state"), is_correct: false },
        { label: "B", content: html("Formation of a precipitate"), is_correct: true },
        { label: "C", content: html("Change in shape"), is_correct: false },
        { label: "D", content: html("Dissolving in water"), is_correct: false },
      ],
    },
    gu: {
      content: html("નીચેના પૈકી કયું રાસાયણિક ફેરફારનું સંકેત છે?"),
      explanation: html("અવક્ષેપણનું નિર્માણ, ગેસ ઉત્સર્જન, તાપમાનમાં ફેરફાર, અને રંગમાં ફેરફાર રાસાયણિક પ્રતિક્રિયાના સંકેતો છે."),
      options: [
        { label: "A", content: html("સ્થિતિમાં ફેરફાર"), is_correct: false },
        { label: "B", content: html("અવક્ષેપણનું નિર્માણ"), is_correct: true },
        { label: "C", content: html("આકારમાં ફેરફાર"), is_correct: false },
        { label: "D", content: html("પાણીમાં ઓગળવું"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 1 - Chemical Reactions and Equations", topic: "1.2 Types of Chemical Reactions", difficulty: "medium",
    tags: ["science", "chemical-reactions"],
    en: {
      content: html("The reaction: 2Mg + O<sub>2</sub> &rarr; 2MgO is an example of:"),
      explanation: html("When two or more substances combine to form a single product, it is a combination (synthesis) reaction."),
      options: [
        { label: "A", content: html("Decomposition reaction"), is_correct: false },
        { label: "B", content: html("Combination reaction"), is_correct: true },
        { label: "C", content: html("Displacement reaction"), is_correct: false },
        { label: "D", content: html("Double displacement reaction"), is_correct: false },
      ],
    },
    gu: {
      content: html("પ્રતિક્રિયા: 2Mg + O<sub>2</sub> &rarr; 2MgO નું ઉદાહરણ છે:"),
      explanation: html("જ્યારે બે અથવા વધુ પદાર્થો એક એકલ ઉત્પાદન બનાવે છે, તે સંયોજન (સંશ્લેષણ) પ્રતિક્રિયા છે."),
      options: [
        { label: "A", content: html("વિભાજન પ્રતિક્રિયા"), is_correct: false },
        { label: "B", content: html("સંયોજન પ્રતિક્રિયા"), is_correct: true },
        { label: "C", content: html("વિસ્થાપન પ્રતિક્રિયા"), is_correct: false },
        { label: "D", content: html("દ્વિ-વિસ્થાપન પ્રતિક્રિયા"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 1 - Chemical Reactions and Equations", topic: "1.3 Effects of Oxidation in Everyday Life", difficulty: "medium",
    tags: ["science", "chemical-reactions"],
    en: {
      content: html("Rusting of iron is an example of:"),
      explanation: html("Rusting is a slow oxidation reaction where iron reacts with oxygen and moisture to form hydrated iron oxide (rust)."),
      options: [
        { label: "A", content: html("Reduction"), is_correct: false },
        { label: "B", content: html("Oxidation"), is_correct: true },
        { label: "C", content: html("Displacement"), is_correct: false },
        { label: "D", content: html("Neutralization"), is_correct: false },
      ],
    },
    gu: {
      content: html("લોખંડનું ભડકવું નું ઉદાહરણ છે:"),
      explanation: html("ભડકવું એ ધીમું ઑક્સિડેશન પ્રતિક્રિયા છે જ્યાં લોખંડ ઑક્સિજન અને ભેજ સાથે પ્રતિક્રિયા કરીને હાઇડ્રેટેડ આયર્ન ઓક્સાઇડ (ભડકો) બનાવે છે."),
      options: [
        { label: "A", content: html("ઘટાડો"), is_correct: false },
        { label: "B", content: html("ઑક્સિડેશન"), is_correct: true },
        { label: "C", content: html("વિસ્થાપન"), is_correct: false },
        { label: "D", content: html("સમતોલન"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 1 - Chemical Reactions and Equations", topic: "1.2 Types of Chemical Reactions", difficulty: "easy",
    tags: ["science", "chemical-reactions"],
    en: {
      content: html("In a balanced chemical equation, the law that is obeyed is:"),
      explanation: html("The law of conservation of mass states that matter can neither be created nor destroyed in a chemical reaction."),
      options: [
        { label: "A", content: html("Law of conservation of mass"), is_correct: true },
        { label: "B", content: html("Law of constant proportions"), is_correct: false },
        { label: "C", content: html("Law of multiple proportions"), is_correct: false },
        { label: "D", content: html("Gay-Lussac's law"), is_correct: false },
      ],
    },
    gu: {
      content: html("સમતોલ રાસાયણિક સમીકરણમાં, પાલન થતો નિયમ છે:"),
      explanation: html("પદાર્થ સંરક્ષણનો નિયમ કહે છે કે રાસાયણિક પ્રતિક્રિયામાં પદાર્થ ન તો બનાવી શકાય છે અને ન તો નાશ કરી શકાય છે."),
      options: [
        { label: "A", content: html("પદાર્થ સંરક્ષણનો નિયમ"), is_correct: true },
        { label: "B", content: html("સ્થિર અનુપાતનો નિયમ"), is_correct: false },
        { label: "C", content: html("બહુવિધ અનુપાતનો નિયમ"), is_correct: false },
        { label: "D", content: html("ગે-લુસાકનો નિયમ"), is_correct: false },
      ],
    },
  },

  // ── Ch 2: Acids, Bases and Salts ──
  {
    chapter: "Ch 2 - Acids, Bases and Salts", topic: "2.2 pH Scale", difficulty: "easy",
    tags: ["science", "acids-bases"],
    en: {
      content: html("A solution with pH 3 is:"),
      explanation: html("pH &lt; 7 is acidic, pH = 7 is neutral, pH &gt; 7 is basic. pH 3 is strongly acidic."),
      options: [
        { label: "A", content: html("Strongly acidic"), is_correct: true },
        { label: "B", content: html("Strongly basic"), is_correct: false },
        { label: "C", content: html("Neutral"), is_correct: false },
        { label: "D", content: html("Weakly acidic"), is_correct: false },
      ],
    },
    gu: {
      content: html("pH 3 ધરાવતો દ્રાવણ છે:"),
      explanation: html("pH &lt; 7 અમ્લીય છે, pH = 7 તટસ્થ છે, pH &gt; 7 ક્ષારીય છે. pH 3 મજબૂત અમ્લીય છે."),
      options: [
        { label: "A", content: html("મજબૂત અમ્લીય"), is_correct: true },
        { label: "B", content: html("મજબૂત ક્ષારીય"), is_correct: false },
        { label: "C", content: html("તટસ્થ"), is_correct: false },
        { label: "D", content: html("નબળું અમ્લીય"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 2 - Acids, Bases and Salts", topic: "2.1 Acids and Bases", difficulty: "medium",
    tags: ["science", "acids-bases"],
    en: {
      content: html("Which indicator turns red in acidic solution?"),
      explanation: html("Litmus paper turns red in acidic solutions and blue in basic solutions."),
      options: [
        { label: "A", content: html("Litmus paper"), is_correct: true },
        { label: "B", content: html("Phenolphthalein"), is_correct: false },
        { label: "C", content: html("Methyl orange"), is_correct: false },
        { label: "D", content: html("Turmeric"), is_correct: false },
      ],
    },
    gu: {
      content: html("કયું સૂચક અમ્લીય દ્રાવણમાં લાલ થાય છે?"),
      explanation: html("લિટમસ પેપર અમ્લીય દ્રાવણમાં લાલ અને ક્ષારીય દ્રાવણમાં વાદળી થાય છે."),
      options: [
        { label: "A", content: html("લિટમસ પેપર"), is_correct: true },
        { label: "B", content: html("ફીનોફ્થલીન"), is_correct: false },
        { label: "C", content: html("મિથાઈલ ઓરેન્જ"), is_correct: false },
        { label: "D", content: html("હળદર"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 2 - Acids, Bases and Salts", topic: "2.4 Salts", difficulty: "medium",
    tags: ["science", "acids-bases"],
    en: {
      content: html("Common salt (NaCl) is the product of which reaction?"),
      explanation: html("NaCl is formed by the neutralization reaction between NaOH (base) and HCl (acid)."),
      options: [
        { label: "A", content: html("Neutralization of NaOH and HCl"), is_correct: true },
        { label: "B", content: html("Decomposition of NaHCO<sub>3</sub>"), is_correct: false },
        { label: "C", content: html("Combustion of sodium"), is_correct: false },
        { label: "D", content: html("Electrolysis of water"), is_correct: false },
      ],
    },
    gu: {
      content: html("મીઠું (NaCl) કઈ પ્રતિક્રિયાનું ઉત્પાદન છે?"),
      explanation: html("NaCl NaOH (ક્ષાર) અને HCl (અમ્લ) વચ્ચેની સમતોલન પ્રતિક્રિયા દ્વારા બને છે."),
      options: [
        { label: "A", content: html("NaOH અને HCl નું સમતોલન"), is_correct: true },
        { label: "B", content: html("NaHCO<sub>3</sub> નું વિભાજન"), is_correct: false },
        { label: "C", content: html("સોડિયમનું દહન"), is_correct: false },
        { label: "D", content: html("પાણીનું વિદ્યુત અપघટન"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 2 - Acids, Bases and Salts", topic: "2.3 Chemical Properties of Acids and Bases", difficulty: "hard",
    tags: ["science", "acids-bases"],
    en: {
      content: html("When an acid reacts with a metal carbonate, the products are:"),
      explanation: html("Acid + Metal Carbonate &rarr; Salt + Water + Carbon dioxide."),
      options: [
        { label: "A", content: html("Salt + Water + Carbon dioxide"), is_correct: true },
        { label: "B", content: html("Salt + Water + Hydrogen"), is_correct: false },
        { label: "C", content: html("Salt + Water only"), is_correct: false },
        { label: "D", content: html("Salt + Hydrogen only"), is_correct: false },
      ],
    },
    gu: {
      content: html("જ્યારે અમ્લ ધાતુ કાર્બોનેટ સાથે પ્રતિક્રિયા કરે છે, ત્યારે ઉત્પાદનો છે:"),
      explanation: html("અમ્લ + ધાતુ કાર્બોનેટ &rarr; મીઠું + પાણી + કાર્બન ડાયોક્સાઇડ."),
      options: [
        { label: "A", content: html("મીઠું + પાણી + કાર્બન ડાયોક્સાઇડ"), is_correct: true },
        { label: "B", content: html("મીઠું + પાણી + હાઇડ્રોજન"), is_correct: false },
        { label: "C", content: html("મીઠું + પાણી જ ફક્ત"), is_correct: false },
        { label: "D", content: html("મીઠું + હાઇડ્રોજન જ ફક્ત"), is_correct: false },
      ],
    },
  },

  // ── Ch 3: Metals and Non-metals ──
  {
    chapter: "Ch 3 - Metals and Non-metals", topic: "3.1 Physical Properties", difficulty: "easy",
    tags: ["science", "metals"],
    en: {
      content: html("Which of the following is a non-metal?"),
      explanation: html("Sulphur is a non-metal. Iron, copper, and aluminium are all metals."),
      options: [
        { label: "A", content: html("Iron"), is_correct: false },
        { label: "B", content: html("Copper"), is_correct: false },
        { label: "C", content: html("Sulphur"), is_correct: true },
        { label: "D", content: html("Aluminium"), is_correct: false },
      ],
    },
    gu: {
      content: html("નીચેના પૈકી કયું અધાતુ છે?"),
      explanation: html("સલ્ફર એ અધાતુ છે. લોખંડ, તાંબું, અને એલ્યુમિનિયમ બધા ધાતુઓ છે."),
      options: [
        { label: "A", content: html("લોખંડ"), is_correct: false },
        { label: "B", content: html("તાંબું"), is_correct: false },
        { label: "C", content: html("સલ્ફર"), is_correct: true },
        { label: "D", content: html("એલ્યુમિનિયમ"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 3 - Metals and Non-metals", topic: "3.2 Chemical Properties of Metals", difficulty: "medium",
    tags: ["science", "metals"],
    en: {
      content: html("When sodium is placed in water, it reacts vigorously to form:"),
      explanation: html("2Na + 2H<sub>2</sub>O &rarr; 2NaOH + H<sub>2</sub>. Sodium reacts with cold water to produce sodium hydroxide and hydrogen gas."),
      options: [
        { label: "A", content: html("NaOH and H<sub>2</sub>"), is_correct: true },
        { label: "B", content: html("Na<sub>2</sub>O and H<sub>2</sub>"), is_correct: false },
        { label: "C", content: html("NaH and O<sub>2</sub>"), is_correct: false },
        { label: "D", content: html("Na<sub>2</sub>O<sub>2</sub> and H<sub>2</sub>O"), is_correct: false },
      ],
    },
    gu: {
      content: html("જ્યારે સોડિયમ પાણીમાં મૂકવામાં આવે છે, ત્યારે તે તીવ્ર રીતે પ્રતિક્રિયા કરીને બનાવે છે:"),
      explanation: html("2Na + 2H<sub>2</sub>O &rarr; 2NaOH + H<sub>2</sub>. સોડિયમ ઠંડા પાણી સાથે પ્રતિક્રિયા કરીને સોડિયમ હાઇડ્રોક્સાઇડ અને હાઇડ્રોજન ગેસ ઉત્પન્ન કરે છે."),
      options: [
        { label: "A", content: html("NaOH અને H<sub>2</sub>"), is_correct: true },
        { label: "B", content: html("Na<sub>2</sub>O અને H<sub>2</sub>"), is_correct: false },
        { label: "C", content: html("NaH અને O<sub>2</sub>"), is_correct: false },
        { label: "D", content: html("Na<sub>2</sub>O<sub>2</sub> અને H<sub>2</sub>O"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 3 - Metals and Non-metals", topic: "3.4 Corrosion and its Prevention", difficulty: "easy",
    tags: ["science", "metals"],
    en: {
      content: html("Which metal is used to galvanize iron to prevent rusting?"),
      explanation: html("Galvanization involves coating iron with a layer of zinc to protect it from corrosion."),
      options: [
        { label: "A", content: html("Copper"), is_correct: false },
        { label: "B", content: html("Zinc"), is_correct: true },
        { label: "C", content: html("Tin"), is_correct: false },
        { label: "D", content: html("Aluminium"), is_correct: false },
      ],
    },
    gu: {
      content: html("ભડકો રોકવા માટે લોખંડને ગેલેનાઇઝ કરવા કયું ધાતુ વપરાય છે?"),
      explanation: html("ગેલેનાઇઝેશનમાં લોખંડને ઝિંકની પરતથી ઢાંકવામાં આવે છે જેથી તેને ભડકાથી બચાવી શકાય."),
      options: [
        { label: "A", content: html("તાંબું"), is_correct: false },
        { label: "B", content: html("ઝિંક"), is_correct: true },
        { label: "C", content: html("ટીન"), is_correct: false },
        { label: "D", content: html("એલ્યુમિનિયમ"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 3 - Metals and Non-metals", topic: "3.3 Occurrence and Extraction of Metals", difficulty: "hard",
    tags: ["science", "metals"],
    en: {
      content: html("The process of extracting a metal from its ore is called:"),
      explanation: html("Metallurgy is the process of extracting metals from their ores by reduction."),
      options: [
        { label: "A", content: html("Metallurgy"), is_correct: true },
        { label: "B", content: html("Electrolysis"), is_correct: false },
        { label: "C", content: html("Galvanization"), is_correct: false },
        { label: "D", content: html("Annealing"), is_correct: false },
      ],
    },
    gu: {
      content: html("ધાતુને તેની અયસ્કમાંથી બહાર કાઢવાની પ્રક્રિયા કહેવાય છે:"),
      explanation: html("ધાતુશાસ્ત્ર એ ઘટાડા દ્વારા ધાતુઓને તેમની અયસ્કમાંથી બહાર કાઢવાની પ્રક્રિયા છે."),
      options: [
        { label: "A", content: html("ધાતુશાસ્ત્ર"), is_correct: true },
        { label: "B", content: html("વિદ્યુત અપघટન"), is_correct: false },
        { label: "C", content: html("ગેલેનાઇઝેશન"), is_correct: false },
        { label: "D", content: html("એનિલિંગ"), is_correct: false },
      ],
    },
  },

  // ── Ch 4: Life Processes ──
  {
    chapter: "Ch 4 - Life Processes", topic: "4.1 Nutrition in Living Organisms", difficulty: "easy",
    tags: ["science", "life-processes"],
    en: {
      content: html("The process by which green plants make their own food is called:"),
      explanation: html("Photosynthesis is the process by which green plants use sunlight, CO<sub>2</sub>, and water to produce glucose and oxygen."),
      options: [
        { label: "A", content: html("Respiration"), is_correct: false },
        { label: "B", content: html("Photosynthesis"), is_correct: true },
        { label: "C", content: html("Transpiration"), is_correct: false },
        { label: "D", content: html("Germination"), is_correct: false },
      ],
    },
    gu: {
      content: html("લીલા છોડ પોતાનો ખોરાક બનાવવાની પ્રક્રિયા કહેવાય છે:"),
      explanation: html("પ્રકાશસંશ્લેષણ એ લીલા છોડ સૂર્યપ્રકાશ, CO<sub>2</sub> અને પાણી વડે ગ્લુકોઝ અને ઑક્સિજન બનાવવાની પ્રક્રિયા છે."),
      options: [
        { label: "A", content: html("શ્વસન"), is_correct: false },
        { label: "B", content: html("પ્રકાશસંશ્લેષણ"), is_correct: true },
        { label: "C", content: html("વાષ્પોત્સર્જન"), is_correct: false },
        { label: "D", content: html("અંકુરણ"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 4 - Life Processes", topic: "4.2 Respiration", difficulty: "medium",
    tags: ["science", "life-processes"],
    en: {
      content: html("The organelle responsible for cellular respiration is:"),
      explanation: html("Mitochondria are the powerhouse of the cell, where aerobic respiration takes place."),
      options: [
        { label: "A", content: html("Nucleus"), is_correct: false },
        { label: "B", content: html("Ribosome"), is_correct: false },
        { label: "C", content: html("Mitochondria"), is_correct: true },
        { label: "D", content: html("Chloroplast"), is_correct: false },
      ],
    },
    gu: {
      content: html("કોશિકાલય શ્વસન માટે જવાબદાર અંગાણુ છે:"),
      explanation: html("માઇટોકોન્ડ્રિયા કોશિકાનું પાવરહાઉસ છે, જ્યાં હવાઈ શ્વસન થાય છે."),
      options: [
        { label: "A", content: html("કોષકેંદ્ર"), is_correct: false },
        { label: "B", content: html("રાઇબોસોમ"), is_correct: false },
        { label: "C", content: html("માઇટોકોન્ડ્રિયા"), is_correct: true },
        { label: "D", content: html("હરિતલવક"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 4 - Life Processes", topic: "4.3 Transportation in Human Beings", difficulty: "medium",
    tags: ["science", "life-processes"],
    en: {
      content: html("The chamber of the heart that pumps oxygenated blood to the body is:"),
      explanation: html("The left ventricle pumps oxygenated blood through the aorta to all parts of the body."),
      options: [
        { label: "A", content: html("Right atrium"), is_correct: false },
        { label: "B", content: html("Right ventricle"), is_correct: false },
        { label: "C", content: html("Left atrium"), is_correct: false },
        { label: "D", content: html("Left ventricle"), is_correct: true },
      ],
    },
    gu: {
      content: html("શરીરમાં ઑક્સિજનયુક્ત લોહી પંપ કરતો હૃદયનો ખંડ છે:"),
      explanation: html("ડાબો વેન્ટ્રિકલ ઑક્સિજનયુક્ત લોહીને મહાધમની દ્વારા શરીરના બધા ભાગોમાં પંપ કરે છે."),
      options: [
        { label: "A", content: html("જમણો આટ્રિયમ"), is_correct: false },
        { label: "B", content: html("જમણો વેન્ટ્રિકલ"), is_correct: false },
        { label: "C", content: html("ડાબો આટ્રિયમ"), is_correct: false },
        { label: "D", content: html("ડાબો વેન્ટ્રિકલ"), is_correct: true },
      ],
    },
  },
  {
    chapter: "Ch 4 - Life Processes", topic: "4.4 Excretion in Human Beings", difficulty: "easy",
    tags: ["science", "life-processes"],
    en: {
      content: html("The functional unit of the kidney is:"),
      explanation: html("The nephron is the functional unit of the kidney that filters blood and produces urine."),
      options: [
        { label: "A", content: html("Neuron"), is_correct: false },
        { label: "B", content: html("Nephron"), is_correct: true },
        { label: "C", content: html("Alveoli"), is_correct: false },
        { label: "D", content: html("Villus"), is_correct: false },
      ],
    },
    gu: {
      content: html("મૂત્રપિંડનો કાર્યાત્મક એકમ છે:"),
      explanation: html("નેફ્રોન એ મૂત્રપિંડનો કાર્યાત્મક એકમ છે જે લોહી ફિલ્ટર કરે છે અને પેશાબ ઉત્પન્ન કરે છે."),
      options: [
        { label: "A", content: html("ન્યુરોન"), is_correct: false },
        { label: "B", content: html("નેફ્રોન"), is_correct: true },
        { label: "C", content: html("અલ્વેઓલાઇ"), is_correct: false },
        { label: "D", content: html("વિલસ"), is_correct: false },
      ],
    },
  },

  // ── Ch 5: Control and Coordination ──
  {
    chapter: "Ch 5 - Control and Coordination", topic: "5.1 Nervous System in Human Beings", difficulty: "easy",
    tags: ["science", "control-coordination"],
    en: {
      content: html("The longest cell in the human body is:"),
      explanation: html("The neuron (nerve cell) can be up to 1 meter long, making it the longest cell in the body."),
      options: [
        { label: "A", content: html("Muscle cell"), is_correct: false },
        { label: "B", content: html("Red blood cell"), is_correct: false },
        { label: "C", content: html("Neuron"), is_correct: true },
        { label: "D", content: html("Skin cell"), is_correct: false },
      ],
    },
    gu: {
      content: html("માનવ શરીરની સૌથી લાંબી કોશિકા છે:"),
      explanation: html("ન્યુરોન (સ્નાયુ કોશિકા) 1 મીટર સુધી લાંબી હોઈ શકે છે, જે તેને શરીરની સૌથી લાંબી કોશિકા બનાવે છે."),
      options: [
        { label: "A", content: html("સ્નાયુ કોશિકા"), is_correct: false },
        { label: "B", content: html("લાલ રક્ત કોશિકા"), is_correct: false },
        { label: "C", content: html("ન્યુરોન"), is_correct: true },
        { label: "D", content: html("ચામડી કોશિકા"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 5 - Control and Coordination", topic: "5.3 Hormones in Animals", difficulty: "medium",
    tags: ["science", "control-coordination"],
    en: {
      content: html("The hormone that regulates blood sugar level is:"),
      explanation: html("Insulin is produced by the pancreas and helps regulate blood glucose levels."),
      options: [
        { label: "A", content: html("Thyroxine"), is_correct: false },
        { label: "B", content: html("Adrenaline"), is_correct: false },
        { label: "C", content: html("Insulin"), is_correct: true },
        { label: "D", content: html("Growth hormone"), is_correct: false },
      ],
    },
    gu: {
      content: html("લોહીના ખાંડના સ્તરને નિયંત્રિત કરતું હોર્મોન છે:"),
      explanation: html("ઇન્સ્યુલિન પેન્ક્રિયાસ દ્વારા ઉત્પન્ન થાય છે અને લોહીના ગ્લુકોઝ સ્તરને નિયંત્રિત કરવામાં મદદ કરે છે."),
      options: [
        { label: "A", content: html("થાઇરોક્સિન"), is_correct: false },
        { label: "B", content: html("એડ્રેનાલિન"), is_correct: false },
        { label: "C", content: html("ઇન્સ્યુલિન"), is_correct: true },
        { label: "D", content: html("વૃદ્ધિ હોર્મોન"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 5 - Control and Coordination", topic: "5.2 Coordination in Plants", difficulty: "medium",
    tags: ["science", "control-coordination"],
    en: {
      content: html("The plant hormone that controls the movement of plants towards light is:"),
      explanation: html("Auxin is responsible for phototropism — the growth of plants towards light."),
      options: [
        { label: "A", content: html("Cytokinin"), is_correct: false },
        { label: "B", content: html("Auxin"), is_correct: true },
        { label: "C", content: html("Gibberellin"), is_correct: false },
        { label: "D", content: html("Abscisic acid"), is_correct: false },
      ],
    },
    gu: {
      content: html("છોડને પ્રકાશ તરફ ખસેડવાની ગતિને નિયંત્રિત કરતું છોડ હોર્મોન છે:"),
      explanation: html("ઓક્સિન ફોટોટ્રોપિઝ્મ માટે જવાબદાર છે — છોડનો પ્રકાશ તરફનો વિકાસ."),
      options: [
        { label: "A", content: html("સાઇટોકાઇનિન"), is_correct: false },
        { label: "B", content: html("ઓક્સિન"), is_correct: true },
        { label: "C", content: html("ગિબરેલિન"), is_correct: false },
        { label: "D", content: html("એબ્સિસિક એસિડ"), is_correct: false },
      ],
    },
  },
  {
    chapter: "Ch 5 - Control and Coordination", topic: "5.1 Nervous System in Human Beings", difficulty: "hard",
    tags: ["science", "control-coordination"],
    en: {
      content: html("The part of the brain that controls voluntary actions is:"),
      explanation: html("The cerebrum (forebrain) controls voluntary actions, thinking, reasoning, and memory."),
      options: [
        { label: "A", content: html("Cerebellum"), is_correct: false },
        { label: "B", content: html("Medulla oblongata"), is_correct: false },
        { label: "C", content: html("Cerebrum"), is_correct: true },
        { label: "D", content: html("Pons"), is_correct: false },
      ],
    },
    gu: {
      content: html("સ્વૈચ્છિક ક્રિયાઓને નિયંત્રિત કરતો મગજનો ભાગ છે:"),
      explanation: html("સેરેબ્રમ (અગ્રમગજ) સ્વૈચ્છિક ક્રિયાઓ, વિચારસરણી, દલીલબંધી, અને યાદશક્તિને નિયંત્રિત કરે છે."),
      options: [
        { label: "A", content: html("સેરેબેલમ"), is_correct: false },
        { label: "B", content: html("મેડુલા ઓબ્લોંગાટા"), is_correct: false },
        { label: "C", content: html("સેરેબ્રમ"), is_correct: true },
        { label: "D", content: html("પોન્સ"), is_correct: false },
      ],
    },
  },
];

// ── Seed Logic ───────────────────────────────────────────────────────────────

async function seedChaptersAndTopics() {
  log("\n── Seeding Std 10 Science chapters & topics ──");

  const std10 = await getId("standards", "name", "Std 10");
  const science = await getId("subjects", "name", "Science");
  if (!std10 || !science) {
    log("  ⚠ Std 10 or Science not found — run seedMasterData.js first");
    return {};
  }

  const chapterIds = {};
  for (const ch of CHAPTERS_STD10_SCIENCE) {
    const { data: existing } = await client
      .from("chapters").select("id")
      .eq("subject_id", science).eq("standard_id", std10).eq("name", ch.name)
      .single();

    let chapterId = existing?.id;
    if (!chapterId) {
      const { data: newCh, error } = await client
        .from("chapters")
        .insert({ subject_id: science, standard_id: std10, name: ch.name, number: ch.number, sort_order: ch.number })
        .select("id").single();
      if (error) { log(`  ✗ Chapter error: ${error.message}`); continue; }
      chapterId = newCh.id;
      log(`  + Chapter: ${ch.name}`);
    }
    chapterIds[ch.name] = chapterId;

    for (const t of ch.topics) {
      const { error } = await client
        .from("topics")
        .upsert(
          { chapter_id: chapterId, name: t.name, number: t.number, sort_order: parseFloat(t.number) || 0 },
          { onConflict: "chapter_id,name" }
        );
      if (!error) log(`    + Topic: ${t.name}`);
    }
  }

  // Also ensure Maths chapter IDs are resolved
  const maths = await getId("subjects", "name", "Mathematics");
  if (maths && std10) {
    for (const ch of [
      "Ch 1 - Real Numbers", "Ch 2 - Polynomials",
      "Ch 3 - Pair of Linear Equations in Two Variables",
      "Ch 4 - Quadratic Equations", "Ch 5 - Arithmetic Progressions",
    ]) {
      const { data } = await client
        .from("chapters").select("id")
        .eq("subject_id", maths).eq("standard_id", std10).eq("name", ch)
        .single();
      if (data) chapterIds[ch] = data.id;
    }
  }

  return chapterIds;
}

async function seedQuestions(chapterIds) {
  log("\n── Seeding question families & variants ──");

  const enLang = await getId("languages", "code", "en");
  const guLang = await getId("languages", "code", "gu");
  const std10 = await getId("standards", "name", "Std 10");
  const maths = await getId("subjects", "name", "Mathematics");
  const science = await getId("subjects", "name", "Science");

  // Get a user to satisfy NOT NULL created_by
  const { data: adminUser } = await client.from("users").select("id").limit(1).single();
  const createdBy = adminUser?.id || null;

  if (!enLang || !guLang) {
    log("  ⚠ Languages not found — run seedMasterData.js first");
    return;
  }
  if (!createdBy) {
    log("  ⚠ No users found — run seed.js first to create the super admin");
    return;
  }

  const mathQuestions = MATH_QUESTIONS.filter((q) => q.tags.includes("mathematics"));
  const scienceQuestions = MATH_QUESTIONS.filter((q) => q.tags.includes("science"));

  let familyCount = 0;
  let questionCount = 0;

  // Seed Math questions
  for (const q of mathQuestions) {
    const chapterId = chapterIds[q.chapter];
    if (!chapterId) { log(`  ⚠ Chapter not found: ${q.chapter}`); continue; }

    // Create family
    const { data: family, error: famErr } = await client
      .from("question_families")
      .insert({ created_by: createdBy })
      .select("id").single();
    if (famErr) { log(`  ✗ Family error: ${famErr.message}`); continue; }
    familyCount++;

    // Create English variant
    const { data: enQ, error: enErr } = await client
      .from("questions")
      .insert({
        bank_id: null,
        created_by: createdBy,
        family_id: family.id,
        standard_id: std10,
        subject_id: maths,
        chapter_id: chapterId,
        type: "mcq_single",
        language_id: enLang,
        difficulty: q.difficulty,
        content: q.en.content,
        explanation: q.en.explanation,
        marks: 1,
        status: "published",
        translation_status: "approved",
        tags: q.tags,
      })
      .select("id").single();
    if (enErr) { log(`  ✗ EN question error: ${enErr.message}`); continue; }
    questionCount++;

    // Create English options
    for (let i = 0; i < q.en.options.length; i++) {
      const opt = q.en.options[i];
      await client.from("question_options").insert({
        question_id: enQ.id,
        label: opt.label,
        content: opt.content,
        is_correct: opt.is_correct,
        sort_order: i,
      });
    }

    // Create Gujarati variant
    const { data: guQ, error: guErr } = await client
      .from("questions")
      .insert({
        bank_id: null,
        created_by: createdBy,
        family_id: family.id,
        standard_id: std10,
        subject_id: maths,
        chapter_id: chapterId,
        type: "mcq_single",
        language_id: guLang,
        difficulty: q.difficulty,
        content: q.gu.content,
        explanation: q.gu.explanation,
        marks: 1,
        status: "published",
        translation_status: "translated",
        tags: q.tags,
      })
      .select("id").single();
    if (guErr) { log(`  ✗ GU question error: ${guErr.message}`); continue; }
    questionCount++;

    // Create Gujarati options
    for (let i = 0; i < q.gu.options.length; i++) {
      const opt = q.gu.options[i];
      await client.from("question_options").insert({
        question_id: guQ.id,
        label: opt.label,
        content: opt.content,
        is_correct: opt.is_correct,
        sort_order: i,
      });
    }

    log(`  ✓ Family ${familyCount}: ${q.en.content.html.replace(/<[^>]+>/g, "").slice(0, 60)}...`);
  }

  log(`\n  Math: ${familyCount} families, ${questionCount} questions`);

  // Now seed Science questions
  let scienceFamilyCount = 0;
  let scienceQuestionCount = 0;

  for (const q of scienceQuestions) {
    const chapterId = chapterIds[q.chapter];
    if (!chapterId) { log(`  ⚠ Chapter not found: ${q.chapter}`); continue; }

    const { data: family, error: famErr } = await client
      .from("question_families")
      .insert({ created_by: createdBy })
      .select("id").single();
    if (famErr) { log(`  ✗ Family error: ${famErr.message}`); continue; }
    scienceFamilyCount++;

    const { data: enQ, error: enErr } = await client
      .from("questions")
      .insert({
        bank_id: null,
        created_by: createdBy,
        family_id: family.id,
        standard_id: std10,
        subject_id: science,
        chapter_id: chapterId,
        type: "mcq_single",
        language_id: enLang,
        difficulty: q.difficulty,
        content: q.en.content,
        explanation: q.en.explanation,
        marks: 1,
        status: "published",
        translation_status: "approved",
        tags: q.tags,
      })
      .select("id").single();
    if (enErr) { log(`  ✗ EN question error: ${enErr.message}`); continue; }
    scienceQuestionCount++;

    for (let i = 0; i < q.en.options.length; i++) {
      const opt = q.en.options[i];
      await client.from("question_options").insert({
        question_id: enQ.id,
        label: opt.label,
        content: opt.content,
        is_correct: opt.is_correct,
        sort_order: i,
      });
    }

    const { data: guQ, error: guErr } = await client
      .from("questions")
      .insert({
        bank_id: null,
        created_by: createdBy,
        family_id: family.id,
        standard_id: std10,
        subject_id: science,
        chapter_id: chapterId,
        type: "mcq_single",
        language_id: guLang,
        difficulty: q.difficulty,
        content: q.gu.content,
        explanation: q.gu.explanation,
        marks: 1,
        status: "published",
        translation_status: "translated",
        tags: q.tags,
      })
      .select("id").single();
    if (guErr) { log(`  ✗ GU question error: ${guErr.message}`); continue; }
    scienceQuestionCount++;

    for (let i = 0; i < q.gu.options.length; i++) {
      const opt = q.gu.options[i];
      await client.from("question_options").insert({
        question_id: guQ.id,
        label: opt.label,
        content: opt.content,
        is_correct: opt.is_correct,
        sort_order: i,
      });
    }

    log(`  ✓ Science family ${scienceFamilyCount}: ${q.en.content.html.replace(/<[^>]+>/g, "").slice(0, 60)}...`);
  }

  log(`\n  Science: ${scienceFamilyCount} families, ${scienceQuestionCount} questions`);
  log(`\n  Total: ${familyCount + scienceFamilyCount} families, ${questionCount + scienceQuestionCount} questions`);
}

async function main() {
  if (!client) {
    console.log("Supabase not configured — skipping seed.");
    return;
  }

  console.log("═══════════════════════════════════════════════");
  console.log("  Question Bank Seeder (Paper Generator)");
  console.log("═══════════════════════════════════════════════");

  try {
    const chapterIds = await seedChaptersAndTopics();
    await seedQuestions(chapterIds);

    console.log("\n✓ Question bank seed complete!");
    console.log("  You can now create papers from the Paper Generator.");
  } catch (err) {
    console.error("\n✗ Seed failed:", err);
    process.exit(1);
  }
}

main();
