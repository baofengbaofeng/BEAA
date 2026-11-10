# Shared mixed question protocol

Version 1 remains strictly `single_choice` with option IDs. Version 2 supports `single_choice`, `true_false`, `numeric`, `fraction`, and `numeric_tolerance` in the same bank. Selection, pinned attempt snapshots, atomic progress, history, guardian receipts, and SQLite reference stores use the trusted shared grader.

```json
{"version":2,"questions":[
 {"id":"half","grade":3,"subject":"math","type":"fraction","stem":"Write one half.","correctAnswer":"1/2","explanation":"One divided by two.","knowledgePoints":["fractions"]},
 {"id":"measure","grade":3,"subject":"math","type":"numeric_tolerance","stem":"Measure approximately.","correctAnswer":"2.5","absoluteTolerance":"0.1","explanation":"Accept 2.4 through 2.6.","knowledgePoints":["measurement"]}
]}
```

Choice types retain `options:[{"id":"yes","text":"正确"},{"id":"no","text":"错误"}]` and `correctOptionId:"yes"`. Boolean questions require exactly those two labels in that order. Scalar types omit both choice fields and require canonical string `correctAnswer`. Only tolerance questions have `absoluteTolerance`, a canonical nonnegative decimal string. Unknown or inappropriate fields fail validation.

`submitQuizAnswer(attempt,{questionId:"half",chosen:"2/4"})` stores canonical `chosen:"1/2"`. Malformed responses fail without mutation. Decimal grading and inclusive absolute tolerance use integer millionths, never floating point. Fraction input reduces equivalent fractions; numerator and denominator magnitude are bounded to one billion, denominator cannot be zero. Decimal bounds match the preview contract: 12 integer digits, 6 fractional digits, 48 UTF16 code units. Answer keys must already be canonical.

`evaluateQuestionResponse(question,input)` returns `{valid,correct,value}`. `questionBankVersion(questions)` selects the required pinned bank version. `exportBrowserQuestionBank` converts scalar `correctAnswer` into client `answer` and preserves tolerance/type; option IDs convert to their original option indexes. Public question views omit answer keys. Feedback and wrong-answer records expose `correctAnswer` for scalar questions, `correctOptionId` for choices.

The shared ledger retains its existing first-answer progression: each valid submission advances the question and freezes its first score. Invalid responses consume no revision. Client correction workflows must retain that first result and must not submit a correction as a fresh ledger question. The reference ledger does not currently persist a separate correction-completion state. This is a remaining protocol limitation, not an assertion of correction parity.

SQLite workers need no database format migration: the JavaScript boundary validates typed business snapshots before CAS and after reads; Python validates the storage envelope, identity, revisions and transactions. Existing single-choice snapshots remain readable. Coverage: `shared/quiz/mixed-v2.test.mjs`, `shared/domain/mixed-v2.test.mjs`, and `tests/sqlite-mixed-v2.test.mjs`.
