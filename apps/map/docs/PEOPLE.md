# Notable people linked to a company

The people who report their holdings in a listed company on SEC Forms 3, 4 and 5 (its officers, its directors, its 10% owners) are the one group of named people this project is set to show, and only beside the company they file about. This file records that decision, what the build reads and never reads, and the rules it has to meet before anything ships.

**Status, 2026-10-01: policy only.** No route, MCP tool, layer or page returns a reporting owner's name yet, and the company dossier still drops Forms 3, 4 and 5 from its filings list ([docs/COMPANIES.md](COMPANIES.md)). The roster file, `lib/people/data/insiders.json`, is built ([The bundle](#the-bundle)), and `lib/people/store.ts` reads it on the server ([The store](#the-store)); nothing calls the store yet. A rule tagged **[Cam YYYY-MM-DD]** is Cam's decision on that date. A rule tagged **[proposed]** is a default written before the build; it holds until Cam decides otherwise, and each one can be reversed.

## The decision

> **[Cam 2026-10-01]** "form 4 insiders should be counted as notable people construct associated with the specific business construct, etc."

How it is read here:

- Every reporting owner on a Form 3, 4 or 5 who is an individual (an officer, a director, a 10% owner, or "other") becomes a **notable person**, linked by an `insider-of` edge to the **business** of the issuer they file about. The business is the construct; the person hangs off it.
- Funds and companies that file as 10% owners are institutions, not people. Trusts, estates and family vehicles are handled like people: listed by role, with the name withheld.
- "etc." leaves room for other sources of notable people tied to a business, such as an 8-K item 5.02 officer change or a proxy's director list. Each one needs its own source entry and its own decision (D7). None is read now.

This reverses the institutions-only rule for reporting owners and for nobody else. Other shareholder names stay out.

## Cam's words that bear on it

| # | Tag | What was decided | Where the repo says it |
| --- | --- | --- | --- |
| C1 | [Cam 2026-10-01] | Verbatim: "form 4 insiders should be counted as notable people construct associated with the specific business construct, etc." | this file, CONTRIBUTING ground rule 1, the README's Ethics section, [docs/COMPANIES.md](COMPANIES.md) |
| C2 | [Cam 2026-09-25] | Parcels, addresses and ownership are in scope: "add in as much info as we can". The named-individual search ban stays. | the README's Ethics section ("no search goes from a person's name to what they own"), CONTRIBUTING ground rule 2 |
| C3 | [Cam 2026-09-27] | As recorded: parcel mailing addresses are shown as each county publishes them; legal suppressions stay (the HCAD confidential flag, Texas Tax Code 25.025, New Jersey's Daniel's Law: "keep NJ as is"). | the README's parcels section |
| C4 | [Cam 2026-09-27] | As recorded: the parcels removal-request channel, "ignore for now". | |

C1 is the only one about reporting owners. Every guardrail below is a proposal that applies C1 and carries C2 to C4 over; the last column of each table says how.

## Source

The SEC's [Insider Transactions Data Sets](https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets): one zip of Form 3, 4 and 5 data per quarter, keyless and public domain. The landing page says it covers January 2006 to June 2026.

- Zip links are read from the landing page, never built from a URL template. On 2026-10-01 the 2026q2 zip was at `/files/datastandardsinnovation/data/insider-transactions-data-sets/2026q2_form345.zip`, while 2026q1 and earlier were still under `/files/structureddata/`, where 2026q2 is a 404.
- Posting lags quarter end by 7 to 9 days (2025q4 on 2026-01-07, 2026q1 on 2026-04-07, 2026q2 on 2026-07-09), so 2026q3 is expected around 2026-10-07 to 09. The forms themselves are prompt: half are filed within 2 days of the period they report.
- Requests send the `embedding-atlas/0.1` user agent with a contact address and stay at or under 8 a second, as in the fair-access policy in [docs/COMPANIES.md](COMPANIES.md).
- The issuer universe is the companies listed on Nasdaq, NYSE or Cboe in `lib/companies/data/raw/company_tickers_exchange.json`, joined on the issuer's CIK, never its ticker (in 2026q2, 763 submissions had a blank, NONE or N/A ticker). OTC issuers are left out.
- The window is the last 8 quarters by period of report (D8).

