#!/usr/bin/env bash
# The snapshot cron's data branch. master is protected (pull requests only,
# admins included), so the Actions bot cannot push samples there: 56 of 56
# runs failed with GH006 between 2026-09-16 and 2026-09-29. The samples live
# on an unprotected orphan branch instead, which holds data/series and a
# vercel.json that turns deployments of that branch off. The app reads it
# over HTTP through GEV_SERIES_RAW_BASE (lib/series/githubRaw.ts).
#
#   scripts/snapshot-branch.sh restore   put the branch's series files into ./data/series
#                                        so the collectors append to the history
#   scripts/snapshot-branch.sh publish   copy ./data/series back, commit, push the branch
#
# Env: SERIES_BRANCH (default "series"), SERIES_REMOTE (default "origin"),
# SERIES_DIR (default "$RUNNER_TEMP/series-branch" or a temp dir).
set -euo pipefail

BRANCH="${SERIES_BRANCH:-series}"
REMOTE="${SERIES_REMOTE:-origin}"
DIR="${SERIES_DIR:-${RUNNER_TEMP:-$(mktemp -d)}/series-branch}"

open_branch() {
  if [ -e "$DIR/.git" ]; then
    return 0
  fi
  if git fetch --quiet --depth=1 "$REMOTE" "$BRANCH" 2>/dev/null; then
    git worktree add --quiet --force -B "$BRANCH" "$DIR" FETCH_HEAD
  else
    # First run: an empty orphan branch. (`worktree add --orphan` needs git
    # 2.42; this form works on older ones too.)
    git worktree add --quiet --detach "$DIR"
    git -C "$DIR" checkout --quiet --orphan "$BRANCH"
    git -C "$DIR" rm -rfq --ignore-unmatch .
  fi
}

case "${1:-}" in
  restore)
    open_branch
    mkdir -p data/series
    if [ -d "$DIR/data/series" ]; then
      cp -R "$DIR/data/series/." data/series/
      echo "restored $(find "$DIR/data/series" -type f | wc -l | tr -d ' ') files from $BRANCH"
    else
      echo "$BRANCH has no data/series yet; starting fresh"
    fi
    ;;
  publish)
    open_branch
    mkdir -p "$DIR/data/series"
    cp -R data/series/. "$DIR/data/series/"
    # This branch is data only: never build or deploy it.
    printf '{\n  "git": { "deploymentEnabled": false }\n}\n' > "$DIR/vercel.json"
    cd "$DIR"
    git add -A data/series vercel.json
    if git diff --cached --quiet; then
      echo "nothing to commit"
      exit 0
    fi
    git -c user.name="gev-snapshot[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
      commit --quiet -m "snapshot: $(date -u +%Y-%m-%dT%H:%MZ) [skip ci]"
    # The concurrency group keeps runs apart; this covers a manual push in between.
    for attempt in 1 2 3; do
      if git push --quiet "$REMOTE" "HEAD:refs/heads/$BRANCH"; then
        echo "pushed $(git rev-parse --short HEAD) to $BRANCH"
        exit 0
      fi
      git fetch --quiet "$REMOTE" "$BRANCH" && git rebase --quiet FETCH_HEAD
    done
    echo "push to $BRANCH failed after 3 attempts" >&2
    exit 1
    ;;
  *)
    echo "usage: $0 restore|publish" >&2
    exit 2
    ;;
esac
