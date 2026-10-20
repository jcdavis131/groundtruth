#!/usr/bin/env bash
# The rules' mutation proof. For each break in scripts/rule-mutate.mjs: apply it, run only the test files
# it names, record killed (a test failed), survived (all passed) or not-applied (the anchor moved, or the
# break does not even load), and put the file's exact bytes back. Prints the kill table and exits 1 if
# any break survived or could not be applied, or if the unbroken baseline fails.
#
# The baseline runs first. A change that itself breaks a rule (the #58 `: 0` put back, say) then fails
# here with the name of the test that bites, before the anchors are looked at; an anchor that merely
# moved fails at --check afterwards.
#
# Run from anywhere (CI: .github/workflows/rule-mutations.yml, after npm ci in apps/map). Writes
# rule-mutations.md and rule-mutations.json (the recorded kill table that scripts/rules-table.test.mjs
# --table reads) and per-break logs under $RULE_MUT_DIR (default: a new temp directory).
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
ROOT="$(cd ../.. && pwd)"
OUT_DIR="${RULE_MUT_DIR:-$(mktemp -d)}"
OUT="${RULE_MUT_OUT:-$OUT_DIR/rule-mutations.md}"
JSON="${RULE_MUT_JSON:-$OUT_DIR/rule-mutations.json}"
LOGS="${RULE_MUT_LOGS:-$OUT_DIR/logs}"
TSV="$LOGS/results.tsv"
export RULE_MUT_STATE="${RULE_MUT_STATE:-$OUT_DIR/state}"
export RULE_MUT_CHECKOUT="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
export RULE_MUT_SHA="${RULE_MUT_SHA:-$RULE_MUT_CHECKOUT}"
mkdir -p "$LOGS" "$RULE_MUT_STATE"
MUT=(node scripts/rule-mutate.mjs)

# Whatever happens, no break stays applied.
trap '"${MUT[@]}" --restore >/dev/null 2>&1' EXIT

run_vitest() {
  local log="$1"
  shift
  npx vitest run "$@" --maxWorkers=2 --reporter=dot > "$log" 2>&1
}

run_node() {
  local log="$1" f
  shift
  : > "$log"
  for f in "$@"; do
    echo "== node $f" >> "$log"
    (cd "$ROOT" && node "$f") >> "$log" 2>&1 || return 1
  done
}

# The first failing test's name from a log (colour codes stripped); vitest says FAIL, the node tests say FAIL.
first_fail() {
  local line
  line="$(sed -e 's/\x1b\[[0-9;]*m//g' "$@" | grep -m1 -E '^ *(FAIL|×|✗) ' | cut -c1-200)"
  echo "${line:-(no failing test name in the log)}"
}

# A break that makes a file fail to load is not killed by a test.
does_not_load() {
  sed -e 's/\x1b\[[0-9;]*m//g' "$@" | grep -m1 -E 'Transform failed|SyntaxError|ParseError|ERR_MODULE_NOT_FOUND|Cannot find module' | cut -c1-200
}

read -r -a FILES <<< "$("${MUT[@]}" --files)"
if [ -n "$(git -C "$ROOT" status --porcelain -- "${FILES[@]}")" ]; then
  echo "A file a break rewrites has uncommitted changes; the restore would lose them." >&2
  git -C "$ROOT" status --short -- "${FILES[@]}" >&2
  exit 2
fi

read -r -a ALL_V <<< "$("${MUT[@]}" --all-vitest)"
read -r -a ALL_N <<< "$("${MUT[@]}" --all-node)"

fail=""
logs=()
if ! run_vitest "$LOGS/baseline-vitest.log" "${ALL_V[@]}"; then fail="vitest"; logs+=("$LOGS/baseline-vitest.log"); fi
if ! run_node "$LOGS/baseline-node.log" "${ALL_N[@]}"; then fail="$fail node"; logs+=("$LOGS/baseline-node.log"); fi
if [ -n "$fail" ]; then
  {
    echo "## Rule mutation proof"
    echo
    echo "Baseline (no break): **FAIL** ($fail), so no break can be judged."
    echo
    echo "First failing test: $(first_fail "${logs[@]}")"
  } > "$OUT"
  cat "$OUT"
  for l in "${logs[@]}"; do
    echo "---- tail of $l"
    tail -n 60 "$l"
  done
  exit 1
fi
echo "Baseline (no break): pass"

"${MUT[@]}" --check || exit 1

: > "$TSV"
i=0
for name in $("${MUT[@]}" --list); do
  i=$((i + 1))
  if ! "${MUT[@]}" --apply "$name" > "$LOGS/$name.apply.log" 2>&1; then
    printf '%s\t%s\t%s\n' "$name" "not-applied" "$(head -n1 "$LOGS/$name.apply.log")" >> "$TSV"
    echo "$i $name: NOT APPLIED"
    continue
  fi
  read -r -a V <<< "$("${MUT[@]}" --vitest "$name")"
  read -r -a N <<< "$("${MUT[@]}" --node "$name")"
  result=survived
  first=""
  logs=()
  if [ "${#V[@]}" -gt 0 ] && ! run_vitest "$LOGS/$name.vitest.log" "${V[@]}"; then
    result=killed
    logs+=("$LOGS/$name.vitest.log")
  fi
  if [ "$result" = survived ] && [ "${#N[@]}" -gt 0 ] && ! run_node "$LOGS/$name.node.log" "${N[@]}"; then
    result=killed
    logs+=("$LOGS/$name.node.log")
  fi
  if [ "$result" = killed ]; then
    broke="$(does_not_load "${logs[@]}")"
    if [ -n "$broke" ]; then
      result=not-applied
      first="the break itself does not load: $broke"
    else
      first="$(first_fail "${logs[@]}")"
    fi
  fi
  if ! "${MUT[@]}" --restore "$name" > "$LOGS/$name.restore.log" 2>&1; then
    cat "$LOGS/$name.restore.log" >&2
    echo "$name could not be restored." >&2
    exit 1
  fi
  printf '%s\t%s\t%s\n' "$name" "$result" "$first" >> "$TSV"
  echo "$i $name: $result"
done

if [ -n "$(git -C "$ROOT" status --porcelain -- "${FILES[@]}")" ]; then
  echo "A break was not restored." >&2
  git -C "$ROOT" status --short >&2
  exit 1
fi

"${MUT[@]}" --render "$TSV" "$OUT" "$JSON"
