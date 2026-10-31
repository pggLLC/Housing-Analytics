"""Build data/derived/funding-map.json for the region and town map on
where-housing-money-goes.html.

Reads only files already in data/: the CHFA and OEDIT award ledger, the DOLA
award list, CHFA's tax credit property list, the deal summaries, and the Census
county and place boundaries. It places each award on a project site, town,
county and state planning region, and adds region outlines for the map.

    python3 scripts/funding/build_funding_map.py

Needs shapely (pip install shapely). Rerun after any of those inputs change.
"""
import json, re, collections, math, os, importlib.util
if importlib.util.find_spec("shapely") is None:  # the derived chain runs in workflows that only install what they fetch with
    import subprocess, sys
    subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "shapely==2.1.1"], check=True)
from shapely.geometry import shape, Point, mapping
from shapely.ops import unary_union

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HA = os.path.join(ROOT, "data")
OUT = os.path.join(HA, "derived", "funding-map.json")


def load_json(path):
    with open(path) as fh:
        return json.load(fh)

REGIONS = {
  1: ("Northeast", ["Logan", "Morgan", "Phillips", "Sedgwick", "Washington", "Yuma"]),
  2: ("Larimer and Weld", ["Larimer", "Weld"]),
  3: ("Denver metro", ["Adams", "Arapahoe", "Boulder", "Broomfield", "Clear Creek", "Denver", "Douglas", "Gilpin", "Jefferson"]),
  4: ("Pikes Peak", ["El Paso", "Park", "Teller"]),
  5: ("Eastern plains", ["Cheyenne", "Elbert", "Kit Carson", "Lincoln"]),
  6: ("Southeast", ["Baca", "Bent", "Crowley", "Kiowa", "Otero", "Prowers"]),
  7: ("Pueblo", ["Pueblo"]),
  8: ("San Luis Valley", ["Alamosa", "Conejos", "Costilla", "Mineral", "Rio Grande", "Saguache"]),
  9: ("Southwest", ["Archuleta", "Dolores", "La Plata", "Montezuma", "San Juan"]),
  10: ("Gunnison and Uncompahgre", ["Delta", "Gunnison", "Hinsdale", "Montrose", "Ouray", "San Miguel"]),
  11: ("Northwest", ["Garfield", "Mesa", "Moffat", "Rio Blanco"]),
  12: ("Northern mountains", ["Eagle", "Grand", "Jackson", "Pitkin", "Routt", "Summit"]),
  13: ("Upper Arkansas", ["Chaffee", "Custer", "Fremont", "Lake"]),
  14: ("South central", ["Huerfano", "Las Animas"]),
}

