"""Build the reviewed Norfolk POI seed from the City's raw open-data exports.

The output is intentionally local and deterministic: `data/norfolk-poi.json` is
what the app seeds into IndexedDB. Tree planting and light rail are deliberately
excluded. The script supports an Elizabeth River Trail GeoJSON when one is added
to the raw folder; the current supplied export set does not contain that file.
"""

from __future__ import annotations

import csv
import json
import math
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
RAW = next((path for path in (ROOT / "data" / "norfolk-raw", ROOT / "data" / "nofolk-raw") if path.exists()), None)
OUTPUT = ROOT / "data" / "norfolk-poi.json"
VERSION = "2026-07-27-v1"


def load_geojson(filename: str) -> list[dict[str, Any]]:
    if RAW is None:
        raise FileNotFoundError("Expected data/norfolk-raw (or the supplied data/nofolk-raw) folder.")
    return json.loads((RAW / filename).read_text(encoding="utf-8-sig"))["features"]


def clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"none", "null", "n/a", "na", "no", "0", "false", "nan", " "}:
        return None
    return text


def truthy(value: Any) -> bool:
    if isinstance(value, (int, float)):
        return value > 0
    return clean(value) is not None and str(value).strip().lower() not in {"no", "n", "false", "0"}


def normalized(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def description(*parts: Any) -> str | None:
    values = []
    for part in parts:
        text = clean(part)
        if text and text not in values:
            values.append(text)
    return " · ".join(values) or None


def ring_centroid(ring: list[list[float]]) -> tuple[float, float, float]:
    """Return longitude, latitude, signed area using the ring's shoelace centroid."""
    if len(ring) < 3:
        lng = sum(point[0] for point in ring) / len(ring)
        lat = sum(point[1] for point in ring) / len(ring)
        return lng, lat, 0
    twice_area = cx = cy = 0.0
    for first, second in zip(ring, ring[1:] + ring[:1]):
        cross = first[0] * second[1] - second[0] * first[1]
        twice_area += cross
        cx += (first[0] + second[0]) * cross
        cy += (first[1] + second[1]) * cross
    if abs(twice_area) < 1e-12:
        lng = sum(point[0] for point in ring) / len(ring)
        lat = sum(point[1] for point in ring) / len(ring)
        return lng, lat, 0
    return cx / (3 * twice_area), cy / (3 * twice_area), twice_area / 2


def geometry_center(geometry: dict[str, Any]) -> tuple[float, float]:
    kind = geometry["type"]
    coordinates = geometry["coordinates"]
    if kind == "Point":
        return float(coordinates[1]), float(coordinates[0])
    if kind == "Polygon":
        lng, lat, _ = ring_centroid(coordinates[0])
        return lat, lng
    if kind == "MultiPolygon":
        candidates = [ring_centroid(polygon[0]) for polygon in coordinates if polygon and polygon[0]]
        total = sum(abs(area) for _, _, area in candidates)
        if total:
            return sum(lat * abs(area) for _, lat, area in candidates) / total, sum(lng * abs(area) for lng, _, area in candidates) / total
        return geometry_center({"type": "Polygon", "coordinates": coordinates[0]})
    flat = [point for line in coordinates for point in (line if kind == "MultiLineString" else [line])]
    return sum(point[1] for point in flat) / len(flat), sum(point[0] for point in flat) / len(flat)


def feature_id(prefix: str, properties: dict[str, Any], fallback: int) -> str:
    value = properties.get("OBJECTID") or properties.get("OBJECTID_1") or properties.get(":id") or properties.get("ID") or fallback
    return f"norfolk-{prefix}-{value}"


def poi(*, identifier: str, name: str, lat: float, lng: float, category: str, subcategory: str | None, amenities: Iterable[str], description_text: str | None, address: str | None, source: str, geometry: str, link: str | None = None) -> dict[str, Any]:
    result = {
        "id": identifier,
        "name": name,
        "lat": round(lat, 7),
        "lng": round(lng, 7),
        "category": category,
        "subcategory": subcategory,
        "amenities": sorted(set(amenities)),
        "description": description_text,
        "address": address,
        "source": source,
        "geometry": geometry,
    }
    if link and link.startswith(("http://", "https://")):
        result["link"] = link
    return result


PARK_AMENITIES = {
    "outdoor_basketball_full_court": "basketball",
    "basketball_half_court_only": "basketball",
    "indoor_full_basket_ball_court": "basketball",
    "lighted_basketball_courts": "basketball",
    "tennis_courts_asphalt_concrete": "tennis",
    "tennis_courts_clay": "tennis",
    "lighted_tennis_courts": "tennis",
    "playground_areas": "playground",
    "ada_rubber_surface_playground": "playground",
    "fenced_dog_park": "dog_park",
    "splash_pad": "splash_pad",
    "disc_golf": "disc_golf",
    "skate_park": "skate_park",
    "restrooms": "restrooms",
}


def amenity_lookup() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    by_name: dict[str, set[str]] = defaultdict(set)
    by_address: dict[str, set[str]] = defaultdict(set)
    for feature in load_geojson("Parks_and_Recreation_Amenities_20260727.geojson"):
        props = feature.get("properties") or {}
        features = {amenity for field, amenity in PARK_AMENITIES.items() if truthy(props.get(field))}
        if not features:
            continue
        name = normalized(props.get("park_name"))
        address = normalized(props.get("address"))
        if name:
            by_name[name].update(features)
        if address:
            by_address[address].update(features)
    return by_name, by_address


def parks() -> list[dict[str, Any]]:
    by_name, by_address = amenity_lookup()
    records = []
    for index, feature in enumerate(load_geojson("Parks_-_City_of_Norfolk.geojson"), start=1):
        props = feature.get("properties") or {}
        geometry = feature.get("geometry")
        if not geometry:
            continue
        lat, lng = geometry_center(geometry)
        amenities = set()
        if truthy(props.get("BASKETBALL_COURTS")):
            amenities.add("basketball")
        if truthy(props.get("GYMS")) or truthy(props.get("GYM")):
            amenities.add("gym")
        if truthy(props.get("RESTROOMS")):
            amenities.add("restrooms")
        if truthy(props.get("BIKE_RACKS")):
            amenities.add("bike_racks")
        amenities.update(by_name.get(normalized(props.get("PARK_NAME")), set()))
        amenities.update(by_address.get(normalized(props.get("ADDRESS")), set()))
        records.append(poi(
            identifier=feature_id("park", props, index), name=clean(props.get("PARK_NAME")) or f"Norfolk Park {index}", lat=lat, lng=lng,
            category="park", subcategory=clean(props.get("PARK_TYPE")), amenities=amenities,
            description_text=description(props.get("DETAILS"), props.get("ADDITIONAL_INFO")), address=clean(props.get("ADDRESS")),
            source="Parks_-_City_of_Norfolk.geojson", geometry="polygon" if geometry["type"] in {"Polygon", "MultiPolygon"} else "point"
        ))
    return records


def public_art() -> list[dict[str, Any]]:
    records = []
    for index, feature in enumerate(load_geojson("Public_Art_20260727.geojson"), start=1):
        props, geometry = feature.get("properties") or {}, feature.get("geometry")
        if not geometry:
            continue
        lat, lng = geometry_center(geometry)
        web = props.get("weblink")
        link = web.get("url") if isinstance(web, dict) else clean(web)
        records.append(poi(
            identifier=feature_id("public-art", props, index), name=clean(props.get("artwork_name")) or f"Norfolk Public Art {index}", lat=lat, lng=lng,
            category="public_art", subcategory=clean(props.get("category")), amenities=[],
            description_text=description(props.get("artist"), props.get("media"), props.get("installation_date")),
            address=clean(props.get("street_address")) or clean(props.get("location")), source="Public_Art_20260727.geojson", geometry="point", link=link
        ))
    return records


def facilities(filename: str, prefix: str, category: str, subcategory: str | None = None) -> list[dict[str, Any]]:
    records = []
    for index, feature in enumerate(load_geojson(filename), start=1):
        props, geometry = feature.get("properties") or {}, feature.get("geometry")
        if not geometry:
            continue
        lat, lng = geometry_center(geometry)
        details = description(props.get("PHONE"), props.get("TYPE"), props.get("STATUS"), props.get("NOTES"), props.get("ENTRY"))
        amenities = []
        parking = clean(props.get("PARKING") or props.get("Parking"))
        if parking:
            amenities.append(f"parking_{normalized(parking)}")
        public_status = clean(props.get("PUBLIC_"))
        if public_status:
            amenities.append(f"access_{normalized(public_status)}")
        records.append(poi(
            identifier=feature_id(prefix, props, index), name=clean(props.get("LOCATION")) or f"Norfolk {category.replace('_', ' ').title()} {index}", lat=lat, lng=lng,
            category=category, subcategory=subcategory, amenities=amenities, description_text=details, address=clean(props.get("ADDRESS")), source=filename, geometry="point", link=clean(props.get("WEBSITE"))
        ))
    return records


def libraries() -> list[dict[str, Any]]:
    if RAW is None:
        raise FileNotFoundError("Norfolk raw folder is missing.")
    records = []
    with (RAW / "Libraries_latlng.csv").open(encoding="utf-8-sig", newline="") as handle:
        for index, row in enumerate(csv.DictReader(handle), start=1):
            # This supplied `*_latlng.csv` already has the EPSG:2284 conversion.
            # Refuse to use raw State Plane feet when those fields are absent.
            lat_text, lng_text = clean(row.get("latitude")), clean(row.get("longitude"))
            if not lat_text or not lng_text:
                raise ValueError("Libraries_latlng.csv is missing converted latitude/longitude. Convert EPSG:2284 to EPSG:4326 before import.")
            lat, lng = float(lat_text), float(lng_text)
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                raise ValueError(f"Invalid library coordinate for row {index}; do not use raw State Plane X/Y values.")
            records.append(poi(
                identifier=feature_id("library", row, index), name=clean(row.get("LOCATION")) or f"Norfolk Library {index}", lat=lat, lng=lng,
                category="library", subcategory=clean(row.get("TYPE")), amenities=["internet"] if clean(row.get("INTERNET_TYPE")) else [],
                description_text=description(row.get("PHONE"), row.get("WEBSITE")), address=clean(row.get("ADDRESS")), source="Libraries_latlng.csv", geometry="point", link=clean(row.get("WEBSITE"))
            ))
    return records


def line_coordinates(geometry: dict[str, Any]) -> list[list[list[float]]]:
    if geometry["type"] == "LineString":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiLineString":
        return geometry["coordinates"]
    return []


def trails() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    if RAW is None:
        return [], [], ["Raw data folder is missing."]
    files = sorted(RAW.glob("Elizabeth_River_Trail*.geojson"))
    if not files:
        return [], [], ["Elizabeth River Trail GeoJSON was not supplied; route layer not seeded."]
    route_pois, segments = [], []
    for file in files:
        for index, feature in enumerate(json.loads(file.read_text(encoding="utf-8-sig"))["features"], start=1):
            props, geometry = feature.get("properties") or {}, feature.get("geometry")
            if not geometry or geometry.get("type") not in {"LineString", "MultiLineString"}:
                continue
            status = clean(props.get("STATUS")) or "unknown"
            if status.lower() not in {"built", "complete", "completed", "existing"}:
                continue
            lat, lng = geometry_center(geometry)
            segment_id = feature_id("ert-segment", props, index)
            segments.append({"id": segment_id, "name": "Elizabeth River Trail", "coordinates": line_coordinates(geometry), "status": status, "phase": clean(props.get("PHASE")), "pathType": clean(props.get("PATHTYPE")), "source": file.name})
            route_pois.append(poi(
                identifier=segment_id, name="Elizabeth River Trail", lat=lat, lng=lng, category="trail", subcategory="elizabeth_river_trail", amenities=[],
                description_text=description(status, props.get("PHASE"), props.get("PATHTYPE")), address=None, source=file.name, geometry="line"
            ))
    return route_pois, segments, []


def main() -> None:
    records = parks() + public_art()
    records += facilities("Recreation_Centers_-_City_of_Norfolk.geojson", "recreation-center", "recreation_center")
    records += facilities("Boat_Ramps_-_City_of_Norfolk.geojson", "boat-ramp", "water_access", "boat_ramp")
    records += facilities("Beach_Access_-_City_of_Norfolk.geojson", "beach-access", "water_access", "beach_access")
    records += libraries()
    trail_pois, trail_segments, warnings = trails()
    records += trail_pois
    records.sort(key=lambda item: (item["category"], item["name"].lower(), item["id"]))
    output = {
        "metadata": {
            "version": VERSION,
            "generatedAt": date.today().isoformat(),
            "attribution": "City of Norfolk Open Data",
            "rawFolder": str(RAW.relative_to(ROOT)).replace("\\", "/") if RAW else None,
            "categoryCounts": dict(sorted(Counter(item["category"] for item in records).items())),
            "warnings": warnings,
            "excluded": ["Tree_Planting_Program_20260727.geojson (future canopy heatmap)", "Light Rail export (not imported by this build)"]
        },
        "pointsOfInterest": records,
        "trailSegments": trail_segments
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(records)} POIs to {OUTPUT.relative_to(ROOT)}")
    print("Category counts:", output["metadata"]["categoryCounts"])
    for warning in warnings:
        print("Warning:", warning)


if __name__ == "__main__":
    main()
