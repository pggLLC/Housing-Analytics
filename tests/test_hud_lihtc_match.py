"""Matcher rules in scripts/hud/build_hud_lihtc_match.py."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'hud_match', Path(__file__).resolve().parent.parent / 'scripts' / 'hud' / 'build_hud_lihtc_match.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def chfa(name, addr, city, units, year, lon=-105.0, lat=39.7):
    return {'properties': {'PROJECT': name, 'PROJ_ADD': addr, 'PROJ_CTY': city,
                           'N_UNITS': units, 'AwardYear': year},
            'geometry': {'coordinates': [lon, lat]}}


def hud(name, addr, city, units, alloc, pis=None, lat=39.7, lon=-105.0):
    return {'PROJECT': name, 'PROJ_ADD': addr, 'PROJ_CTY': city, 'N_UNITS': units,
            'YR_ALLOC': alloc, 'YR_PIS': pis or alloc, 'LATITUDE': lat, 'LONGITUDE': lon}


def cand(c, h):
    return m.candidate(c['properties'], c['geometry']['coordinates'], h)


def test_same_project_matches():
    assert cand(chfa('Fall River Apartments', '321 Homestead Parkway', 'Longmont', 60, 2017),
                hud('FALL RIVER APARTMENTS', '321 HOMESTEAD PKWY', 'LONGMONT', 60, 2017))


def test_different_phase_never_matches():
    assert cand(chfa('Pines at Castle Rock I', '6221 Castlegate Drive West', 'Castle Rock', 248, 1995),
                hud('PINES AT CASTLE ROCK II', '6221 CASTLEGATE DR W', 'CASTLE ROCK', 248, 1996)) is None


def test_resyndication_years_apart_never_matches():
    assert cand(chfa('Studebaker', '1510 Blake Street', 'Denver', 33, 2019),
                hud('STUDEBAKER BUILDING', '1507 BLAKE ST', 'DENVER', 33, 1991)) is None


def test_renamed_property_at_same_address_matches():
    assert cand(chfa('Fitzsimmons Junction', '14155 East Montview Boulevard', 'Aurora', 126, 1997),
                hud('SANDCREEK APTS (AURORA)', '14155 E MONTVIEW BLVD', 'AURORA', 126, 1997))


def test_close_second_candidate_drops_the_record():
    c = [chfa('Cloverbasin Village III', '630 S. Peck Drive', 'Longmont', 84, 1999)]
    h = [hud('CLOVERBASIN VILLAGE III', '630 S PECK DR', 'LONGMONT', 84, 1999),
         hud('CLOVER BASIN VILLAGE III', '630 S PECK DR', 'LONGMONT', 84, 1999)]
    assert m.match(c, h) == {}