Per-filing XML is not the source. Reading every filing for 8 quarters is 344,026 requests, about 12 hours at 8 a second.

### Columns read, columns never read

Two tables are read, by explicit column list:

| Table | Columns |
| --- | --- |
| `SUBMISSION` | `ACCESSION_NUMBER`, `FILING_DATE`, `PERIOD_OF_REPORT`, `DATE_OF_ORIG_SUB`, `DOCUMENT_TYPE`, `ISSUERCIK`, `NOT_SUBJECT_SEC16` |
| `REPORTINGOWNER` | `ACCESSION_NUMBER`, `RPTOWNERCIK`, `RPTOWNERNAME`, `RPTOWNER_RELATIONSHIP`, `RPTOWNER_TITLE`, and `RPTOWNER_TXT` only through the phrase allowlist in G3 |

Never read: the reporting owner's address (`RPTOWNER_STREET1`, `RPTOWNER_STREET2`, `RPTOWNER_CITY`, `RPTOWNER_STATE`, `RPTOWNER_ZIPCODE`, `RPTOWNER_STATE_DESC`), `FILE_NUMBER`, `REMARKS`, `AFF10B5ONE`, and the `CONTACT_*` columns the metadata file lists. Never opened: `FOOTNOTES.tsv`, `OWNER_SIGNATURE.tsv`, and the four transaction and holding tables (`NONDERIV_TRANS`, `NONDERIV_HOLDING`, `DERIV_TRANS`, `DERIV_HOLDING`).

One link is kept per issuer and owner, from the window only: the union of the relationships filed, the officer title from the latest filing as filed ("See Remarks" becomes no title, with a note that the filing has one), the first and last filing dates, the last period, the last form and its accession, and the filing's "not subject to Section 16" mark when the latest filing has that owner alone. The latest filing is the one with the latest period, then filing date, then accession, so a late Form 5 or an amendment cannot overwrite a newer title. A link whose only relationship is empty is dropped and counted.

Each line is split on tabs and only the listed columns are taken from it, by their place in the header, so the other columns never leave the line they arrived in. A line with more or fewer fields than the header is skipped and counted, because a shifted line is how an address could land in a name. The issuer is matched on `ISSUERCIK`; the issuer's name and ticker in the same table are not read. A title that only points at the remarks ("See Remarks", "SEE REMARKS (a)", "Please see remarks") becomes no title with `titleInFiling` set; a title with a pointer added ("Co-President (See Remarks)") is kept as filed, with `titleInFiling` set. An "other" relationship carries one of the G3 phrases or "Other (see filing)".

## Who counts as what

`entityType` does not separate people from funds: it is "other" for an individual director, a 10%-owner partnership and a family trust alike. So the class is a word test on the filed name, run in this order, with a list of CIK overrides for known misfires (D4):

1. **Business**: the owner's CIK is itself a listed issuer, as when one company files as another's 10% owner. It gets a business-to-business link.
2. **Vehicle**: a trust, estate or family marker as a whole word (`FBO`, `U/A`, `DTD`, `REVOCABLE`, `IRREVOCABLE`, `LIVING TRUST`, `FAMILY`, `ESTATE OF`, `GRAT`, `UTMA`, `UGMA`, `CUSTODIAN`, `TRUST` not followed by `CO` or `COMPANY`, and a few more). It is listed by role only, as "a trust or family vehicle (name in the filing)": no name, no CIK, no view of its own.
3. **Entity**: an entity token as a whole word (`LLC`, `L.P.`, `Inc`, `Corp`, `Ltd`, `plc`, `Fund`, `Partners`, `Capital`, `Management`, `Holdings`, and a few more). It is listed under the business as an institutional or entity owner, by filed name, with no view of its own.
4. **Individual**: everything else. A notable person.