def norm(s):
    s = (s or "").lower().replace("&", " and ").replace("@", " at ")
    s = re.sub(r"\bmhp\b", "mobile home park", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    # program tags in award reports (THLF, TAHG, PSH) and "Phase" are not part of the project's name
    w = [x for x in s.split() if x not in ("the", "apartments", "apartment", "apts", "apt")]
    t = [x for x in w if x not in ("thlf", "tahg", "psh", "phase")]
    if len(t) >= 2: w = t
    return " ".join(w)

# ---------- geography
cf = load_json(f"{HA}/boundaries/counties_co.geojson")["features"]
CNTY = {f["properties"]["GEOID"]: {"name": f["properties"]["NAME"], "geom": shape(f["geometry"])} for f in cf}
NAME2FIPS = {v["name"]: k for k, v in CNTY.items()}
REG_OF = {}
for r, (_, cs) in REGIONS.items():
    for c in cs: REG_OF[NAME2FIPS[c]] = r
assert len(REG_OF) == 64

pf = load_json(f"{HA}/co-place-boundaries.geojson")["features"]
PLACES = {}
PNAME = collections.defaultdict(list)
for f in pf:
    p = f["properties"]; g = shape(f["geometry"])
    nm = re.sub(r" (city|town|CDP|city and county)$", "", p["name"]).replace(" city and county", "")
    c = g.representative_point()
    fips = next((k for k, v in CNTY.items() if v["geom"].contains(c)), None)
    PLACES[p["geoid"]] = {"name": nm, "lat": c.y, "lng": c.x, "county": fips, "cdp": p["name"].endswith("CDP"), "geom": g}
    PNAME[norm(nm)].append(p["geoid"])

def place_for(town, fips=None):
    if not town: return None
    t = norm(re.sub(r"^(city|town) of ", "", town.strip(), flags=re.I))
    t = {"denver city and county": "denver", "unincorporated": ""}.get(t, t)
    ids = PNAME.get(t, [])
    # "Robins Way Montrose": a street printed before the town; use the town after the street word
    sm = None if ids else re.search(r"\b(street|st|avenue|ave|way|road|rd|drive|dr|boulevard|blvd|lane|ln|court|ct|parkway|pkwy)\b\.?\s+(.+)$", town.strip(), re.I)
    if sm: ids = PNAME.get(norm(sm.group(2)), [])
    if fips: ids = [i for i in ids if PLACES[i]["county"] == fips] or ids
    if len(ids) > 1: ids = [i for i in ids if not PLACES[i]["cdp"]] or ids
    return ids[0] if ids else None

def place_at(lat, lng):
    pt = Point(lng, lat)
    for k, v in PLACES.items():
        if v["geom"].contains(pt): return k
    return None

# ---------- CHFA property list (points)
LI = load_json(f"{HA}/chfa-lihtc.json")["features"]
LIHTC = []
for f in LI:
    p = f["properties"]; lng, lat = f["geometry"]["coordinates"]
    LIHTC.append(dict(name=p["PROJECT"], key=norm(p["PROJECT"]), city=p["PROJ_CTY"], addr=p.get("PROJ_ADD"), fips=p["CNTY_FIPS"], lat=lat, lng=lng,
                      homes=p.get("LI_UNITS") or p.get("N_UNITS"), year=p.get("AwardYear") or p.get("YR_ALLOC"), credit=p.get("TypeOfCredits") or p.get("CREDIT")))
LBYKEY = collections.defaultdict(list)
for x in LIHTC: LBYKEY[x["key"]].append(x)

def lihtc_match(name, fips, town=None, homes=None):
    k = norm(name); c = LBYKEY.get(k, [])
    # never borrow a same-named property in another county, unless it is in the same named town (towns that cross county lines)
    if fips: c = [x for x in c if x["fips"] == fips] or [x for x in c if town and norm(x["city"]) == norm(re.sub(r"^(city|town) of ", "", town, flags=re.I))]
    if c: return c[0]
    # loose: one name contains the other, same county
    if fips and len(k) >= 8:
        c = [x for x in LIHTC if x["fips"] == fips and (k in x["key"] or x["key"] in k) and len(x["key"]) >= 8]
        # a partial name match is rejected when both home counts are known and one is over twice the other (a different project)
        if len(c) == 1 and not (homes and c[0]["homes"] and not 0.5 <= homes / c[0]["homes"] <= 2): return c[0]
    return None

# ---------- sites, towns, awards
SITES = {}; TOWNS = {}; AW = []

def town_key(pid=None, fips=None, region=None):
    if pid:
        p = PLACES[pid]; k = "p" + pid
        TOWNS.setdefault(k, {"name": p["name"], "county": p["county"], "region": REG_OF[p["county"]], "lat": p["lat"], "lng": p["lng"], "kind": "place"})
        return k
    if fips:
        k = "c" + fips; g = CNTY[fips]["geom"].representative_point()
        TOWNS.setdefault(k, {"name": f"{CNTY[fips]['name']} County, outside towns or town not printed", "county": fips, "region": REG_OF[fips], "lat": g.y, "lng": g.x, "kind": "county"})
        return k
    k = f"r{region}"
    TOWNS.setdefault(k, {"name": "Several counties or regional programs", "county": None, "region": region, "lat": None, "lng": None, "kind": "region"})
    return k

def site_for(name, town, fips, lat=None, lng=None, addr=None, homes=None, approx=None):
    """One site per project; exact point from the CHFA list when the name matches."""
    if not name:
        name = "Project not named in the record"; m = None; key = f"unnamed{len(SITES)}|{fips}"
    else:
        m = lihtc_match(name, fips, town, homes)
        key = norm(m["name"] if m else name) + "|" + (fips or "")
    if key in SITES:
        s = SITES[key]
        if homes and not s["homes"]: s["homes"] = homes
        return key
    if lat is None and m: lat, lng, addr, approx = m["lat"], m["lng"], m["addr"], False
    pid = place_for(town, fips) if town else None
    if lat is None:
        if pid: lat, lng, approx = PLACES[pid]["lat"], PLACES[pid]["lng"], True
        elif fips:
            g = CNTY[fips]["geom"].representative_point(); lat, lng, approx = g.y, g.x, True
        else: return None
    if not pid: pid = place_at(lat, lng) if not approx else None
    tk = town_key(pid, fips)
    SITES[key] = dict(id=f"s{len(SITES)+1:04d}", name=(m["name"] if m and len(m["name"]) >= len(name or "") else name), town=tk,
                      address=addr or (town or ""), lat=round(lat, 6), lng=round(lng, 6), homes=homes or (m["homes"] if m else None), approximate=bool(approx))
    return key

def add(site_key, town_k, year, ylab, agency, program, recipient, amount, unit, flag, st, su, region=None, county=None):
    if site_key:
        s = SITES[site_key]; town_k = s["town"]
    t = TOWNS[town_k]
    counts = unit == "usd" and amount is not None and flag not in ("requested", "unconfirmed")
    # a town that spans counties is grouped once, but each award keeps the county its record prints,
    # as long as the town actually reaches into that county (otherwise the record's county is a typo)
    if county != t["county"] and not (county and town_k.startswith("p") and PLACES[town_k[1:]]["geom"].intersection(CNTY[county]["geom"]).area > 0):
        county = t["county"]
    AW.append(dict(id=f"a{len(AW)+1:04d}", site=SITES[site_key]["id"] if site_key else None, town=town_k, county=county, region=t["region"],
                   year=year, year_label=ylab, agency=agency, program=program, recipient=recipient, amount=amount, amount_unit=unit,
                   counts_in_totals=counts, flag=flag, source_title=st, source_url=su))

UNMAPPED = []  # awards with no county or known place: kept for the statewide downloads, never pinned
def unmapped(year, agency, program, name, recipient, amount, unit, flag, st, su):
    UNMAPPED.append(dict(year=year, agency=agency, program=program, name=name, recipient=recipient, amount=amount, amount_unit=unit, flag=flag, source_title=st, source_url=su))

# 1. CHFA and OEDIT ledger
L = load_json(f"{HA}/policy/funding-awards/ledger.json")["awards"]
FIXNAME = {"Adams County Housing Authority N,S Crossing Pointe Phase I": "Crossing Pointe Phase I", "Community Housing Development Association N,S Cornell Senior Apartments": "Cornell Senior Apartments",
  "Four Corners Development, LLC N,S Woodgate Trails Apartments": "Woodgate Trails Apartments", "Grand Junction Housing Authority N,S Highlands 2": "Highlands 2",
  "N,F Aria Apartments Phase II Rose LLC": "Aria Apartments Phase II", "N,F Trinidad Artspace Lofts Artspace Projects, Inc.": "Trinidad Artspace Lofts",
  "N,F Walnut Street Lofts Medici Development LLC": "Walnut Street Lofts", "N,F Wintergreen Apartments Gorman & Company, Inc.": "Wintergreen Apartments",
  "N,H Freedom Springs Vecino Bond Group, LLC": "Freedom Springs", "N,H Providence at the Heights Blueline Development": "Providence at the Heights"}
# wrapped-cell fixes for the Prop 123 Land Banking rows (the same file build_land_banking_awards.py applies)
LBFIX = load_json(f"{HA}/policy/funding-awards/land-banking-corrections.json")["corrections"]
for a in L:
    a = dict(a)
    fix = LBFIX.get(f"{a.get('fiscal_year')}|{a['name']}") if a["program"] == "Prop 123 Land Banking" else None
    if fix:
        a.update({k: fix[k] for k in ("name", "sponsor", "location", "county_fips") if fix.get(k)})
        if fix.get("show_project"): a["name"] = fix["show_project"]
    a["name"] = FIXNAME.get(a["name"], a["name"])
    if a["sponsor"] and re.fullmatch(r"[\d ,.]+", a["sponsor"]): a["sponsor"] = None
    fips = a["county_fips"]
    if not fips:
        pid = place_for(a["location"]); fips = PLACES[pid]["county"] if pid else None
    if not fips:
        st = f"{'CHFA' if a['agency']=='CHFA' else 'OEDIT/CHFA'} award report: {a['source_file']}"
        if a["agency"] == "CHFA":
            for fld, lab, unit in (("federal_credit", "Federal housing tax credits", "usd_per_year_tax_credit"), ("state_credit", "State housing tax credits", "usd_per_year_tax_credit"),
                                   ("toc_credit", "Transit-oriented communities credits", "usd_per_year_tax_credit"), ("mihtc_credit", "Middle-income housing tax credits", "usd_per_year_tax_credit"),
                                   ("bond_amount", "Private activity bonds", "usd_bonds")):
                if a.get(fld): unmapped(a["year"], "CHFA", lab, a["name"], a["sponsor"], a[fld], unit, None, st, a["source_url"])
        else:
            amt = a["amount_awarded"]; flag = None
            if amt is None and a["amount_requested"]: amt, flag = a["amount_requested"], "requested"
            unmapped(a["year"], "OEDIT", a["program"] + (f" ({a['detail']})" if a.get("detail") else ""), a["name"], a["sponsor"], amt, "usd", flag, st, a["source_url"])
        continue
    if not a["name"] and a["sponsor"]:
        # the PDF reader sometimes folds the project name into the owner column
        sp = norm(a["sponsor"]); cand = [x["name"] for x in LIHTC if x["fips"] == fips] + [v["name"] for v in SITES.values() if v["name"]]
        cand += [d["name"] for d in load_json(f"{HA}/deals/index.json")["deals"]]
        hit = sorted([c for c in cand if len(norm(c)) >= 6 and norm(c) in sp], key=len, reverse=True)
        if hit: a["name"] = hit[0]
    sk = site_for(a["name"], a["location"], fips, homes=a["restricted_units"] or a["total_units"])
    yl = str(a["year"]) + (f" Round {a['round']}" if a.get("round") else "")
    st = f"{'CHFA' if a['agency']=='CHFA' else 'OEDIT/CHFA'} award report: {a['source_file']}"
    if a["agency"] == "CHFA":
        typ = (a.get("federal_credit_type") or a["program"].replace(" + state", "")).replace("LIHTC", "housing tax credits")
        if a["federal_credit"]: add(sk, None, a["year"], yl, "CHFA", f"Federal {typ.replace('housing tax credits','').strip()} housing tax credits".replace("  ", " "), a["sponsor"], a["federal_credit"], "usd_per_year_tax_credit", None, st, a["source_url"], county=fips)
        for fld, lab in (("state_credit", "State housing tax credits"), ("toc_credit", "Transit-oriented communities credits"), ("mihtc_credit", "Middle-income housing tax credits")):
            if a.get(fld): add(sk, None, a["year"], yl, "CHFA", lab, a["sponsor"], a[fld], "usd_per_year_tax_credit", None, st, a["source_url"], county=fips)
        if a.get("bond_amount"): add(sk, None, a["year"], yl, "CHFA", "Private activity bonds", a["sponsor"], a["bond_amount"], "usd_bonds", None, st, a["source_url"], county=fips)
        if not (a["federal_credit"] or a.get("state_credit") or a.get("mihtc_credit")):
            add(sk, None, a["year"], yl, "CHFA", a["program"].replace("LIHTC", "Housing tax credits"), a["sponsor"], None, "usd_per_year_tax_credit", None, st, a["source_url"], county=fips)
    else:
        amt = a["amount_awarded"]; flag = None
        if amt is None and a["amount_requested"]: amt, flag = a["amount_requested"], "requested"
        prog = a["program"] + (f" ({a['detail']})" if a.get("detail") else "")
        add(sk, None, a["year"], str(a["year"]), "OEDIT", prog, a["sponsor"], amt, "usd", flag, st, a["source_url"], county=fips)

def HINTS(s):
    """Region or county for awards that print no town, from the recipient's own service area."""
    s = s.lower()
    for pat, v in [(r"4995 washington|wish community|metro denver", "Denver"), (r"chaffee housing trust", "Chaffee"), (r"larimer|loveland", "Larimer"),
                   (r"mesa, garfield and rio blanco", 11), (r"southeast colorado enterprise|seced|secrha", 6), (r"uaacog|upper arkansas area", 13),
                   (r"san luis valley", 8), (r"southwest|homesfund|housing solutions for the southwest", 9), (r"paradox", "Montrose")]:
        if re.search(pat, s): return NAME2FIPS[v] if isinstance(v, str) else v
    return None

# 2. Division of Housing and Division of Local Government awards
DA = load_json(f"{HA}/policy/funding-awards/dola-awards.json")["awards"]
# one award reported in two documents (a board vote summary and the press release, or a vote and the annual report)
# is counted once: same recipient and amount, a year or less apart, different documents. The fuller record is kept and
# the other document is named beside its source.
def _rank(a):
    t = a["source_type"].lower()
    return 0 if "annual report" in t else 1 if "vote" in t else 2 if "press" in t else 3
_seen = {}
for a in sorted(DA, key=_rank):
    if a["amount"] is None: continue
    k = (norm(re.sub(r"\d", "", a["grantee"] or ""))[:24], a["amount"])
    first = next((b for b in _seen.get(k, []) if abs(b["year"] - a["year"]) <= 1 and b["source_title"] != a["source_title"]), None)
    if first:
        a["_dup"] = True; first["source_title"] += "; also reported in " + a["source_title"]
        # the kept record takes a town or county from the other document when it has none
        if not first.get("town") and not first.get("county_fips"): first["town"], first["county_fips"] = a.get("town"), a.get("county_fips")
    else: _seen.setdefault(k, []).append(a)
DA = [a for a in DA if not a.get("_dup")]
for a in DA:
    fips = a["county_fips"]; town = a["town"]
    # a statewide program is not a local award, whatever office address the record carries
    if re.search(r"\bstate-?wide\b", a["name"] or "", re.I): fips = town = None
    if not town and a.get("grantee"):
        m = re.match(r"(?:City|Town) of ([A-Z][\w .]+?)(?:,|$| and )", a["grantee"])
        if m: town = m.group(1)
    # a street address with a mailing town ("th Avenue Denver") yields to a city grantee named in the award ("City of Aurora")
    gm = re.match(r"(?:City|Town) of ([A-Z][\w .]+?)(?:,|$| and )", a.get("grantee") or "")
    if town and gm and not PNAME.get(norm(town)) and place_for(gm.group(1)) and place_for(town) != place_for(gm.group(1)): town = gm.group(1)
    if not fips and town:
        pid = place_for(town); fips = PLACES[pid]["county"] if pid else None
    agency = "DOLA" if a["program"].startswith("DLG") else "DOH"
    flag = "requested" if a["amount_basis"] == "requested" else ("unconfirmed" if a["source_type"].startswith("news") else None)
    hint = HINTS(" ".join(x or "" for x in (a["name"], a["grantee"])))
    if not fips and hint:
        if isinstance(hint, int):
            add(None, town_key(None, None, hint), a["year"], a.get("announced") or str(a["year"]), agency, a["program_as_printed"] or a["program"], a["grantee"], a["amount"], "usd", flag, a["source_title"], a["source_url"])
            continue
        fips = hint
        if not town and fips == NAME2FIPS["Denver"]: town = "Denver"
    if not fips:
        unmapped(a["year"], agency, a["program"], a["name"], a["grantee"], a["amount"], "usd", flag, a["source_title"], a["source_url"])
        continue
    proj = a["name"]
    is_site = bool(proj) and not re.search(r"(DPA|down payment|program|funding recommendations|capacity|planning|rehab program|homeowner)", proj, re.I)
    sk = site_for(proj, town, fips, homes=a["homes"]) if is_site else None
    tk = None if sk else town_key(place_for(town, fips) if town else None, fips)
    add(sk, tk, a["year"], a.get("announced") or str(a["year"]), agency, a["program_as_printed"] or a["program"], a["grantee"], a["amount"], "usd", flag, a["source_title"], a["source_url"], county=fips)

# 3. Credit properties awarded before 2016 (CHFA list gives year and homes, no amount)
for x in LIHTC:
    if not x["year"] or x["year"] >= 2016: continue
    sk = site_for(x["name"], x["city"], x["fips"], x["lat"], x["lng"], x["addr"], x["homes"], False)
    add(sk, None, x["year"], str(x["year"]), "CHFA", f"{x['credit'] or 'Housing tax credits'} (amount not published)", None, None, "usd_per_year_tax_credit", None,
        "CHFA Housing Tax Credit property list", "https://www.chfainfo.com/rental-housing/housing-credit", county=x["fips"])

INPUT_DATE = max(load_json(f"{HA}/policy/funding-awards/ledger.json")["meta"]["generated_at"][:10],
                 load_json(f"{HA}/policy/funding-awards/dola-awards.json")["meta"]["captured"][:10])

# ---------- capital stacks
STK = {}
def money(s):
    m = re.search(r"\$\s?([\d,]+(?:\.\d+)?)\s*(million|m\b|k\b|thousand|billion)?", s, re.I)
    if not m: return None
    # malformed thousands grouping ("$725,00") is ambiguous, so it is left uncounted
    g = m.group(1).rstrip(",")
    if "," in g and not re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", g): return None
    v = float(g.replace(",", "")); u = (m.group(2) or "").lower()
    if u == "billion": v *= 1e9
    elif u in ("million", "m"): v *= 1e6
    elif u in ("k", "thousand"): v *= 1e3
    return round(v)
FIG = r"\$\s?[\d,]+(?:\.\d+)?\s*(?:million|m\b|k\b|thousand|billion)?"
# a second figure that is another report, a cap, a range or an estimate: keep the first figure only
ALT = re.compile(r"\bor\b|\bto\b|up to|not to exceed|\bper (?!unit|home|door)|\((?:chfa|award|bond|presentation|trade|budget|council)|award report|bond counsel|"
                 r"says|narrative|as printed|estimated|valued|value\b|applied for|assumed|inferred|sold|placed|allows|preliminary award|recital|table|at acquisition|"
                 r"a year|per year|\$[\d.,]+\s*[mk]?\s*[-\u2013]\s*\$", re.I)
def money_total(s):
    """Amount for a stack row. Joined parts ("$800,000 loan and $190,000 grant") are added; for a
    construction/permanent split only the permanent part counts; anything else keeps the first figure."""
    s = re.sub(r"of an? " + FIG, "", s, flags=re.I)  # "$800,000 of a $1.6M loan": the whole loan is not this row's
    pct = re.search(r"(\d+(?:\.\d+)?)\s*%\s+of\s+(?:the\s+|an?\s+)?(" + FIG + r")", s, re.I)  # "80% of the $3.8M land price"
    if pct: return round(float(pct.group(1)) / 100 * money(pct.group(2)))
    tot = re.search(r"\((?:about|total) (" + FIG + r")\)", s, re.I)  # "$63M and $33.7M (about $96.7M)"
    if tot: return money(tot.group(1))
    figs = list(re.finditer(FIG + r"([^$;,/+]*)", s, re.I))
    if len(figs) < 2: return money(s)
    perm = [f for f in figs if re.match(r"\s*\(?permanent", f.group(1), re.I)]
    if perm: return add_all(perm)
    keep = [f for f in figs if not re.match(r"\s*(construction|pab|bonds?)\b", f.group(1), re.I)]
    if ALT.search(s) or not keep: return money(s)
    return add_all(keep)
def add_all(figs):
    vals = [money(f.group(0)) for f in figs]
    return None if None in vals else sum(vals)
def classify(src, amt):
    s = src.lower(); a = amt.lower()
    if re.search(r"total (estimated |projected )?(development |project )?cost|^tdc|development budget|total budget", s): return "tdc", "perm"
    if re.search(r"^(total|planned permanent sources|permanent sources|sources|closing)|sources, closing|procured sources", s): return "summary", "summary"
    # operating support (vouchers, rent subsidies, services contracts) pays after opening, so it is shown, never added
    operating = re.search(r"voucher|services funding|operating|rent(al)? subsid|subsidy agreement|services agreement|supportive services|rent(al)? assistance|tenan(cy|t) support|support(ive)? services|services (grant|contract)", s)
    if not operating and ("per year" in a or ("credit" in s and "equity" not in s) or re.search(r"\b(toc|mihtc)\b", s)): return "credits", "summary"
    if "bond" in s or re.search(r"volume cap|\bpab\b|revenue notes?|tax-exempt (multifamily )?(housing )?notes?", s) and not re.search(r"\bhome\b", s): return "bonds", "summary"
    # costs (uses of money), not sources: shown, never added
    # money the project pays out (to a transit service, a fund, a district) is a cost, not a source
    if re.search(r"^(contribution|payment|donation) to\b", s): return "cost", "summary"
    # a services, operating or replacement reserve is money the project sets aside (a use), not a source
    if re.search(r"\b(tenant |supportive )?(services?|operating|replacement|lease-?up|capitalized) reserves?\b", s): return "cost", "summary"
    if re.search(r"acquisition (price|cost)|purchase price|sale price|construction contract|hard cost|soft cost|rehab(ilitation)? (cost|budget|contract)|cost of|proposed budget", s): return "cost", "summary"
    inkind = re.search(r"waiver|exemption|abatement|saved|savings|donat|land lease|ground lease|in-kind|fee reduction|(fee|tax|permit|tap|impact|use tax|sales tax)( \w+)? rebate|rebate of (\w+ )?(fees?|tax)|discount|price concession|price (cut|reduction)|^land$|land contribution", s + " " + a)
    # infrastructure or public works (a sidewalk, a road or utility extension, site cleanup) done for the project is in-kind; a grant, loan or capital payment for it is cash
    inkind = inkind or re.search(r"paid separately", s) or (re.search(r"infrastructure|sidewalk|streetscape|curb and gutter|public works|remediation|clean-?up|demolition|(road|street|utility|sewer|water) (improvements?|extension|line)", s + " " + a) and not re.search(r"grant|loan|capital|cash|fund|\$", s))
    # a loan or grant that pays for a lease or land payment is cash, not an in-kind contribution
    if inkind and re.search(r"\b(loan|grant) (refunding|for|to pay|paying|covering)\b", s): inkind = None
    # tax credit equity only; owner, city or in-kind land equity falls through to its own category
    if "equity" in s and not inkind and "deferred develop" not in s and (re.search(r"credit|lihtc|45l|syndicat|investor", s) or not re.search(r"developer|owner|sponsor|private|city|town|county|land", s)): return "equity", "perm"
    # a developer fee is a project cost; only a deferred or contributed fee is money into the deal
    if re.search(r"developer fee", s) and not re.search(r"defer|contribut|loan|equity", s): return "cost", "summary"
    if re.search(r"deferred develop|developer fee|sponsor loan|seller|owner|general partner|sponsor equity|developer equity|private equity", s): cat = "owner"
    # a named federal program keeps its federal origin even when a state agency passes it through
    elif re.search(r"home investment partnerships?|\bhome (funds?|loan|program|grant)\b|\bcdbg\b|community development block grant|\barpa\b|american rescue plan|national housing trust fund|\bhtf\b|neighborhood stabilization|\bhud\b|section (8|811)\b|capital magnet|\busda\b|rural development|\bfhlb\b", s) and "risk share" not in s: cat = "federal"
    elif re.search(r"chfa|division of housing|\bdoh\b|dola|oedit|prop(osition)? 123|state housing board|colorado department|state of colorado|colorado energy|history colorado|transit oriented communities infrastructure|\btoci\b", s): cat = "state"
    elif re.search(r"\b(hud|home|cdbg|arpa|usda|epa|fhlb)\b|federal|environmental protection|section 8|congression|treasury|capital magnet|community development block grant|home investment partnerships?|national housing trust fund|neighborhood stabilization|american rescue plan|department of housing and urban development|rural development", s): cat = "federal"
    elif re.search(r"foundation|philanthrop|donor|gift|church|community fund|impact fund|(?<!housing )\btrust\b(?! fund)", s): cat = "gift"
    # a land bank holds land for a city or housing authority; it is not a bank loan
    elif re.search(r"city|county|town|housing authority|housing partners|\bbhp\b|land bank|district|denver|metro|authority|tribe|tribal|linkage|host\b", s): cat = "local"
    elif re.search(r"loan|mortgage|bank|debt|lender", s): cat = "debt"
    else: cat = "other"
    if operating: return ("federal" if re.search(r"voucher|hud|section (8|811)|rental assistance", s) else cat), "summary"
    if re.search(r"construction loan|bridge", s): return cat if cat != "other" else "debt", "construction"
    if inkind: return cat, "inkind"
    return cat, "perm"

idx = load_json(f"{HA}/deals/index.json")["deals"]
for d in idx:
    full = load_json(f"{HA}/deals/{d['slug']}.json")
    fips = NAME2FIPS.get((d.get("county") or "").replace(" County", ""))
    sk = None
    for nm in [d["name"]] + d["match"].get("names", []):
        k = norm(nm) + "|" + (fips or "")
        if k in SITES: sk = k; break
        m = lihtc_match(nm, fips, d["city"], d.get("units"))
        if m and norm(m["name"]) + "|" + fips in SITES: sk = norm(m["name"]) + "|" + fips; break
    if not sk:
        sk = site_for(d["name"], d["city"], fips, homes=d.get("units"))
        if not sk: continue
    srcs = {s["id"]: s for s in full.get("sources", [])}
    rows, tdc = [], None
    money_rows = []
    for m in full.get("money", []):
        # "X, Y and Z" with one amount for each part, where some parts are in-kind: split so the cash parts still count
        # (or "X plus Y", or "X and Y" with amounts set apart by semicolons, where the parts come from different kinds of funder)
        # separators inside parentheses, as in "(AHIF, Division of Housing funds)", do not split the label
        lp = [x.replace("\0", ",").replace("\1", " and ") for x in re.split(r",\s*(?:and\s+)?|\s+(?:and|plus)\s+", re.sub(r"\([^)]*\)", lambda p: p.group(0).replace(",", "\0").replace(" and ", "\1"), m["source"]))]; ap = re.split(r"\s+(?:and|plus)\s+|;\s*", m["amount"])
        if len(lp) >= 2 and len(lp) == len(ap) and all(re.search(r"\$\s?[\d,.]+", a) for a in ap):
            kinds = [classify(x, a)[1] == "inkind" for x, a in zip(lp, ap)]
            cats = {classify(x, a)[0] for x, a in zip(lp, ap)}
            if (any(kinds) and not all(kinds)) or (len(cats) > 1 and ((re.search(r"\splus\s", m["source"]) and not re.search(r"\s(and)\s|,", m["source"])) or (";" in m["amount"] and "," not in re.sub(r"\([^)]*\)", "", m["source"]) and not re.search(r"construction and permanent", m["source"], re.I)))):
                head = re.match(r"^((?:city|town|county)(?: of \w+)?)\s", lp[0], re.I)
                for x, a in zip(lp, ap):
                    if head and not x.lower().startswith(head.group(1).lower()): x = head.group(1) + " " + x
                    money_rows.append(dict(m, source=x, amount=a))
                continue
        # "X with Y match" priced as "$A applied for; $B match committed": the request and the committed match are separate rows
        wl = re.split(r"\s+with\s+", m["source"], maxsplit=1); wa = [x.strip() for x in m["amount"].split(";")]
        if len(wl) == 2 and len(wa) == 2 and all(re.search(r"\$\s?[\d,.]+", x) for x in wa) and re.search(r"committed|awarded|approved", wa[1], re.I):
            money_rows.append(dict(m, source=wl[0], amount=wa[0])); money_rows.append(dict(m, source=wl[1], amount=wa[1]))
            continue
        # "$5M and $3.4M" whose note says "the $3.4M is HOME funds": each part takes its own funder
        if len(ap) >= 2 and all(re.fullmatch(r"\$[\d,.]+\s*(?:million|m|k)?", x.strip(), re.I) for x in ap):
            said = {money(x.group(1)): x.group(2) for x in re.finditer(r"\bthe (\$[\d,.]+\s*(?:million|m\b|k\b)?) (?:is|are|was|were) ([^.;,(]+)", m.get("note") or "", re.I)}
            if any(money(x) in said for x in ap):
                for x in ap: money_rows.append(dict(m, source=m["source"] + (" (" + said[money(x)].strip() + ")" if money(x) in said else ""), amount=x.strip()))
                continue
        money_rows.append(m)
    for m in money_rows:
        cat, phase = classify(m["source"], m["amount"])
        # a fund named for the project's own town ("Fort Collins Affordable Housing Capital Fund") is local money
        if cat == "other" and d.get("city") and re.search(r"\b" + re.escape(norm(d["city"])) + r"\b", norm(m["source"])): cat = "local"
        amt = None if re.match(r"\s*(not public|not stated|none|n/a|unknown)", m["amount"], re.I) else money_total(m["amount"])
        s0 = srcs.get((m.get("src") or [None])[0]) or {}
        # a total cost for several properties or phases is not this project's total; it is listed as a cost
        if cat == "tdc" and re.search(r"\bcombined\b|both (properties|buildings|phases)|all phases|whole (project|campus)|campus", m["source"] + " " + m["amount"], re.I): cat, phase = "cost", "summary"
        if cat == "tdc":
            if amt and not tdc: tdc = {"amount": amt, "text": m["amount"], "source_title": s0.get("title", "COHO deal summary"), "source_url": s0.get("url", "")}
            continue
        # asked for but not confirmed: shown, never added
        if re.search(r"requested|request amount|applied for|none awarded|not awarded|\bgap\b(?! (loan|financ|fund))|shortfall|unfunded|still to (be )?raise|not yet raised|to be raised", m["amount"], re.I) or re.search(r"not verified|unverified|not confirmed|unconfirmed|not (yet )?committed|uncommitted|under consideration", (m.get("note") or "") + " " + m["source"], re.I) or re.search(r"\bcombined\b|whole project|funding plan|overall", m["source"], re.I) or \
           re.search(r"whole (first )?phase|whole project|campus|all phases|entire (site|project|neighborhood)|whole neighborhood", m["amount"], re.I): phase = "summary"
        # temporary money retired at permanent conversion is short-term; a balance paid down at conversion counts at the kept amount
        note = m.get("note") or ""
        if phase == "perm" and re.search(r"(paid|repaid) off at (permanent )?conversion|repaid at (permanent )?conversion", note, re.I): phase = "construction"
        # an unattributed row whose note says the project buys or pays for something is a cost (a use), not a source
        if phase == "perm" and cat == "other" and re.search(r"\b(buys|pays|purchases)\b", note) and not re.search(r"grant|loan|fund|note|carryback", m["source"], re.I): cat, phase = "cost", "summary"
        # earlier money for a prior deal on the site, and nominal land prices, are shown, not added
        if phase == "perm" and (re.search(r"^earlier\b|\(history\)", m["source"], re.I) or re.search(r"\bnominal\b", m["amount"], re.I)): phase = "summary"
        # money labeled for another phase or closing of the same project ("closing A" on a Phase B deal) is shown, not added
        dp = re.search(r"\bphase\s+([a-z0-9]+)\b", d["name"], re.I)
        lp_ = [x.lower() for x in re.findall(r"\b(?:phase|closing)\s+([a-z0-9]+)\b", m["source"], re.I)]
        # roman numerals read as numbers, and a sub-phase ("IA") belongs to its phase ("1")
        _ph = lambda t: re.sub(r"^(iii|ii|i)(?=[a-z]?$)", lambda r: str(len(r.group(1))), t.lower())
        if phase == "perm" and dp and lp_ and not any(_ph(dp.group(1)).startswith(_ph(x)) for x in lp_): phase = "summary"
        # one award shared with another property, with no published split, is shown, not added
        if phase == "perm" and re.search(r"shared with|split (is )?not (public|stated|published)|split between", m["amount"] + " " + note, re.I): phase = "summary"
        # an amount whose note says it bundles land or other in-kind support with cash is shown, not added
        if phase == "perm" and re.search(r"^\s*(land contribution|land donation|donated land|in-kind)", note, re.I): phase = "summary"
        pd = re.search(r"paid down to (\$[\d,.]+\s*(?:million|m\b|k\b)?) at (permanent )?conversion", note, re.I)
        if phase == "perm" and pd and money(pd.group(1)): amt = money(pd.group(1))
        # a note that splits the amount into waived fees or in-kind help plus a stated cash part counts only the cash
        cm = re.search(r"(\$[\d,.]+\s*(?:million|m\b|k\b)?) cash\b", note, re.I)
        if phase == "perm" and cm and money(cm.group(1)) and re.search(r"waiv|fee (relief|reduction|rebate)|in-kind|donat", note, re.I): amt = money(cm.group(1))
        # an amount whose note lists it as cash mixed with fee waivers or tax exemptions, with no cash part stated, is shown, not added
        n1 = re.split(r"(?<=[a-z)])\.\s", note, maxsplit=1)[0]
        if phase == "perm" and not cm and "," in n1 and re.search(r"\b(funds?|grants?|loans?|cash)\b", n1, re.I) and re.search(r"fee waivers?|waived fees|tax exemptions?", n1, re.I) and not re.search(r"^\s*plus\b|\b(also|possible|possibly)\b", n1, re.I): phase = "summary"
        # a per-home figure is not the project's total, so it is shown but never added
        if re.search(r"per (\w+ ){0,2}(unit|home|door|apartment)s?\b|/\s*(unit|home)\b", m["amount"], re.I): phase = "perunit"
        rows.append({"label": m["source"], "category": cat, "amount": amt, "amount_text": m["amount"], "phase": phase,
                     "note": m.get("note") or "", "source_title": s0.get("title", "COHO deal summary"), "source_url": s0.get("url", "")})
        # a construction loan whose note says part of it converts to a permanent loan keeps that part as a permanent source
        cv = re.search(r"converts to an? (\$[\d,.]+\s*(?:million|m\b|k\b)?)[^.;]*?permanent loan", note, re.I)
        if phase == "construction" and cv and money(cv.group(1)):
            rows.append(dict(rows[-1], label=m["source"] + ", permanent portion", amount=money(cv.group(1)), amount_text=cv.group(1), phase="perm"))
    if not tdc:
        for k in full.get("key_numbers", []):
            v = k["value"]
            if re.search(r"\bcombined\b|both (properties|buildings|phases)|all phases|campus", k.get("label", "") + " " + v, re.I) or re.search(r"per (\w+ ){0,2}(unit|home)", k.get("label", ""), re.I): continue
            m2 = re.search(r"(\$[\d,.]+\s*(?:million|m\b|k\b)?)(?:\s*to\s*\$[\d,.]+\s*(?:million|m\b)?)?\s*(?:projected\s+)?(?:total (?:development |project )?(?:cost|budget)|project)", v, re.I)
            # a per-unit figure beside the total is fine; only a matched amount that is itself per unit is skipped
            if m2 and money(m2.group(1)) and not re.match(r"\s*(per (\w+ ){0,2}(unit|home)|/\s*(unit|home))", v[m2.end():], re.I):
                s0 = srcs.get((k.get("src") or [None])[0]) or {}
                tdc = {"amount": money(m2.group(1)), "text": v, "source_title": s0.get("title", "COHO deal summary"), "source_url": s0.get("url", "")}
                break
    if rows or tdc:
        STK[SITES[sk]["id"]] = {"origin": "deal_summary", "deal_url": f"deal-summary.html?d={d['slug']}", "deal_name": d["name"],
                                "tdc": tdc, "rows": rows, "not_added": [], "note": ""}

# ---------- write
for v in SITES.values():
    if v["name"] == "Fruita Mews": v["name"] = "The Fruita Mews"
# spread approximate pins that share a town center around a small ring so each can be tapped
grp = collections.defaultdict(list)
for v in SITES.values():
    if v["approximate"]: grp[(v["lat"], v["lng"])].append(v)
for (la, ln), vs in grp.items():
    if len(vs) < 2: continue
    for i, v in enumerate(vs):
        ang = 2 * math.pi * i / len(vs); rad = 0.0025 * (1 + i // 12)
        v["lat"] = round(la + rad * math.sin(ang), 6); v["lng"] = round(ln + rad * math.cos(ang) / math.cos(math.radians(la)), 6)
sites = [dict(v) for v in SITES.values() if any(a["site"] == v["id"] for a in AW)]
towns = {k: v for k, v in TOWNS.items() if any(a["town"] == k for a in AW)}
def gj(g, tol):
    g = g.simplify(tol, preserve_topology=True)
    def r(o):
        if isinstance(o, (list, tuple)):
            if o and isinstance(o[0], (int, float)): return [round(o[0], 4), round(o[1], 4)]
            return [r(x) for x in o]
        return o
    m = mapping(g); return {"type": m["type"], "coordinates": r(m["coordinates"])}
regions = {r: {"name": n, "counties": [NAME2FIPS[c] for c in cs],
               "shape": gj(unary_union([CNTY[NAME2FIPS[c]]["geom"] for c in cs]).buffer(0), 0.004)} for r, (n, cs) in REGIONS.items()}
out = {"title": "State housing awards in Colorado by region and town", "compiled": INPUT_DATE,
       "agencies": {"CHFA": "Colorado Housing and Finance Authority", "OEDIT": "Office of Economic Development and International Trade (Prop 123 fund, run with CHFA)",
                    "DOH": "DOLA Division of Housing", "DOLA": "DOLA Division of Local Government"},
       "regions": regions, "counties": {k: {"name": v["name"], "region": REG_OF[k]} for k, v in CNTY.items()},
       "towns": towns, "sites": sites, "awards": AW, "unmapped": UNMAPPED, "stacks": {k: v for k, v in STK.items() if any(s["id"] == k for s in sites)}}
with open(OUT, "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
c = collections.Counter(a["region"] for a in AW)
print(len(AW), "awards", len(sites), "sites", len(towns), "towns", len(UNMAPPED), "unmapped", len(out["stacks"]), "stacks", os.path.getsize(OUT) // 1024, "kB")
