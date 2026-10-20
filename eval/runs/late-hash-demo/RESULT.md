# DEMONSTRATION, not a result: a copy of eval/fixtures/prereg-gate/late-expected-red

Prereg: sha256 1f6cf84f8ae21acb67eec276a0daa1cf1cc5a9829aa47ee90d80a5a66d31b559 (groundtruth#15)

This folder is here for one commit, so the added eval.yml step scans a RESULT.md whose hash comment (created 2026-10-19T19:18:37Z, in the recorded `prereg-comments.json`) is later than its first run-log line (2026-10-19T19:10:00Z, constructed for the test). The step must fail on it. The next commit removes the folder; the permanent copy is under eval/fixtures, which the step skips by name and `eval/prereg-gate.test.mjs` asserts fails.
