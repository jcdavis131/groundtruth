# TEST FIXTURE, not a result: the prereg gate's passing case

Prereg: sha256 1f6cf84f8ae21acb67eec276a0daa1cf1cc5a9829aa47ee90d80a5a66d31b559 (groundtruth#15, the witness comment for the world_context v3 eval)

What this folder is, so nobody reads it as an eval:

- `prereg-comments.json` is the recorded output of `gh api repos/jcdavis131/groundtruth/issues/15/comments --paginate`, the same three comments as `scripts/fixtures/prereg-issue15-comments.json`. The comment that carries the hash above was created at 2026-10-19T19:18:37Z.
- `run-t1-C.log` is the first line of the v3 run's own `run-t1-C.log`, timestamp and all (19:19:18Z, 41 seconds after the comment). Nothing else of that run is here.

`node eval/prereg-gate.mjs --root eval/fixtures/prereg-gate/early-ok` passes.
