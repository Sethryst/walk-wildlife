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
        "beach ", "pier", "harbor", "marina", "boat", "bay", "waterfront",
        "esplanade", "cove", "inlet", "wharf", "riverwalk", "reservoir"
    ], [
        "waterfront", "pier", "harbor", "marina", "esplanade", "shoreline"
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


def classify(name: str, description: str) -> list[str]:
    name_lower = name.lower()
    desc_lower = description.lower()

    tags = set()
    
    # Water access exclusions
    is_false_water = False
    for false_term in ["coney island", "staten island", "roosevelt island", "city island", "randall's island", "riverside drive", "shore road", "beach channel drive", "water street"]:
        if false_term in name_lower:
            is_false_water = True

    for category, name_keywords, desc_keywords in CATEGORY_RULES:
        if category == 'water_access' and is_false_water:
             if not any(kw in name_lower for kw in ["pier ", "marina", "beach "]):
                 continue
                 
        if any(kw in name_lower for kw in name_keywords):
            tags.add(category)
        elif any(kw in desc_lower for kw in desc_keywords):
            tags.add(category)

    if not tags:
        tags.add("history")

    return list(tags)


def main():
    with open(INPUT, "r", encoding="utf-8") as f:
        data = json.load(f)

    pois = data["pointsOfInterest"]
    counts = {}

    for poi in pois:
        name = poi.get("name", "")
        desc = poi.get("description", "")
        
        # We classify into multiple tags now
        tags = classify(name, desc)
        
        # Migrate old 'category' field to 'tags'
        if 'category' in poi:
             del poi['category']
             
        # Map amenities to tags as well
        if 'amenities' in poi:
             for amenity in poi['amenities']:
                  if amenity not in tags:
                       tags.append(amenity)
             del poi['amenities']
             
        poi["tags"] = tags
        
        for t in tags:
            counts[t] = counts.get(t, 0) + 1

    data["metadata"]["categoryCounts"] = counts
    data["metadata"]["version"] = "2026-07-30-v4"

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"Done! Categorized {len(pois)} NYC Parks historical signs with tags:")
    for cat, count in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {cat:20s}: {count:>5}")


if __name__ == "__main__":
    main()
