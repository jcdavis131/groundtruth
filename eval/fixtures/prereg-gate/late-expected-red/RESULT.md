# TEST FIXTURE, not a result: the prereg gate's failing case

Prereg: sha256 1f6cf84f8ae21acb67eec276a0daa1cf1cc5a9829aa47ee90d80a5a66d31b559 (groundtruth#15, the witness comment for the world_context v3 eval)

This folder is built to fail. Its hash comment is real (created at 2026-10-19T19:18:37Z, in the recorded `prereg-comments.json`), and its `run-t1-C.log` has a first line stamped 2026-10-19T19:10:00Z, 8 minutes before that comment. That timestamp is constructed for the test; no run began then. The gate must say the hash was posted at or after the first plan and exit 1.

`node eval/prereg-gate.mjs --root eval/fixtures/prereg-gate/late-expected-red` exits 1, and `eval/prereg-gate.test.mjs` asserts it.