Every class gets the same never-read column list. The class decides only whether a name and a view are shown, so a misclassified owner cannot leak an address, a signature or free text. Death is never inferred: an "Estate of" filer is a vehicle. The markers are whole words because 516 owner names in 46 quarters carry "UTMA" inside a surname and 116 start with the surname "Minor".

The word lists in `scripts/people_classify.py` are the spec's, with these changes, measured on the 2024q3-2026q2 roster:

- **[proposed]** Vehicle markers add `CONSERVATOR`, `CONSERVATORSHIP` and `GUARDIANSHIP`. A conservator files for a person who cannot, so the filed name says something about that person's health.
- **[proposed]** Entity tokens add legal forms and organisation words that are not part of anyone's name: `INCORPORATED`, `LLLP`, `PARTNERSHIP`, `VENTURES`, `ASSOCIATES`, `INVESTMENTS`, `AUTHORITY`, `GROUP`, `S.a r.l.`, `S.C.A.`, `SCSp`, `S.p.A.`, `S.r.l.`, `A/S`, `PJSC`, `BHD`, `ICAV`, `Anstalt`, `CommV`, and `AB` or `SAS` as the last word. They move 53 owners from individual to entity on that roster, and none of the 53 is a person.
- **[proposed]** `lib/people/data/class-overrides.json` sets 44 CIKs to entity by hand: filers whose names carry no token at all (one word, `SA` or `NV` without dots, `ASA`, a singular `Holding` with a number, `Kft`, `e.V.`, sovereign and public funds, union bodies). Each entry is a CIK and a class and nothing else; the builder refuses any other key, so the file cannot turn into a list of names.
- **[proposed]** `L P` written with a space counts as an entity token only as the last two words of the name, the way EDGAR writes `<X> ASSOCIATES L P`. Anywhere else it is more likely two initials, so a name with `L P` before a `JR` stays an individual. The spec's list has `L P` with no position.
- **[proposed]** `CO` followed by a hyphen is the start of "co-trustee", not the `CO` token, both where `TRUST` is tested for a following `CO` and as an entity token. So `<X> TRUST CO-TRUSTEES` is a trust with two trustees (a vehicle), not a trust company (an entity), while `<X> TRUST CO.` and `<X> TRUST CO, AS TRUSTEE` stay entities. It moves no owner on this roster.
- **[proposed]** The relationships on a filing do not move a name out of the vehicle class. A trust can file with the grantor's Director, Officer and 10% owner boxes and officer title copied onto its own row: in the window, three filers named as a living trust, a dynasty trust and a revocable trust did, with titles such as chief executive officer. The filer is still the trust, and its name names the family, so it stays a vehicle with the name withheld. Its title is not stored either: the builder writes no title for a vehicle and the store serves none.

`SA`, `NV` and `ASA` without dots, and a singular `Holding`, stay off the word lists because real people's names carry them ("Holding" is a surname, "Asa" a given name). When one CIK files under several names, it takes the class that shows least: vehicle, then entity, then individual. Names are never compared across CIKs (G8): two filers with the same name are two rows.

### Names as stored

**[proposed]** When two filers share a conformed name, EDGAR tells them apart with a token after it. On an individual that token is a location or a date about the person (a state, a ZIP code, a birth year), not part of the name, so the bundle stores an individual's name without it. The CIK stays the identity (G8). Classification still reads the name as filed, and entity and business names keep their tokens (`EXAMPLE CORP /DE/` is the company's conformed name). `individual_name` in `scripts/people_classify.py` removes, until none is left:

1. a number of five or more digits, optionally ZIP+4, standing alone (no letter or digit beside it), bare or in parentheses: `12345`, `(12345-1234)`;
2. a four-digit year from 1900 to 2099 standing alone, bare or in parentheses: `1962`;
3. a US state or territory name in parentheses: `(Michigan)`;
4. at the end of the name: a slash, then nothing or two or three letters, then an optional closing slash, with or without spaces: ` /WI`, `J/NY`, `/DE/`, `/ADV`, `/ FA`, a bare `/`.

