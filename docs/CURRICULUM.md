# Original primary practice survey (draft)

This is a **pending teacher review** practice bank, not a claim to deliver an accredited, textbook-aligned or pedagogically complete six-year curriculum. Its coverage map has all 18 grade × subject combinations: grades 1–6, mathematics, Chinese and English. Each combination contains six ordered units, each with an explicit learning goal and predecessor. The 108 units contain 288 original single-choice questions: mathematics 144 (four per unit), Chinese 72 and English 72 (two per unit). No textbook passages were copied or downloaded. English progression starts with exposure in grade 1; this does not imply alignment with a school system that starts English later.

The generated catalog is `shared/quiz/curriculum/generated/curriculum.draft.json`. Unit fields include `id`, `grade`, `subject`, `title`, `learningGoals`, `recommendedOrder`, `prerequisiteUnitIds`, `stage`, `answerInvariant`, `reviewStatus` and `questions`. Questions use the existing version 1 single-choice shape. `foundation` selects units 1–2, `developing` selects 3–4, and `consolidation` selects 5–6. These are recommended sequence groups, **not adaptive mastery estimates or formally calibrated difficulty levels**. There are 54 separately importable stage packs. Their filenames and metadata clearly label draft status. For strict existing bank validators, pass only `{version: pack.version, questions: pack.questions}`; the surrounding draft metadata must remain visible in any UI.

Run:

```sh
node --test tests/curriculum.test.mjs
node scripts/build-curriculum.mjs
# Optional output directory:
node scripts/build-curriculum.mjs --out /tmp/beaa-curriculum
```

The build verifies coverage, unique IDs, official bank schema, distinct choices and deterministic content. The independent numeric fixtures check the first exercise from every mathematics family. Numeric exercises have recomputable answers and worked explanations. Chinese and English use original curated items covering recognition, sentence meaning, reading evidence, editing and practical language. Correct option positions rotate deterministically. Rebuilding gives identical content and digests; validators reject mutations rather than silently accepting a drifted answer key.

## Teacher review and production release

The draft build emits `review-request.json` with a SHA-256 digest for the entire catalog, every unit and every question. Its reviewer and date are null and it contains **no approval decisions**. It is an inventory for review, not a certificate. Reviewers must examine goals, order, age suitability, correctness, distractors, language ambiguity and explanation for every entry. To prepare a manifest, preserve schemaVersion and curriculumDigest, set `reviewerId` and an actual `reviewedAt` date (YYYY-MM-DD), and add `decisions`, one entry for each request entry with the same `id`, `kind`, `digest` and an explicit `status: "approved"`. A rejection or unresolved correction blocks release. Edit source, rebuild and review again when content changes.

The operator must provision a separate JSON array of trusted teacher reviewer IDs, from an institution-controlled identity process. **Never infer trust from a reviewer name inside a submitted manifest.** The gate validates membership but is not an identity provider or digital signature system; a caller who controls both files can fabricate a review. Protect the trusted registry and release command using operational access controls. No real teacher review has been performed or fabricated in this repository.

```sh
node scripts/build-curriculum.mjs --release \
  --review /secure/teacher-review.json \
  --trusted-reviewers /secure/trusted-teachers.json \
  --out /tmp/beaa-reviewed
```

Missing reviews, unknown reviewers, missing/duplicate decisions, non-approved entries and stale digests fail before writing any release output. A successful gate creates `curriculum.released.json` with review provenance and a plain version 1 bank. Each new content revision requires a matching review. The script never publishes, uploads or marks draft source files reviewed.

## Limits and remaining educational work

Six broad units per grade and subject provide a browsable coverage survey and usable short practice sets, not exhaustive semester lessons. Two language questions per unit cannot establish mastery. Mathematics family variants mostly change quantities; they are not independent evidence of broad transfer. Examples within geometry, probability and measurement assess selected subskills rather than every concept named by the topic. Grade 1 geometry examples assume counting support rather than taught multiplication. Reading texts are deliberately short original examples, and this bank does not assess oral fluency, listening, handwriting, extended composition, proofs, projects or free-response reasoning. It needs teacher expansion, local standards mapping, accessibility review, assessment calibration and classroom trials before school use. Draft availability must never be represented as teacher approval or complete curriculum certification.
