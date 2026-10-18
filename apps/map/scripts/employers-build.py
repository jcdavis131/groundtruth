#!/usr/bin/env python3
"""
Merge Forbes + DBpedia + Wikidata into a ranked US employer list.

Priority for dedupe: Forbes (best US validation) > DBpedia > Wikidata.
Strict US-HQ filtering. Outputs employers_ranked.json with rank, name,
employees, city, state, ticker/cik where available, source, and provenance.
"""
import json, os, re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(REPO, 'lib', 'companies', 'data', 'raw')
DATA = os.path.join(REPO, 'lib', 'companies', 'data')

def norm(s):
    s = (s or '').upper()
    s = re.sub(r'[^A-Z0-9 ]', ' ', s)
    s = re.sub(r'\b(INC|CORP|CORPORATION|CO|COMPANY|LLC|LTD|LIMITED|PLC|HOLDINGS|HOLDING|GROUP|INTERNATIONAL|INTL|SYSTEMS|TECHNOLOGIES|TECH|INDUSTRIES|INCORPORATED|THE)\b', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

# Known non-US or bad records to exclude
DENY = {norm(n) for n in [
    'Yum China', 'Yum China Holdings',
    'Caesars Rewards',  # loyalty program, not a company
]}

def load_forbes():
    recs = []
    for fn, src in [('forbes_g2000_2025.json', 'forbes-g2000-2025'),
                    ('forbes_private_2025.json', 'forbes-private-2025')]:
        d = json.load(open(os.path.join(RAW, fn)))
        ol = d.get('organizationList', {})
        orgs = ol.get('organizationsLists') or ol.get('organizations') or []
        for o in orgs:
            if not isinstance(o, dict): continue
            if o.get('country') != 'United States': continue
            emp = o.get('employees')
            if not emp: continue
            name = o.get('organizationName') or o.get('name')
            if not name: continue
            recs.append({
                'name': name,
                'employees': int(emp),
                'city': o.get('city'),
                'state': o.get('state'),
                'source': src,
            })
    return recs

def load_dbpedia():
    d = json.load(open(os.path.join(RAW, 'dbpedia_hq_city.json')))
    seen = {}
    for b in d['bindings']:
        uri = b['s']['value']
        try: emp = int(float(b['emp']['value']))
        except: continue
        if emp <= 0: continue
        label = b['label']['value']
        city = b['hqCity']['value']
        # clean city: take first part before comma, strip state names
        city = city.split(',')[0].strip()
        if uri not in seen or emp > seen[uri]['employees']:
            seen[uri] = {
                'name': label, 'employees': emp, 'city': city,
                'state': None, 'source': 'dbpedia',
                'uri': uri,
            }
    return list(seen.values())

def load_wikidata():
    d = json.load(open(os.path.join(RAW, 'wikidata_employees.json')))
    # SEC universe for name matching
    j = json.load(open(os.path.join(RAW, 'company_tickers_exchange.json')))
    sec = {}
    for cik, name, ticker, exch in j['data']:
        n = norm(name)
        if n and n not in sec:
            sec[n] = (cik, ticker)
    recs = []
    for b in d['results']['bindings']:
        label = b.get('sLabel', {}).get('value', '')
        n = norm(label)
        if not n or n in DENY: continue
        if n not in sec: continue
        try: emp = int(float(b['emp']['value']))
        except: continue
        if emp <= 0: continue
        hq = b.get('hqLabel', {}).get('value', '')
        city = hq.split(',')[0].strip() if hq else None
        cik, ticker = sec[n]
        recs.append({
            'name': label, 'employees': emp, 'city': city,
            'state': None, 'ticker': ticker, 'cik': cik,
            'source': 'wikidata-p1128',
        })
    # dedupe within wikidata, keep max
    best = {}
    for r in recs:
        n = norm(r['name'])
        if n not in best or r['employees'] > best[n]['employees']:
            best[n] = r
    return list(best.values())

def main():
    forbes = load_forbes()
    dbp = load_dbpedia()
    wd = load_wikidata()
    print(f'forbes: {len(forbes)}, dbpedia: {len(dbp)}, wikidata: {len(wd)}')

    merged = {}
    # priority: forbes > dbpedia > wikidata
    for r in wd:  # lowest priority first
        n = norm(r['name'])
        if n not in DENY: merged[n] = r
    for r in dbp:
        n = norm(r['name'])
        if n not in DENY: merged[n] = r
    for r in forbes:  # highest priority last (overwrites)
        n = norm(r['name'])
        if n not in DENY: merged[n] = r

    ranked = sorted(merged.values(), key=lambda x: -x['employees'])
    for i, r in enumerate(ranked, 1):
        r['rank'] = i

    out = {
        'meta': {
            'built': '2026-09-29',
            'method': 'Forbes G2000+Private (US) + DBpedia (US HQ) + Wikidata (SEC-matched, US-filtered). Dedupe priority: Forbes > DBpedia > Wikidata. Employee counts are organization-wide as reported by each source, not US-only or establishment-level.',
            'sources': {
                'forbes-g2000-2025': 'Forbes Global 2000 2025 API, US entries with employee counts',
                'forbes-private-2025': 'Forbes America\'s Top Private Companies 2025 API',
                'dbpedia': 'DBpedia SPARQL (Wikipedia infoboxes), HQ country = US, snapshot 2026-09-29',
                'wikidata-p1128': 'Wikidata P1128, SEC-ticker-matched, US-filtered, snapshot 2026-09-29',
            },
            'coverage_note': 'Headcounts are organization-wide. HQ city geocoded to ZIP separately. Does NOT represent establishment-level employment by ZIP.',
        },
        'employers': ranked,
    }
    op = os.path.join(DATA, 'employers_ranked.json')
    json.dump(out, open(op, 'w'), indent=1)
    print(f'wrote {op}: {len(ranked)} ranked employers')
    print('top 10:')
    for r in ranked[:10]:
        print(f"  {r['rank']}. {r['name'][:45]}: {r['employees']:,} [{r['source']}]")

if __name__ == '__main__':
    main()
