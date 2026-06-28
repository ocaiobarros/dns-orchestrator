"""IATA airport → city/lat/lng lookup for upstream PoP resolution.

Used to map a DNS PoP code (e.g. ``gru17``, ``gig01``, ``lhr``) returned by
upstreams' CHAOS TXT id.server to an approximate geographic point, *without*
any external geoIP database. The mapping is a static table of well-known
airports covering the PoPs most commonly observed for Cloudflare / Google /
Quad9 from Brazil and the surrounding region.

The table is intentionally minimal and easy to extend: add an entry under
:data:`IATA_AIRPORTS` (uppercase 3-letter code) and the resolver picks it up
automatically.
"""

from __future__ import annotations

import re
from typing import Any

# 3-letter IATA → (city, country, lat, lng). Coordinates are airport lat/lng
# (approximate; granularity is "which city", not "which rack").
IATA_AIRPORTS: dict[str, tuple[str, str, float, float]] = {
    # ── Brazil ───────────────────────────────────────────────────────────
    "GRU": ("São Paulo", "BR", -23.4356, -46.4731),
    "CGH": ("São Paulo", "BR", -23.6266, -46.6554),
    "VCP": ("Campinas", "BR", -23.0074, -47.1345),
    "GIG": ("Rio de Janeiro", "BR", -22.8099, -43.2505),
    "SDU": ("Rio de Janeiro", "BR", -22.9105, -43.1631),
    "CNF": ("Belo Horizonte", "BR", -19.6244, -43.9719),
    "BSB": ("Brasília", "BR", -15.8697, -47.9208),
    "CWB": ("Curitiba", "BR", -25.5285, -49.1758),
    "POA": ("Porto Alegre", "BR", -29.9939, -51.1714),
    "FOR": ("Fortaleza", "BR", -3.7763, -38.5326),
    "REC": ("Recife", "BR", -8.1265, -34.9233),
    "SSA": ("Salvador", "BR", -12.9086, -38.3225),
    "MAO": ("Manaus", "BR", -3.0386, -60.0497),
    "BEL": ("Belém", "BR", -1.3791, -48.4763),
    "NAT": ("Natal", "BR", -5.9111, -35.2477),
    "FLN": ("Florianópolis", "BR", -27.6705, -48.5477),
    "VIX": ("Vitória", "BR", -20.2581, -40.2864),
    "SLZ": ("São Luís", "BR", -2.5853, -44.2341),
    # ── Latin America ────────────────────────────────────────────────────
    "EZE": ("Buenos Aires", "AR", -34.8222, -58.5358),
    "AEP": ("Buenos Aires", "AR", -34.5592, -58.4156),
    "SCL": ("Santiago", "CL", -33.3928, -70.7858),
    "LIM": ("Lima", "PE", -12.0219, -77.1143),
    "BOG": ("Bogotá", "CO", 4.7016, -74.1469),
    "UIO": ("Quito", "EC", -0.1292, -78.3575),
    "MVD": ("Montevideo", "UY", -34.8384, -56.0308),
    "ASU": ("Asunción", "PY", -25.2400, -57.5200),
    "MEX": ("Mexico City", "MX", 19.4361, -99.0719),
    "PTY": ("Panama City", "PA", 9.0714, -79.3833),
    "CCS": ("Caracas", "VE", 10.6013, -66.9911),
    # ── United States ────────────────────────────────────────────────────
    "MIA": ("Miami", "US", 25.7959, -80.2870),
    "IAD": ("Ashburn", "US", 38.9531, -77.4565),
    "DCA": ("Washington", "US", 38.8512, -77.0402),
    "JFK": ("New York", "US", 40.6413, -73.7781),
    "EWR": ("Newark", "US", 40.6895, -74.1745),
    "ATL": ("Atlanta", "US", 33.6407, -84.4277),
    "DFW": ("Dallas", "US", 32.8998, -97.0403),
    "ORD": ("Chicago", "US", 41.9742, -87.9073),
    "LAX": ("Los Angeles", "US", 33.9416, -118.4085),
    "SJC": ("San Jose", "US", 37.3639, -121.9289),
    "SFO": ("San Francisco", "US", 37.6213, -122.3790),
    "SEA": ("Seattle", "US", 47.4502, -122.3088),
    "DEN": ("Denver", "US", 39.8561, -104.6737),
    "PHX": ("Phoenix", "US", 33.4373, -112.0078),
    # ── Europe / EMEA ────────────────────────────────────────────────────
    "LHR": ("London", "GB", 51.4700, -0.4543),
    "LCY": ("London", "GB", 51.5053, 0.0553),
    "MAN": ("Manchester", "GB", 53.3537, -2.2750),
    "CDG": ("Paris", "FR", 49.0097, 2.5479),
    "AMS": ("Amsterdam", "NL", 52.3105, 4.7683),
    "FRA": ("Frankfurt", "DE", 50.0379, 8.5622),
    "MUC": ("Munich", "DE", 48.3538, 11.7861),
    "MAD": ("Madrid", "ES", 40.4983, -3.5676),
    "BCN": ("Barcelona", "ES", 41.2974, 2.0833),
    "MRS": ("Marseille", "FR", 43.4393, 5.2214),
    "MXP": ("Milan", "IT", 45.6306, 8.7281),
    "FCO": ("Rome", "IT", 41.8003, 12.2389),
    "VIE": ("Vienna", "AT", 48.1103, 16.5697),
    "ZRH": ("Zurich", "CH", 47.4647, 8.5492),
    "WAW": ("Warsaw", "PL", 52.1657, 20.9671),
    "DUB": ("Dublin", "IE", 53.4264, -6.2499),
    "ARN": ("Stockholm", "SE", 59.6498, 17.9237),
    "CPH": ("Copenhagen", "DK", 55.6181, 12.6561),
    "OSL": ("Oslo", "NO", 60.1939, 11.1004),
    "HEL": ("Helsinki", "FI", 60.3172, 24.9633),
    "IST": ("Istanbul", "TR", 41.2753, 28.7519),
    "DXB": ("Dubai", "AE", 25.2532, 55.3657),
    "JNB": ("Johannesburg", "ZA", -26.1392, 28.2460),
    "CPT": ("Cape Town", "ZA", -33.9648, 18.6017),
    # ── Asia / Pacific ───────────────────────────────────────────────────
    "HKG": ("Hong Kong", "HK", 22.3080, 113.9185),
    "NRT": ("Tokyo", "JP", 35.7720, 140.3929),
    "HND": ("Tokyo", "JP", 35.5494, 139.7798),
    "KIX": ("Osaka", "JP", 34.4347, 135.2440),
    "ICN": ("Seoul", "KR", 37.4602, 126.4407),
    "SIN": ("Singapore", "SG", 1.3644, 103.9915),
    "BKK": ("Bangkok", "TH", 13.6900, 100.7501),
    "KUL": ("Kuala Lumpur", "MY", 2.7456, 101.7099),
    "BOM": ("Mumbai", "IN", 19.0896, 72.8656),
    "DEL": ("New Delhi", "IN", 28.5562, 77.1000),
    "SYD": ("Sydney", "AU", -33.9399, 151.1753),
    "MEL": ("Melbourne", "AU", -37.6690, 144.8410),
    "AKL": ("Auckland", "NZ", -37.0082, 174.7850),
}


_IATA_RE = re.compile(r"^([a-zA-Z]{3})")


def extract_iata(pop_code: str | None) -> str | None:
    """Return the 3-letter IATA prefix of a PoP code (uppercased)."""
    if not pop_code:
        return None
    m = _IATA_RE.match(pop_code.strip())
    if not m:
        return None
    return m.group(1).upper()


def resolve_pop_geo(pop_code: str | None) -> dict[str, Any] | None:
    """Resolve a PoP code (e.g. ``gru17``) to ``{iata, city, country, lat, lng}``.

    Returns ``None`` when the IATA prefix is unknown so callers can decide
    how to render the "PoP desconhecido" case.
    """
    iata = extract_iata(pop_code)
    if not iata:
        return None
    entry = IATA_AIRPORTS.get(iata)
    if not entry:
        return None
    city, country, lat, lng = entry
    return {
        "iata": iata,
        "city": city,
        "country": country,
        "lat": lat,
        "lng": lng,
    }