One letter after the slash (`N/A`) and four (`/SEIU`) are left alone, and so are parenthesized nicknames, initials and `(NMN)`, because `(CA)` can be someone's initials. A name with nothing left is not given a made-up one: the link is dropped and counted as `emptyName` (none on this roster). On 2024q3-2026q2 the rule changed 15 rows, 13 owners: five state suffixes, one `/ADV`, one `/ FA`, three bare slashes, one ZIP code, one birth year and one `(Michigan)`; two of the 13 are on two rows each. `lib/people/boundary.test.ts` (T1) fails if any individual's name in the bundle or the fixture still has a 5-digit run, a 19xx or 20xx year standing alone, a slash suffix or a state in parentheses.

## Guardrails

| # | Rule | Tag | Relation to Cam's words |
| --- | --- | --- | --- |
| G1 | No reporting-owner address is read, stored or shown, for any class. In 2026q2, 60,056 of 60,153 owner rows carried a street, and only 42.9% of those were care-of lines. | [proposed] | tighter than C3 (D3) |
| G2 | No signature is read. About seven in ten signature lines name an attorney-in-fact (71.3% under a strict pattern), a third person. | [proposed] | none |
| G3 | No footnote or remarks text; the filing is linked instead. `RPTOWNER_TXT` is shown only when it is one of "Member of a Group", "Member of 10% owner group", "Trustee", "Former 10% Owner", "Portfolio Manager" or "Chairman of the Board"; anything else reads "Other (see filing)". | [proposed] | none (D5) |
| G4 | A person has no geometry: never a map feature, never in the place fabric, emergence, Inside, Ascend, compare, the field, place pages, briefs, feeds, sitemaps, ⌘K or the desk table. | [proposed] | none |
| G5 | Business first: a person is reached only through a business they filed about (`via=` that business); anything else is a 404 that names nothing. | [proposed] | applies C1's "associated with the specific business construct" (D2) |
| G6 | No search by a person's name anywhere: name parameters are refused with a 400 that names the key, never the value; MCP inputs are digits only; there is no voice intent; the companies search stays on issuer names. | [proposed] | carries over the search ban kept with C2 (D1) |
| G7 | No join from a person to parcels, addresses or property, in either direction, and parcel owner names are never matched against reporting owners. | [proposed] | carries over C2 |
| G8 | Identity is the CIK. People are never merged or joined by name, across sources or within one: two filers with the same name are two people. | [proposed] | CONTRIBUTING ground rule 2 |
| G9 | Classes as above; trusts, estates and family vehicles are listed by role with the name withheld. | [proposed] | none (D4) |
| G10 | No current, former or deceased inference: a link says `filed <first> to <last>`, plus the Section 16 mark as filed. No filing does not mean the person left. | [proposed] | none |
| G11 | No per-person holdings, wealth or transactions on a person or a person's links. | [proposed] | none (D6) |
| G12 | Answers are scoped to one issuer: no unfiltered list of people in any route or MCP tool, no CSV, no people bundle in the browser. | [proposed] | none |
| G13 | A reporting owner's EDGAR `submissions` JSON, which carries their mailing address, is never fetched. Classification is offline, and the company dossier refuses a known reporting-owner CIK before any request. | [proposed] | none |
| G14 | No person permalink and no browser storage: the person view lives in memory only. | [proposed] | none |
| G15 | No people on place pages, briefs, feeds or MCP prompts, and no place-to-person counts. | [proposed] | none |
| G16 | Withholding: a server-side list of hashed CIKs in an environment variable, not in this public repository (a CIK resolves to a name on EDGAR). A withheld person gets the same 404 as an unknown one, the business's list omits them with no count, and the check runs everywhere people are emitted. | [proposed] | follows C4 (D9) |

