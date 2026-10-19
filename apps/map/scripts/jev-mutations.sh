#!/usr/bin/env bash
# The Ask Jev panel's mutation proof. For each break in scripts/jev-mutate.mjs:
# apply it, run the Jev tests, record killed (a test failed) or survived (all
# passed), and restore the file with git checkout. Exits 1 if the unbroken
# baseline fails, if any break can't be applied, or if any break survives.
#
# Run from apps/map (CI: .github/workflows/jev-mutations.yml). Writes a
# Markdown table to $JEV_MUT_OUT (default jev-mutations.md) for the job summary.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
OUT="${JEV_MUT_OUT:-jev-mutations.md}"
LOGS="${JEV_MUT_LOGS:-jev-mutations-logs}"
mkdir -p "$LOGS"
TESTS=(components/hud/JevPlain.test.tsx components/hud/JevAnswer.test.tsx lib/jev)

run_tests() {
  npx vitest run "${TESTS[@]}" --maxWorkers=2 --reporter=dot > "$1" 2>&1
}

# The first failing test's name, from a vitest log (colour codes stripped).
first_fail() {
  sed -e 's/\x1b\[[0-9;]*m//g' "$1" | grep -m1 -E '^ *(FAIL|×|✗) ' | sed -e 's/|/\\|/g' | cut -c1-160
}

if [ -n "$(git status --porcelain -- lib/jev components/hud)" ]; then
  echo "lib/jev or components/hud has uncommitted changes; the restore would lose them." >&2
  exit 2
fi

node scripts/jev-mutate.mjs --check || exit 1

{
  echo "## Ask Jev mutation proof"
  echo
  echo "Tests: \`npx vitest run ${TESTS[*]} --maxWorkers=2\`"
  echo
} > "$OUT"

if run_tests "$LOGS/baseline.log"; then
  echo "Baseline (no break): pass" >> "$OUT"
else
  echo "Baseline (no break): **FAIL**, so no break can be judged." >> "$OUT"
  tail -n 60 "$LOGS/baseline.log"
  exit 1
fi

{
  echo
  echo "| # | Break | Rule | Result | First failing test |"
  echo "|---|---|---|---|---|"
} >> "$OUT"

killed=0
survived=0
broken=0
i=0
for name in $(node scripts/jev-mutate.mjs --list); do
  i=$((i + 1))
  rule="$(node scripts/jev-mutate.mjs --rule "$name")"
  file="$(node scripts/jev-mutate.mjs "$name" | sed -e 's/^[^:]*: //')"
  if [ -z "$file" ]; then
    echo "| $i | $name | $rule | **NOT APPLIED** | |" >> "$OUT"
    broken=$((broken + 1))
    continue
  fi
  if run_tests "$LOGS/$name.log"; then
    echo "| $i | $name | $rule | **SURVIVED** | |" >> "$OUT"
    survived=$((survived + 1))
  else
    echo "| $i | $name | $rule | killed | $(first_fail "$LOGS/$name.log") |" >> "$OUT"
    killed=$((killed + 1))
  fi
  git checkout -- "$file"
  echo "$i $name: done"
done

if [ -n "$(git status --porcelain -- lib/jev components/hud)" ]; then
  echo "A break was not restored." >&2
  git status --short
  exit 1
fi

{
  echo
  echo "**$killed killed, $survived survived, $broken not applied, of $i.**"
} >> "$OUT"
cat "$OUT"

[ "$survived" -eq 0 ] && [ "$broken" -eq 0 ]
