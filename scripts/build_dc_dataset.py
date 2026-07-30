import json
import os

INPUT_DIR = "data/dc-raw"
OUTPUT_FILE = "data/dc-poi.json"

def process_geojson(filename, tags, name_field='NAME', desc_fields=None, filter_func=None):
    filepath = os.path.join(INPUT_DIR, filename)
    if not os.path.exists(filepath):
         print(f"Skipping {filename}: File not found")
         return []
         
    with open(filepath, 'r', encoding='utf-8') as f:
         data = json.load(f)
         
    pois = []
    features = data.get('features', [])
    for feat in features:
        props = feat.get('properties', {})
        geom = feat.get('geometry')
        
        # We need a point geometry
        if not geom:
             continue
             
        lon, lat = None, None
        if geom.get('type') == 'Point':
             lon, lat = geom['coordinates']
        elif geom.get('type') in ['Polygon', 'MultiPolygon', 'LineString']:
             # Simple centroid approximation for polygons/lines
             if geom.get('type') == 'Polygon':
                 coords = geom['coordinates'][0]
             elif geom.get('type') == 'MultiPolygon':
                 coords = geom['coordinates'][0][0]
             elif geom.get('type') == 'LineString':
                 coords = geom['coordinates']
             else:
                 continue
                 
             if not coords:
                 continue
                 
             lon = sum(c[0] for c in coords) / len(coords)
             lat = sum(c[1] for c in coords) / len(coords)
             
        if lon is None or lat is None:
             continue
             
        # Allow custom filtering
        if filter_func and not filter_func(props):
             continue
             
        name = props.get(name_field) or props.get('NAME') or 'Unknown Site'
        
        desc_parts = []
        if desc_fields:
            for df in desc_fields:
                if props.get(df):
                    desc_parts.append(str(props[df]).strip())
        description = " - ".join(desc_parts) if desc_parts else "Washington, DC"
        
        tag_list = list(tags) if isinstance(tags, (list, tuple)) else [tags]
        primary_tag = tag_list[0]
        object_id = props.get('OBJECTID') or props.get('id') or name.replace(' ', '-').lower()
        poi_id = f"dc-{primary_tag}-{object_id}"

        pois.append({
            "id": poi_id,
            "name": name,
            "lat": lat,
            "lng": lon,
            "tags": tag_list,
            "radius": 50,
            "description": description,
            "source": f"Open Data DC ({filename})",
            "link": "",
            "unverified": False
        })
        
    return pois

def main():
    all_pois = []
    
    all_pois.extend(process_geojson('parks.geojson', ['park'], name_field='NAME', desc_fields=['WEB_URL', 'ADDRESS']))
    all_pois.extend(process_geojson('trails.geojson', ['trail'], name_field='SIGN_NAME', desc_fields=['NEIGHBORHOOD']))
    all_pois.extend(process_geojson('museums.geojson', ['history'], name_field='NAME', desc_fields=['ADDRESS', 'WEB_URL']))
    all_pois.extend(process_geojson('public_art.geojson', ['public_art'], name_field='NAME', desc_fields=['ARTIST', 'YEAR_INSTALLED', 'ADDRESS']))
    all_pois.extend(process_geojson('boundary_stones.geojson', ['history'], name_field='NAME', desc_fields=['CONDITION']))
    all_pois.extend(process_geojson('wifi.geojson', ['wifi'], name_field='NAME', desc_fields=['ADDRESS']))

    # Basic deduplication by ID just in case
    unique_pois = []
    seen = set()
    for p in all_pois:
        if p['id'] not in seen:
            seen.add(p['id'])
            unique_pois.append(p)

    metadata = {
        "version": "2026-07-30",
        "attribution": "Open Data DC",
        "count": len(unique_pois),
        "sourceUrl": "https://opendata.dc.gov/"
    }

    output_data = {
        "metadata": metadata,
        "trailSegments": [],
        "pointsOfInterest": unique_pois
    }

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
        
    print(f"Successfully generated {OUTPUT_FILE} with {len(unique_pois)} POIs.")
    
    counts = {}
    for poi in unique_pois:
        for tag in poi['tags']:
            counts[tag] = counts.get(tag, 0) + 1
    for tag, count in sorted(counts.items()):
        print(f"  {tag}: {count}")

if __name__ == "__main__":
    main()