Two leaks these rules cannot close by themselves, both part of D3:

- Every row links its SEC filing, and EDGAR's page for that filing shows the owner's mailing address and signature. This app does not extract, store, index or re-host them, and the roster's footer says the linked filing shows the filer's address.
- The company dossier prints the issuer's street address. In 2026q2, 644 of 5,065 issuers had exactly one individual-looking owner; in a sample of 24 of them, 6 had a business street address equal to the sole insider's filed one. That is indicative only.

Calling the business view once for each of the roughly 5,400 issuers would rebuild the person-to-businesses index. No rate limit is planned; that is part of D2.

## Open decisions and the defaults used here

| # | Question | Default here | Tag |
| --- | --- | --- | --- |
| D1 | A search from a person's name to the companies they file about? | None, anywhere. | [proposed] |
| D2 | A person view listing every business they filed about, including what an individual 10% owner holds 10% of? | Yes: roles and filing dates only, opened from a business. | [proposed] |
| D3 | Reporting-owner addresses? | Never read, stored or shown, which is tighter than parcels (C3). The filing link stays, with the footer note above, and so does the issuer's street address. | [proposed] |
| D4 | Entity owners and family vehicles? | Entities by filed name; trusts, estates and family vehicles by role only, name withheld. | [proposed] |
| D5 | `RPTOWNER_TXT`, the free-text relationship? | The fixed phrase list in G3, else "Other (see filing)". The alternatives are dropping it or showing it as filed. | [proposed] |
| D6 | Holdings, share counts and transactions? | None on a person or a person's links in v1. Anything else that shows Form 4 transactions with filer names answers per issuer only. | [proposed] |
| D7 | What "etc." adds | Forms 3, 4 and 5 only for now. A later source may add a person only from a field the regulator publishes in structured form that names the person and the issuer together; a source without a CIK stays on the business with no person view. No names taken from 8-K or proxy text. | [proposed] |
| D8 | How far back | The last 8 quarters by period of report, so a person drops off two years after the last period they reported. 2015 onward would be about twice the size. | [proposed] |
| D9 | Withholding on request | The G16 hook, with no published request channel (following C4). Parcels keep their own channel in the README. A withheld person can stay in the CDN cache for up to about 48 hours (24 h `s-maxage` plus 24 h `stale-while-revalidate`). | [proposed] |

## What stays true until people ship

These describe the app as it is today. Each changes with the code that ships people, not before:

- the README's Public companies row ("No insiders.") and its companies paragraph ("no officers, insiders or shareholders");
- the "Not shown, by design" paragraph in [docs/COMPANIES.md](COMPANIES.md), and `DOSSIER_FORMS` in `lib/companies/edgar.ts`;
- the dossier footer in `components/hud/CompanyAside.tsx` and the layer description in `lib/layers/companies.ts`;
- the place-page caveat in `lib/companies/section.ts` ("Forms 3, 4 and 5 are excluded everywhere"), which becomes "this section carries company fields only; people who file Forms 3, 4 and 5 are reached from a company's dossier, never from a place";
- the "No people." note and the `company` tool's description in [docs/MCP.md](MCP.md).

`lib/people/policy-docs.test.ts` fails if a retired phrase comes back into the README, CONTRIBUTING, `docs/*.md` or the About dialog, and checks the tags in this file. Its phrase list grows as each item above changes.

## The bundle

