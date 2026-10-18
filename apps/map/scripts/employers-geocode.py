#!/usr/bin/env python3
"""
Geocode employer HQ cities to ZIP codes via Nominatim (OSM).

For each unique city: search -> lat/lon + state, then reverse-geocode
the center point -> postcode (ZIP). Results cached in city_geocodes.json
so re-runs only fetch new cities. Respects 1 req/sec.

Input:  lib/companies/data/employers_ranked.json
Output: lib/companies/data/city_geocodes.json  {city: {state, zip, lat, lon}}
"""
import json, os, time, urllib.request, urllib.parse

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, 'lib', 'companies', 'data')
CACHE = os.path.join(DATA, 'city_geocodes.json')
UA = 'scout-atlas/1.0 (open-source employer map; contact: atlas project)'

CITY_FIX = {
    'New York City': 'New York',
    'City of Industry': 'Industry',
}

def norm_city(c):
    c = (c or '').strip()
    return CITY_FIX.get(c, c)

def api(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)

def geocode_city(city):
    q = urllib.parse.urlencode({'city': city, 'country': 'United States',
                                'format': 'json', 'limit': 1})
    res = api(f'https://nominatim.openstreetmap.org/search?{q}')
    time.sleep(1.1)
    if not res:
        return None
    r = res[0]
    lat, lon = r['lat'], r['lon']
    # reverse-geocode center for postcode
    q2 = urllib.parse.urlencode({'lat': lat, 'lon': lon, 'format': 'json',
                                 'addressdetails': 1})
    rev = api(f'https://nominatim.openstreetmap.org/reverse?{q2}')
    time.sleep(1.1)
    addr = rev.get('address', {})
    return {
        'state': addr.get('state'),
        'zip': (addr.get('postcode') or '').split('-')[0][:5] or None,
        'lat': float(lat), 'lon': float(lon),
        'resolved_name': r.get('display_name', '').split(',')[0],
    }

def main():
    emps = json.load(open(os.path.join(DATA, 'employers_ranked.json')))['employers']
    cities = sorted({norm_city(e.get('city') or (e.get('hq_raw') or '').split(',')[0])
                     for e in emps} - {''})
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    todo = [c for c in cities if c not in cache]
    print(f'{len(cities)} unique cities, {len(todo)} to geocode')
    for i, c in enumerate(todo, 1):
        try:
            g = geocode_city(c)
            cache[c] = g or {'error': 'not found'}
            print(f'[{i}/{len(todo)}] {c}: {cache[c].get("zip")} {cache[c].get("state")}')
        except Exception as ex:
            cache[c] = {'error': str(ex)[:120]}
            print(f'[{i}/{len(todo)}] {c}: ERROR {ex}')
        json.dump(cache, open(CACHE, 'w'), indent=1)
    ok = sum(1 for v in cache.values() if v.get('zip'))
    print(f'done: {ok}/{len(cache)} cities have ZIPs')

if __name__ == '__main__':
    main()
