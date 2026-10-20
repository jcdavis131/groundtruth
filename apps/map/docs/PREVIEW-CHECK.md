# The preview pass

`apps/map/scripts/live-check.mjs` is the preview pass as a script. A map PR's preview gets the same four checks every time. The human look at the preview stays Cam's; this script does not stand in for it.

## What it checks

Each line is one assertion, counted in the last line (`live-check: N assertions, M failed`). Exit code 1 on any failure, 2 on a usage error.

| Check | Fails when |
|---|---|
| Front door: `GET /` answers 200 itself, and the server HTML has an `<h1>` | any other status. A redirect is not followed: a 3xx fails both assertions and the message names the host it points to, so a protected preview that sends you to a login page cannot pass on the login page's `<h1>`. Also fails with no `<h1>` before JavaScript runs |
| `POST /api/mcp` `initialize` carries `instructions` | the field is missing or empty |
| `tools/list` names exactly `EXPECTED_TOOL_NAMES` (`lib/mcp/expectedTools.mjs`, the list `lib/mcp/server.test.ts` also uses) | a name is missing or an unlisted tool appears; the message names it |
| `_meta["anthropic/alwaysLoad"]` is true on `world_context` and on no other tool | any other count or name |
| `world_context {"fips":"01097"}` (the recorded fixture place, `lib/mcp/__fixtures__/world/mobile_01097.json`) has the baseline's shape | top-level keys, a topic's keys or item count, or `coverageStatus.status` differ. Values may differ |

The shape comparison is strict on item counts. Live feeds can move them, and a sub-route that times out on one side (production's dams route did once while this was written) shows as a diff. Re-run once before reading it as a regression, and read the named topic.

## Running it

```
node apps/map/scripts/live-check.mjs <origin> [--cookie-jar <file>] [--bypass-header] [--baseline <file | origin>] [--ref <deployment id | head sha>]
```

- `--baseline` is master's reply. By default it is `scripts/live-check.baseline.01097.json`, the shape recorded from `https://www.arxiviq.com` on 2026-10-20 (production serves master). To compare against master as it is now, pass `--baseline https://www.arxiviq.com`; the baseline is fetched with no credentials. Re-record with `--record-baseline <file>` after a PR that changes the reply's shape on purpose.
- `--cookie-jar` sends the cookies in a curl cookie jar for the origin's host.
- `--bypass-header` sends `x-vercel-protection-bypass` with the value of the `VERCEL_AUTOMATION_BYPASS_SECRET` environment variable. The value is never a command-line argument and is never printed.
- `--ref` names what this run checked (see the run id, below).

## How the loop runs it on a protected preview

Two rules, both from the finding that led to PR #36 (a preview could not answer `world_context` because its own sub-requests were refused). Two separate things need credentials:

1. **The loop's own requests to the preview** (front door, `/api/mcp`). They use a share link or the automation header. With a share link: open `https://<preview>/?_vercel_share=<token>` once with `curl -c jar.txt -L`, which stores the cookies Vercel sets, then pass `--cookie-jar jar.txt`; the jar is sent whole for the preview's host. Where the loop holds the automation secret instead, export `VERCEL_AUTOMATION_BYPASS_SECRET` and pass `--bypass-header`.
2. **The server's sub-requests from `/api/mcp` to its own origin.** The script cannot supply these. PR #36 put them in the route's own code: `app/api/mcp/route.ts` adds the bypass header itself, only on a preview, only to its own origin, from the deployment's `VERCEL_AUTOMATION_BYPASS_SECRET`. If that secret is not enabled in the project, `world_context` answers `auth refusal` on a preview and the last two assertions fail. That is the check working, not a script bug.

```
curl -sSL -c jar.txt "https://<preview>/?_vercel_share=<token>" -o /dev/null
node apps/map/scripts/live-check.mjs https://<preview> --cookie-jar jar.txt --baseline https://www.arxiviq.com --ref dpl_xxx
```

With no credentials at all, a protected preview answers `GET /` with a 302 to `vercel.com/sso-api` and `POST /api/mcp` with 401 (both seen on this PR's own preview). The script then fails every assertion and exits 1. That is the expected result of running it without a share link or the header, not a finding about the change under test.

## The run id and the ledger

Every run prints one line before the checks: `live-check-run: <origin> ref=<ref> at=<ISO timestamp>`. Pass `--ref` with the preview's deployment id (`dpl_...`) or the PR head sha; without it the line says `ref=none`. A map merge's ledger row takes three things from the run: that `live-check-run:` line, the exit code, and the closing `live-check: N assertions, M failed (<origin>)` line.

**No ledger exists in this repo yet.** A search of the tracked files for "ledger" finds this document and unrelated hits (a company name in a data file, a note in an eval folder), and this PR adds no workflow step and no ledger file. So "the script's run id in every map merge's ledger row" is a step the merging loop has to do, once there is a ledger to put it in. This PR gives that step something to record; it cannot close the step by itself.

## What has and has not been run

The stubbed-preview tests (`scripts/live-check.test.ts`) run in CI (`.github/workflows/map-ci.yml`). They cover the cookie-jar and bypass-header paths, a missing tool name, a redirect on `/`, the run-id line, and the shape comparison.

Not run by the builder, because the share-link token and `VERCEL_AUTOMATION_BYPASS_SECRET` are not on the box that wrote this: the script with credentials against a real preview. So the share-link recipe above and the sub-request bypass end to end are untested here. The PR body has the uncredentialed result against this PR's preview.