`scripts/people-data.py` (Python, standard library only) reads the quarterly zips and writes one server-only file, `lib/people/data/insiders.json`. Nothing goes under `public/`, nothing imports it, and only the server-side store reads it ([The store](#the-store)). The file is as public as the SEC's own data set (which also carries addresses); what this app adds is the rule that there is no name search and no bulk list of people.

The header names the source and its landing page, the quarters read and the period window, the date the zips were downloaded (`pulled`) and SEC's build date for each zip, the issuer universe, the columns read, the tables opened, and the counts: rows kept, links dropped, and every kind of line skipped while reading. Then `issuers` maps each issuer's 10-digit CIK to its rows, one issuer per line. A row is a list in this order:

| Field | What it holds |
| --- | --- |
| `ownerCik` | the owner's CIK as a number; pad it to 10 digits |
| `name` | the name as filed in the latest filing, for an individual less EDGAR's disambiguators ([Names as stored](#names-as-stored)); null for a vehicle |
| `class` | `i` individual, `e` entity, `v` vehicle, `b` business |
| `roles` | a bitmask: 1 director, 2 officer, 4 ten-percent owner, 8 other |
| `title` | the officer title from the latest officer filing, as filed, or null; always null for a vehicle |
| `titleInFiling` | 1 when the title is in the filing's remarks, else 0; always 0 for a vehicle |
| `firstFiled`, `lastFiled` | the first and last filing dates in the window |
| `lastPeriod` | the latest period of report |
| `nssFiled` | the latest filing's date when that filing has this owner alone and is marked not subject to Section 16, else null |
| `lastForm`, `lastAccession` | the latest filing's form (`3`, `4` or `5`, with `/A` for an amendment) and accession number |
| `otherText` | for an "other" relationship, a G3 phrase or "Other (see filing)" |

Trailing nulls are left off a row. A vehicle keeps its CIK so the company dossier can refuse that CIK before any request (G13); its name and title are not in the file. A filing whose reporting owner is the issuer itself is skipped and counted, and so is a link whose name is empty (`dropped.emptyName`); `counts.namesCleaned` is the number of rows whose name lost a disambiguator.

Measured on 2024q3-2026q2 from the cached zips, 2026-10-01:

- 5,533 issuers and 77,999 rows. By distinct owner: 58,897 individuals, 4,420 entities, 308 vehicles and 149 businesses. 4 links dropped for an empty relationship, none for an empty name. 15 rows (13 owners) have a disambiguator dropped from the name.
- 9,628,633 bytes raw and 2,160,912 gzipped, against a budget of 10,000,000 and 2,500,000. Above either, the builder writes nothing and exits 2.
- About 5 seconds. Two builds from the same zips give the same bytes.

The issuer count follows the ticker file. The committed `company_tickers_exchange.json` gives 5,533; SEC's list as of 2026-10-01 gives 5,472, because 49 of the committed file's listed CIKs are no longer on SEC's list and 23 have moved to OTC. Refreshing the ticker file brings the roster in line with it.

## The store

`lib/people/store.ts` reads the bundle on the server, once per process and only when first asked, with `node:fs`. Nothing imports the file, so no bundler can carry it to a browser. At load it indexes the owners of each issuer and, the other way round, the issuers of each owner. Nothing calls it yet: the business view, the person view and the dossier's refusal come with the routes (M4a, M4b).

- Every lookup is by CIK, padded or not: `320193` and `0000320193` are the same issuer. A name is never a key.
- A trust, estate or family vehicle comes back with its roles, its filing dates and its latest filing's accession, and with no name, no CIK and no title, even from a bundle that carries them (a trust can file with the grantor's officer title, which the builder does not store). It cannot be looked up as an owner. The accession stays because the filing is where the roster sends a reader for the name; an accession can start with the filer's own CIK, as EDGAR numbers them (38 of the 348 vehicle links in the 2024q3-2026q2 bundle), which is the same disclosure as the filing link in D3.
- The store refuses a file whose header does not match the row layout, class codes, role bits and "other" phrases it decodes, and any row that is not exactly what the builder writes (an "other" text outside the G3 list included), so a shifted column fails the load instead of landing in a name.
- A missing file gives an empty store marked not built. An empty answer from it is not a finding that a company has no insiders.
- It knows every reporting owner's CIK (individual, entity or vehicle, withheld or not), so the company dossier can refuse that CIK before any request to EDGAR (G13).

Answers take the shapes in `lib/fabric/parties.ts`: a business, a notable person or an institution, with ids `business:<cik>`, `person:<cik>` and `institution:<cik>` padded to 10 digits, joined by `insider-of` edges. They form a graph of their own. The place fabric's kinds, domains, relations and stack are unchanged, and a party has no area, outline or anchor, so the type checker refuses one wherever a place construct is expected.

`lib/people/boundary.test.ts` holds two lines. It walks the bundle, the class overrides and the fixtures for address, signature, footnote, remarks, phone and former-name keys, and for values shaped like a street line, a PO box, a care-of line, a suite, a state and ZIP or a phone number (T1). It scans every import in the app: nothing imports `lib/people/data`, no client module or component imports `lib/people` (the people client to come excepted), the map, place, parcel and place-fabric modules do not import it, and `lib/people` takes only `lib/fabric/parties` from the fabric (T9). The test fixture, `lib/people/fixtures/insiders.fixture.json`, names nobody: every name is a removal marker, and every CIK is above the range EDGAR has assigned.

## Withholding

**[proposed]** The G16 hook, built with no published request channel (D9, following C4).

- The list is not in this repository. A CIK resolves to a name on EDGAR, so a committed list would publish who asked. It lives in two server-side environment variables, `GEV_PEOPLE_WITHHELD` (hex digests, separated by commas, spaces or newlines) and `GEV_PEOPLE_WITHHELD_KEY` (the key).
- A digest is HMAC-SHA256 of the 10-digit CIK under the key. A plain hash would not do: hashing every CIK there is takes seconds. To make one:

  ```bash
  node -e "console.log(require('crypto').createHmac('sha256',process.env.GEV_PEOPLE_WITHHELD_KEY).update(process.argv[1].padStart(10,'0')).digest('hex'))" <cik>
  ```

- A withheld owner is left out of every roster, owner lookup and link, with no count and no marker, so an answer reads the same as for someone who never filed, and their person view gets the same 404 as an unknown CIK. Their CIK is still refused before any request to EDGAR (G13).
- It fails closed. A list with no key, or an entry that is not 64 hex characters, makes every roster, owner lookup and link throw, for known and unknown CIKs alike, until the setting is fixed; the error names the variable and a count, never an entry.
- `lib/people/store.ts` and the `/api/rsu?op=events` calendar apply it now. The routes, the MCP tools and `EmployerAside` go through it as each starts to emit people (M4a, M5, M8).
- The business view is to be cached for 24 hours plus 24 hours stale-while-revalidate, so a newly withheld person can stay in the CDN cache for up to about 48 hours.
- `lib/people/suppressed.test.ts` (T12) checks each point above, and that the repository tracks no withheld list, no env file and no assignment of either variable.

## Refresh

```bash
python scripts/people-data.py --list-quarters          # one GET of the SEC landing page
python scripts/people-data.py --zip-dir <dir> --from 2024q4 --to 2026q3 --fetch
python scripts/test_people_data.py
```

- Quarterly, by hand, about 7 to 9 days after quarter end (2026q3 around 2026-10-07 to 09): move `--from` and `--to` on by one quarter. Answers say which quarter they are filed through.
- `--list-quarters` prints each posted quarter and its path on sec.gov. On 2026-10-01 it listed 2006q1 to 2026q2, with 2026q2 under `/files/datastandardsinnovation/` and 2026q1 and earlier under `/files/structureddata/`. `--fetch` downloads only the quarters missing from `--zip-dir`, by those links. Keep `--zip-dir` outside the repository.
- Requests send the `embedding-atlas/0.1` user agent with a contact address and stay at or under 8 a second.
- Exit codes: 0 written; 1 a zip is missing or a table lacks a column; 2 over the size budget, nothing written.
- `pulled` is the newest zip's file date unless `--pulled` is given.
- Filings made after the last posted quarter are not read. If that is added later, an owner seen for the first time shows by role only, name withheld, until the next quarterly build classifies them.
