import { client } from "./supabase.js";

/**
 * Seeds master data for the Question Bank module.
 * Run: node server/seedMasterData.js
 *
 * Idempotent — safe to run multiple times.
 */

const STANDARDS = [
  { name: "Std 1", sort_order: 1 },
  { name: "Std 2", sort_order: 2 },
  { name: "Std 3", sort_order: 3 },
  { name: "Std 4", sort_order: 4 },
  { name: "Std 5", sort_order: 5 },
  { name: "Std 6", sort_order: 6 },
  { name: "Std 7", sort_order: 7 },
  { name: "Std 8", sort_order: 8 },
  { name: "Std 9", sort_order: 9 },
  { name: "Std 10", sort_order: 10 },
  { name: "Std 11", sort_order: 11 },
  { name: "Std 12", sort_order: 12 },
];

const SUBJECTS = [
  { name: "Mathematics", icon: "📐", color: "#3B82F6", sort_order: 1 },
  { name: "Science", icon: "🔬", color: "#10B981", sort_order: 2 },
  { name: "English", icon: "📚", color: "#8B5CF6", sort_order: 3 },
  { name: "Social Science", icon: "🌍", color: "#F59E0B", sort_order: 4 },
  { name: "Gujarati", icon: "📖", color: "#EF4444", sort_order: 5 },
  { name: "Hindi", icon: "📝", color: "#F97316", sort_order: 6 },
  { name: "Computer Science", icon: "💻", color: "#06B6D4", sort_order: 7 },
  { name: "Physical Education", icon: "⚽", color: "#84CC16", sort_order: 8 },
];

const EXAM_TYPES = [
  { name: "Board Exam (GSEB)", category: "board", sort_order: 1 },
  { name: "Board Exam (CBSE)", category: "board", sort_order: 2 },
  { name: "Board Exam (ICSE)", category: "board", sort_order: 3 },
  { name: "Unit Test", category: "unit", sort_order: 4 },
  { name: "Semester Exam", category: "unit", sort_order: 5 },
  { name: "Mid-Term Exam", category: "unit", sort_order: 6 },
  { name: "Final Exam", category: "unit", sort_order: 7 },
  { name: "Practice / Homework", category: "practice", sort_order: 8 },
  { name: "Competitive (JEE)", category: "competitive", sort_order: 9 },
  { name: "Competitive (NEET)", category: "competitive", sort_order: 10 },
  { name: "Competitive (GUJCET)", category: "competitive", sort_order: 11 },
  { name: "Olympiad", category: "competitive", sort_order: 12 },
];

const LANGUAGES = [
  { code: "en", name: "English", native_name: "English" },
  { code: "gu", name: "Gujarati", native_name: "ગુજરાતી" },
  { code: "hi", name: "Hindi", native_name: "हिन्दी" },
  { code: "bi", name: "Bilingual (EN+GU)", native_name: "Bilingual" },
];

const QUESTION_LEVELS = [
  { code: "easy", name: "Easy", color: "#10B981", icon: "🟢", sort_order: 1 },
  { code: "medium", name: "Medium", color: "#F59E0B", icon: "🟡", sort_order: 2 },
  { code: "hard", name: "Hard", color: "#EF4444", icon: "🔴", sort_order: 3 },
  { code: "expert", name: "Expert", color: "#6B21A8", icon: "⚫", sort_order: 4 },
];

// Sample chapters and topics for Std 10 Mathematics (GSEB board)
const CHAPTERS_STD10_MATHS = [
  {
    name: "Ch 1 - Real Numbers",
    number: 1,
    topics: [
      { name: "1.1 Euclid's Division Lemma", number: "1.1" },
      { name: "1.2 The Fundamental Theorem of Arithmetic", number: "1.2" },
      { name: "1.3 Revisiting Irrational Numbers", number: "1.3" },
      { name: "1.4 Revisiting Rational Numbers and Their Decimal Expansions", number: "1.4" },
    ],
  },
  {
    name: "Ch 2 - Polynomials",
    number: 2,
    topics: [
      { name: "2.1 Geometrical Meaning of the Zeroes of a Polynomial", number: "2.1" },
      { name: "2.2 Relationship between Zeroes and Coefficients of a Polynomial", number: "2.2" },
      { name: "2.3 Division Algorithm for Polynomials", number: "2.3" },
    ],
  },
  {
    name: "Ch 3 - Pair of Linear Equations in Two Variables",
    number: 3,
    topics: [
      { name: "3.1 Pair of Linear Equations in Two Variables", number: "3.1" },
      { name: "3.2 Graphical Method of Solution", number: "3.2" },
      { name: "3.3 Algebraic Methods of Solving", number: "3.3" },
      { name: "3.4 Equations Reducible to Linear Form", number: "3.4" },
    ],
  },
  {
    name: "Ch 4 - Quadratic Equations",
    number: 4,
    topics: [
      { name: "4.1 Quadratic Equations", number: "4.1" },
      { name: "4.2 Solution of a Quadratic Equation by Factorisation", number: "4.2" },
      { name: "4.3 Solution of a Quadratic Equation by Completing the Square", number: "4.3" },
      { name: "4.4 Nature of Roots", number: "4.4" },
    ],
  },
  {
    name: "Ch 5 - Arithmetic Progressions",
    number: 5,
    topics: [
      { name: "5.1 Arithmetic Progressions", number: "5.1" },
      { name: "5.2 nth Term of an AP", number: "5.2" },
      { name: "5.3 Sum of First n Terms of an AP", number: "5.3" },
    ],
  },
];

