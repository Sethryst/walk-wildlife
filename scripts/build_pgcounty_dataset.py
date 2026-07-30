import json
import os
from pyproj import Transformer

# Initialize coordinate transformer from Maryland State Plane (EPSG:2248) to WGS84 (EPSG:4326)
transformer = Transformer.from_crs('EPSG:2248', 'EPSG:4326', always_xy=True)

INPUT_DIR = "data/pgcountry-raw"
OUTPUT_FILE = "data/pgcounty-poi.json"

def get_wgs84(feature):
    geom = feature.get('geometry')
    if geom and 'x' in geom and 'y' in geom:
        x, y = geom['x'], geom['y']
        # If coordinates are already roughly in lat/lon range, use them
        if -80 <= x <= -70 and 35 <= y <= 45:
            return x, y
        # Otherwise reproject
        lon, lat = transformer.transform(x, y)
        return lon, lat
    
    # Fallback to checking attributes
    attrs = feature.get('attributes', {})
    
    # Playgrounds use X, Y directly
    if 'X' in attrs and 'Y' in attrs:
         x, y = attrs['X'], attrs['Y']
         if -80 <= x <= -70 and 35 <= y <= 45:
             return x, y
             
    # Attractions use POINT_X, POINT_Y
    if 'POINT_X' in attrs and 'POINT_Y' in attrs:
        return attrs['POINT_X'], attrs['POINT_Y']
        
    return None, None

def process_file(filename, tags, name_field='NAME', desc_field=None):
    filepath = os.path.join(INPUT_DIR, filename)
    if not os.path.exists(filepath):
        print(f"Skipping {filename}: Not found")
        return []
        
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    if not isinstance(data, list):
        print(f"Skipping {filename}: Not a list")
        return []

    pois = []
    for feat in data:
        attrs = feat.get('attributes', {})
        lon, lat = get_wgs84(feat)
        
        if lon is None or lat is None:
            continue
            
        name = attrs.get(name_field) or attrs.get('PARKNAME') or 'Unknown'
        
        # Build description
        desc_parts = []
        if desc_field and attrs.get(desc_field):
            desc_parts.append(str(attrs[desc_field]))
        
        address = attrs.get('ADDRESS') or f"{attrs.get('ADDRESS_NUMBER', '')} {attrs.get('STREET_NAME', '')}".strip()
        if address:
            desc_parts.append(address)
            
        city = attrs.get('CITY')
        if city:
            desc_parts.append(f"{city}, MD")
            
        description = " - ".join(desc_parts)

        tag_list = list(tags) if isinstance(tags, (list, tuple)) else [tags]

        # Basic ID generation
        primary_tag = tag_list[0]
        poi_id = f"pg-{primary_tag}-{attrs.get('OBJECTID', name.replace(' ', '-').lower())}"

        poi = {
            "id": poi_id,
            "name": name,
            "lat": lat,
            "lng": lon,
            "tags": tag_list,
            "radius": 50,
            "description": description,
            "source": f"PG County Open Data ({filename})",
            "link": "",
            "unverified": False
        }

        if filename == 'Playgrounds.json' and 'playground' not in poi['tags']:
            poi['tags'].append('playground')
            
        pois.append(poi)
        
    return pois

def main():
    all_pois = []
    
    all_pois.extend(process_file("Libraries.json", ["library"]))
    all_pois.extend(process_file("Community Centers.json", ["recreation_center"], name_field="PARKNAME"))
    all_pois.extend(process_file("Picnic Areas.json", ["park"], desc_field="CATEGORY"))
    all_pois.extend(process_file("Playgrounds.json", ["park", "playground"], name_field="PARKNAME"))
    all_pois.extend(process_file("Attractions.json", ["history"], desc_field="TYPE"))

    metadata = {
        "version": "2026-07-30",
        "attribution": "Prince George's County Open Data",
        "count": len(all_pois),
        "sourceUrl": "https://data.princegeorgescountymd.gov"
    }

    output_data = {
        "metadata": metadata,
        "trailSegments": [],
        "pointsOfInterest": all_pois
    }

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
        
    print(f"Successfully generated {OUTPUT_FILE} with {len(all_pois)} POIs.")
    
    counts = {}
    for poi in all_pois:
        for tag in poi['tags']:
            counts[tag] = counts.get(tag, 0) + 1
    for tag, count in sorted(counts.items()):
        print(f"  {tag}: {count}")

if __name__ == "__main__":
    main()
