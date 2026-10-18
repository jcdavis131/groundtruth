# Economy history datasets

`GET /api/economy/history` serves the backfilled research datasets behind the
market momentum and affordability indices that the market report shows for the
latest month only. Every series is a `lib/series` `Series` (`{ id, title,
unit, frequency, geo, tags, provenance, points: [{ t, v }] }`, `t` epoch ms
UTC, `v` null when the upstream withheld the cell) and every response is
`Enveloped`: `{ data, provenance[], generatedAt, caveats[] }`.

Code: `lib/economy/history/` (pure, tested) and `app/api/economy/history/route.ts`.

## Ops

| op | params | returns |
| --- | --- | --- |
| `county` | `fips=SSCCC` required; `years` 1..26 (default 10); `lag` 0..12 months (default 0); `format=json\|csv` | `{ series: Series[] }` for one county |
| `us` | `years`, `lag`, `format` | the same for the nation (Zillow "United States" row, QCEW `US000`) |
| `ic` | `h` 1..60 months (default 12); `asof=YYYY-MM`; `minN` 10..5000 (default 30); `from`, `to` `YYYY-MM` | the monthly information-coefficient panel (see below) |

Bad ids and malformed dates answer 400 with `{ error }`; an unknown county
answers 404; an upstream failure answers 502 with the upstream's status. CORS
is open. County and US bundles are cached for 6 h (Zillow's release cadence),
the QCEW quarters underneath for 12 h, and the edge cache mirrors that.

## Series in a county / US bundle

| id | frequency | unit | provenance | what it is |
| --- | --- | --- | --- | --- |
| `zhvi:county:<fips>` / `zhvi:us` | monthly | $ | published, Zillow Research (`zillow-zhvi`) | Zillow Home Value Index, typical home (35th–65th percentile), smoothed, seasonally adjusted, from 2000-01 |
| `zori:county:<fips>` / `zori:us` | monthly | $ per month | published, Zillow Research (`zillow-zori`) | Zillow Observed Rent Index, typical asking rent, smoothed, from 2015; fewer counties than ZHVI |
| `qcew:county:<fips>:emp` (`qcew:us:emp`) | quarterly | jobs | published, BLS QCEW (`bls-qcew`) | employment in the third month of the quarter, all covered jobs (industry 10, ownership 0) |
| `qcew:county:<fips>:avg-weekly-wage` | quarterly | $ per week | published | average weekly wage of those jobs |
| `qcew:county:<fips>:estabs` | quarterly | count | published | establishments |
| `...:emp:yoy`, `...:avg-weekly-wage:yoy`, `...:estabs:yoy` | quarterly | % | **estimate**: `(v(q) / v(q − 4) − 1) × 100` from the published levels | over-the-year change; matches the figure BLS publishes to its 0.1 rounding |
| `fred:MORTGAGE30US` | weekly | % | published, FRED relaying Freddie Mac PMMS (`fred`) | 30-year fixed rate, survey-week average |
| `momentum:county:<fips>` | monthly | index −1..1 | **estimate** | the market momentum index backfilled, see below |
| `affordability:county:<fips>:payment` | monthly | $ per month | **estimate** | principal and interest on 80 % of the typical home over 30 years at that month's PMMS rate |
| `affordability:county:<fips>:wage-share` | monthly | % | **estimate** | payment as a share of one average job's monthly pay (`avg weekly wage × 52 / 12`) |
| `affordability:county:<fips>:price-to-rent` | monthly | ratio | **estimate** | `ZHVI / (ZORI × 12)`, same month |

Every estimate carries its formula in `provenance.method` and the ids of its
input series in `provenance.notes[0]` (`inputs: ...`). Quarterly series are
stamped on the last day of the quarter (Q1 → March 31). Series are trimmed to
the last `years` years, but the indices are computed on the full history
first so the first month of the window still has its 12-month base.

Zillow revises recent months in each release; BLS's newest quarter is
preliminary and is revised with the next release. Re-pull rather than append.

## Alignment rules

The index month axis is the ZHVI series' months (month ends).

- **Monthly onto monthly (ZORI):** matched on the calendar month; a missing
  month is null, never the neighbour.
- **Quarterly onto monthly (QCEW):** carried forward. Month *m* takes the
  latest quarter whose period end, shifted by `lag` months, is on or before
  *m*. With `lag=0` (the default, and what the market report does) 2024 Q1 is
  used for March, April and May 2024; with `lag=5` it is first used in August
  2024, which is about when BLS publishes it. A quarter is not carried more
  than 12 months, so a suppressed or missing quarter becomes null instead of
  a year-old number. Suppressed quarters are skipped, i.e. the previous
  quarter is carried across them within that limit.
- **Weekly onto monthly (PMMS):** the last weekly observation on or before
  the month end, at most 3 months old.
- **Percent changes** compare calendar months (or calendar quarters), not
  array positions, so gaps yield null rather than a wrong pair.

The rules live in `lib/economy/history/align.ts` (`asOfJoin`,
`pctChangeMonths`, `pctChangeQuarters`).

## Momentum

`lib/economy/estimates.ts momentum()` is

```
momentum = Σ wᵢ · clip(changeᵢ / scaleᵢ, −1, 1) / Σ wᵢ   over the terms present
```

with terms home value 1-yr change (w 0.30, scale ±10 %), rent 1-yr change
(0.15, ±10 %), jobs over-the-year change (0.30, ±3 %), avg weekly wage
over-the-year change (0.25, ±6 %). The history module imports the same
`MOMENTUM_SPEC`, computes the home and rent changes as 12-month ZHVI / ZORI
changes and carries the QCEW over-the-year changes forward as above, so the
last month of `momentum:county:<fips>` equals what the market report shows
for the same inputs (a test asserts this). Months before 2001 (no 12-month
base) and months where no term is computable are null; when some terms are
missing the rest are reweighted, exactly as `momentum()` does.

`momentum:county:<fips>:home-only` is a **reduced form**: the home-value term
alone, `clip(ZHVI 12-month change / 10 %, −1, 1)`. It exists so the IC panel
can run across every county from one Zillow file instead of ~3,000 BLS
fetches. It is a narrower signal than the full index and is labelled as such
in its provenance and in the response caveats.

## The IC panel (`op=ic`)

For each month *t*, take every county with a home-only momentum value at *t*
and a ZHVI value *h* months later, and compute the Spearman rank correlation
between the signal at *t* and the realised change `ZHVI(t + h) / ZHVI(t) − 1`.
That correlation is the information coefficient (IC) for *t*. The response
carries:

- `byMonth[]`: `{ month, rho, n, t }` where `t = rho · √((n − 2) / (1 − rho²))`,
  approximately Student *t* with *n − 2* degrees of freedom **if** the
  cross-section were independent;
- `summary`: months with a defined IC, mean IC, its sample standard
  deviation, `icIr = mean / sd`, the share of months with IC > 0, mean *n*;
- `series[0]`: the monthly IC as a Series (`ic:momentum:home-only:h<h>`);
- with `asof`, `at` (that month's IC) and `rows[]` (`{ id, signal, forward }`
  per county, capped at 4,000) so you can plot the cross-section.

Months with fewer than `minN` counties are skipped. Ties get average ranks.

### Limits, read before quoting a number

- **Descriptive, not a forecast.** It says how the ranking related to what
  followed in the sample; it does not say the relation will hold.
- **No costs.** No transaction costs, taxes, carrying costs, or the fact
  that a county's typical home is not something you can buy and sell.
- **Coverage / survivorship.** Zillow adds counties as it gets enough
  listings, so the early panel over-represents large metros, and counties
  that fell out of the file are not in it.
- **Correlated cross-sections.** Neighbouring counties move together and the
  *h*-month windows of consecutive months overlap, so the *t*-statistics
  overstate significance; treat `icIr` and `positiveShare` as the honest
  summaries.
- **Revisions.** ZHVI is revised; the panel uses today's vintage for every
  month, which is not what was knowable at the time.
- **Reduced-form signal.** Only the home-value term is tested. A full-index
  panel would need per-county QCEW history for every county; the county op
  gives you the full index for any county you ask for, so you can build a
  smaller panel yourself.

## Examples

```sh
# one county, ten years, JSON
curl -s 'https://<host>/api/economy/history?op=county&fips=48453' | jq '.data.series[] | {id, n: (.points|length), unit}'

# long-format CSV for a notebook, with the 5-month publication lag applied to QCEW terms
curl -s 'https://<host>/api/economy/history?op=county&fips=48453&years=15&lag=5&format=csv' -o travis.csv

# national bundle
curl -s 'https://<host>/api/economy/history?op=us&years=20'

# IC of the home-only signal for the next 12 months, plus the June 2021 cross-section
curl -s 'https://<host>/api/economy/history?op=ic&h=12&asof=2021-06' | jq '.data.summary, .data.at'
```

```python
import pandas as pd, requests

base = "https://<host>/api/economy/history"
df = pd.read_csv(f"{base}?op=county&fips=48453&years=15&lag=5&format=csv", parse_dates=["t_iso"])
wide = df.pivot(index="t_iso", columns="series_id", values="value")
wide[["momentum:county:48453", "affordability:county:48453:wage-share"]].plot(subplots=True)

ic = requests.get(f"{base}?op=ic&h=12").json()
panel = pd.DataFrame(ic["data"]["byMonth"]).set_index("month")
print(ic["data"]["summary"]); print(ic["caveats"])
panel["rho"].rolling(12).mean().plot(title="12-month mean IC, home-only momentum -> next-12-month ZHVI change")
```

Cite with `citation()` from `lib/provenance/types.ts` on any `provenance[]`
entry, e.g. "Zillow Research. Zillow Home Value Index (ZHVI). series
County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month. period 2026-07. ...".
