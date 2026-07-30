"""
Categorize the NYC Parks historical signs dataset into meaningful POI categories
matching the app's existing POI filter system:
  - history          (historical sites, memorials, monuments, plaques)
  - park             (parks, playgrounds, green spaces, gardens, squares, beaches)
  - public_art       (sculptures, murals, artworks, monuments dedicated to people/events)
  - recreation_center (recreation centers, sports facilities, pools, courts, rinks, golf)
  - water_access     (beaches, pools, piers, waterfronts, bays, rivers, harbors)
  - community_garden (community gardens)
"""

import json
import re

INPUT = "./data/newyork-poi.json"
OUTPUT = "./data/newyork-poi.json"

# --- Category keyword rules (checked in priority order) ---
# Each rule is (category, [keywords_in_name], [keywords_in_description])
# Name keywords take higher priority than description keywords.

CATEGORY_RULES = [
    # Water Access - check first (very distinctive)
    ("water_access", [
        "beach", "pier", "harbor", "marina", "boat", "bay", "waterfront",
        "esplanade", "sound", "cove", "inlet", "wharf", "riverwalk",
        "riverside", "reservoir", "pond", "lake", "creek", "shore"
    ], [
        "beach", "waterfront", "pier", "harbor", "marina", "esplanade",
        "lakeside", "riverside", "shoreline"
    ]),

    # Recreation Centers / Sports Facilities
    ("recreation_center", [
        "recreation center", "rec center", "pool", "swimming", "rink",
        "golf course", "golf", "tennis", "courts", "arena", "stadium",
        "sports", "athletic", "gym", "track", "field house", "fieldhouse",
        "skating", "skate"
    ], [
        "recreation center", "swimming pool", "ice rink", "golf course",
        "basketball court", "tennis court", "athletic field", "sports complex"
    ]),

    # Public Art / Monuments / Sculptures
    ("public_art", [
        "memorial", "monument", "statue", "sculpture", "arch", "fountain",
        "plaza", "doughboy", "flagpole", "mural", "artwork",
        "dedicated to", "tribute", "honor", "soldier", "sailor", "veteran",
        "infantry", "regiment"
    ], [
        "sculpture", "statue", "monument", "memorial", "bronze", "artwork",
        "dedicated to", "erected in honor", "carved relief", "mosaic"
    ]),

    # Community Gardens
    ("community_garden", [
        "community garden", "garden", "botanical", "arboretum", "greenhouse"
    ], [
        "community garden", "planted", "garden established"
    ]),

    # Parks / Green Spaces / Playgrounds / Beaches
    ("park", [
        "playground", "park", "square", "triangle", "green", "greenway",
        "commons", "meadow", "field", "woods", "forest", "nature",
        "wildlife sanctuary", "preserve", "conservation", "trail", "path",
        "promenade", "boardwalk", "terrace", "hillside", "cliff", "gorge",
        "cemetery", "burial ground"
    ], [
        "playground", "park", "green space", "meadow", "wooded area", "open space"
    ]),

    # History / Named sites (catch-all)
    ("history", [], []),
]


def classify(name: str, description: str) -> str:
    name_lower = name.lower()
    desc_lower = description.lower()

    for category, name_keywords, desc_keywords in CATEGORY_RULES:
        if any(kw in name_lower for kw in name_keywords):
            return category
        if any(kw in desc_lower for kw in desc_keywords):
            return category

    return "history"


def main():
    with open(INPUT, "r", encoding="utf-8") as f:
        data = json.load(f)

    pois = data["pointsOfInterest"]
    counts = {}

    for poi in pois:
        name = poi.get("name", "")
        desc = poi.get("description", "")
        category = classify(name, desc)
        poi["category"] = category
        counts[category] = counts.get(category, 0) + 1

    data["metadata"]["categoryCounts"] = counts
    data["metadata"]["version"] = "2026-07-29-v3"

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"Done! Categorized {len(pois)} NYC Parks historical signs:")
    for cat, count in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {cat:20s}: {count:>5}")


if __name__ == "__main__":
    main()
