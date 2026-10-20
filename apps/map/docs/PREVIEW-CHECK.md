# The preview pass

`apps/map/scripts/live-check.mjs` is the preview pass as a script. A map PR's preview gets the same four checks every time, and the run's output goes in the merge's ledger row. The human look at the preview stays Cam's; this script does not stand in for it.

## What it checks

Each line is one assertion, counted in the last line (`live-check: N assertions, M failed`). Exit code 1 on any failure, 2 on a usage error.

| Check | Fails when |
|---|---|
| Front door: `GET /` answers 200 and the server HTML has an `<h1>` | any other status, or no `<h1>` before JavaScript runs |
| `POST /api/mcp` `initialize` carries `instructions` | the field is missing or empty |
| `tools/list` names exactly `EXPECTED_TOOL_NAMES` (`lib/mcp/expectedTools.mjs`, the list `lib/mcp/server.test.ts` also uses) | a name is missing or an unlisted tool appears; the message names it |
| `_meta["anthropic/alwaysLoad"]` is true on `world_context` and on no other tool | any other count or name |
| `world_context {"fips":"01097"}` (the recorded fixture place, `lib/mcp/__fixtures__/world/mobile_01097.json`) has the baseline's shape | top-level keys, a topic's keys or item count, or `coverageStatus.status` differ. Values may differ |

The shape comparison is strict on item counts. Live feeds can move them, and a sub-route that times out on one side (production's dams route did once while this was written) shows as a diff. Re-run once before reading it as a regression, and read the named topic.

## Running it

```
node apps/map/scripts/live-check.mjs <origin> [--cookie-jar <file>] [--bypass-header] [--baseline <file | origin>]
```

- `--baseline` is master's reply. By default it is `scripts/live-check.baseline.01097.json`, the shape recorded from `https://www.arxiviq.com` on 2026-10-20 (production serves master). To compare against master as it is now, pass `--baseline https://www.arxiviq.com`; the baseline is fetched with no credentials. Re-record with `--record-baseline <file>` after a PR that changes the reply's shape on purpose.
- `--cookie-jar` sends the cookies a share link set, for the origin's host.
- `--bypass-header` sends `x-vercel-protection-bypass` with the value of the `VERCEL_AUTOMATION_BYPASS_SECRET` environment variable. The value is never a command-line argument and is never printed.

## How the loop runs it on a protected preview

The rules are in `writeups/jev-2026-10-18/PREVIEW-TESTABILITY.md`. Two separate things need credentials:

1. **The loop's own requests to the preview** (front door, `/api/mcp`). Use a share link: open `https://<preview>/?_vercel_share=<token>` once with `curl -c jar.txt -L`, which stores the `_vercel_share` / `_vercel_jwt` cookies, then pass `--cookie-jar jar.txt`. Or, where the loop holds the automation secret, export it and pass `--bypass-header`.
2. **The server's sub-requests from `/api/mcp` to its own origin.** The script cannot supply these. `app/api/mcp/route.ts` adds the bypass header itself, only on a preview, only to its own origin, from the deployment's `VERCEL_AUTOMATION_BYPASS_SECRET`. If that secret is not enabled in the project, `world_context` answers `auth refusal` on a preview and the last two assertions fail. That is the check working, not a script bug.

```
curl -sSL -c jar.txt "https://<preview>/?_vercel_share=<token>" -o /dev/null
node apps/map/scripts/live-check.mjs https://<preview> --cookie-jar jar.txt --baseline https://www.arxiviq.com
```

Put the origin, the exit code and the `live-check: N assertions, M failed` line in the merge's ledger row.

## What has and has not been run

Run: the script against production (`https://www.arxiviq.com`), 10 assertions, 0 failed, exit 0, 2026-10-20; and its tests (`scripts/live-check.test.ts`) in CI with a stubbed preview.

Not run: any live preview. The share-link token and the automation secret are not on the box that wrote this, so the cookie-jar and bypass paths are tested only against the stub, and the sub-request bypass is untested end to end until a preview is run with the secret.