async function seedSupabase() {
  if (!client) {
    console.log("Supabase not configured — skipping seed.");
    return;
  }

  console.log("Seeding master data into Supabase...");

  // 1. Standards
  for (const s of STANDARDS) {
    const { error } = await client.from("standards").upsert(s, { onConflict: "name" });
    if (error) console.error(`  standards error: ${error.message}`);
  }
  console.log(`  ✓ Standards: ${STANDARDS.length} seeded`);

  // 2. Subjects
  for (const s of SUBJECTS) {
    const { error } = await client.from("subjects").upsert(s, { onConflict: "name" });
    if (error) console.error(`  subjects error: ${error.message}`);
  }
  console.log(`  ✓ Subjects: ${SUBJECTS.length} seeded`);

  // 3. Exam Types
  for (const e of EXAM_TYPES) {
    const { error } = await client.from("exam_types").upsert(e, { onConflict: "name" });
    if (error) console.error(`  exam_types error: ${error.message}`);
  }
  console.log(`  ✓ Exam Types: ${EXAM_TYPES.length} seeded`);

  // 4. Languages
  for (const l of LANGUAGES) {
    const { error } = await client.from("languages").upsert(l, { onConflict: "code" });
    if (error) console.error(`  languages error: ${error.message}`);
  }
  console.log(`  ✓ Languages: ${LANGUAGES.length} seeded`);

  // 5. Question Levels
  for (const l of QUESTION_LEVELS) {
    const { error } = await client.from("question_levels").upsert(l, { onConflict: "code" });
    if (error) console.error(`  question_levels error: ${error.message}`);
  }
  console.log(`  ✓ Question Levels: ${QUESTION_LEVELS.length} seeded`);

  // 5. Chapters & Topics for Std 10 Mathematics
  // Get the IDs we need
  const { data: std10 } = await client.from("standards").select("id").eq("name", "Std 10").single();
  const { data: maths } = await client.from("subjects").select("id").eq("name", "Mathematics").single();

  if (std10 && maths) {
    let chapterCount = 0;
    let topicCount = 0;

    for (const ch of CHAPTERS_STD10_MATHS) {
      const { data: existingCh } = await client
        .from("chapters")
        .select("id")
        .eq("subject_id", maths.id)
        .eq("standard_id", std10.id)
        .eq("name", ch.name)
        .single();

      let chapterId;
      if (existingCh) {
        chapterId = existingCh.id;
      } else {
        const { data: newCh, error: chErr } = await client
          .from("chapters")
          .insert({
            subject_id: maths.id,
            standard_id: std10.id,
            name: ch.name,
            number: ch.number,
            sort_order: ch.number,
          })
          .select("id")
          .single();
        if (chErr) {
          console.error(`  chapter error: ${chErr.message}`);
          continue;
        }
        chapterId = newCh.id;
        chapterCount++;
      }

      for (const t of ch.topics) {
        const { error: tErr } = await client
          .from("topics")
          .upsert(
            { chapter_id: chapterId, name: t.name, number: t.number, sort_order: parseFloat(t.number) || 0 },
            { onConflict: "chapter_id,name" }
          );
        if (!tErr) topicCount++;
      }
    }

    console.log(`  ✓ Chapters: ${chapterCount} seeded (Std 10 Maths)`);
    console.log(`  ✓ Topics: ${topicCount} seeded (Std 10 Maths)`);
  }

  console.log("\nMaster data seed complete!");
}

async function main() {
  try {
    await seedSupabase();
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  }
}

main();
