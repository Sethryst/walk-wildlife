# MSJ Automation & Region Engine Branch

## Mission

This branch introduces automation into MSJ.

The goal is NOT to redesign or replace the existing application.

The goal is to build a new automation layer that allows MSJ to create, install, and manage intelligent offline regions while preserving the current application architecture.

Everything developed here should integrate into the existing project as an additive subsystem.

---

## What is a Region?

A region is a geographic area of any size that can be extracted from OpenStreetMap and packaged as offline data.

Regions can be:
- **Small:** A single town (Vienna, VA)
- **Medium:** A city (Norfolk, VA)
- **Large:** A metropolitan area (Hampton Roads: Norfolk, Virginia Beach, Newport News, etc.)
- **Very Large:** A county or state (future, if performance allows)

All regions follow the same pipeline regardless of size. The only difference is the geographic boundary in the configuration file.

---

## Important Constraints

* Do NOT refactor unrelated code.
* Do NOT redesign existing application logic.
* Do NOT remove or replace current map functionality.
* Do NOT change existing user workflows unless necessary for integration.
* Build new capabilities that plug into the existing MSJ application.

Assume the existing application is the source of truth.

---

## User Experience

MSJ remains an online mapping application.

Users should continue browsing the world normally.

Offline capability is optional.

Example experience:

1. User browses normally (online, using OSM tiles).
2. User selects a region (town, city, metro area, etc.).
3. User chooses "Make Available Offline."
4. MSJ checks whether an offline package already exists.
5. If one exists, install it.
6. If one does not exist, build it (desktop implementation first, backend later).
7. Future visits automatically use the local package.
8. User can switch between online and offline mode seamlessly.

The user should never know what PMTiles, PBF files, Osmium, or Planetiler are.

---

## High-Level Architecture

The automation layer should be composed of independent engines with clear responsibilities.

### 1. Region Builder

**Purpose:**

Create offline map packages from OpenStreetMap data.

**Input:**

* Region configuration (name, geographic boundary)
* Region name (e.g., "norfolk", "hampton_roads", "vienna")

**Responsibilities:**

* Resolve region configuration
* Obtain extraction boundary (from config)
* Extract OSM data using Osmium
* Generate PMTiles using Planetiler
* Validate generated package
* Store completed region in local storage

**Output:**

```
<region>.pmtiles
```

**Storage Provider Pattern:**

The Region Builder should accept a `storageProvider` parameter to support both desktop and future backend:

```javascript
class RegionBuilder {
  constructor(storageProvider) {
    this.storage = storageProvider; // Local filesystem or cloud storage
  }
  
  async build(regionConfig) {
    // ... build logic
    await this.storage.save(`${regionConfig.name}.pmtiles`, tileData);
  }
}
```

---

### 2. POI Builder

**Purpose:**

Create normalized MSJ POI datasets from multiple sources.

**Input:**

* Existing JSON datasets (water-features.json, coffee-shops.json, etc.)
* Open Data exports (CSV, GeoJSON)
* OSM-derived POIs (optional, from extraction boundary)
* Region configuration

**Responsibilities:**

* Normalize schemas to universal POI format
* Merge datasets from multiple sources
* Remove duplicates (by coordinates within 50m, name similarity)
* Standardize attributes (address, phone, hours, etc.)
* Validate required fields
* Produce a clean, consolidated POI dataset

**Output:**

```
<region>-poi.json
```

**Example Workflow:**

```
Input:
  - norfolk/water-features.json (89 POIs)
  - norfolk/coffee-shops.json (47 POIs)
  - norfolk/parks.json (120 POIs)

Process:
  1. Load all datasets
  2. Normalize each to universal schema
  3. Merge into single array
  4. Deduplicate (remove POIs at same lat/lng with similar names)
  5. Validate all required fields
  6. Output consolidated dataset

Output:
  - norfolk-poi.json (240 unique POIs, all normalized)
```

---

### 3. Taxonomy Engine

**Purpose:**

Transform normalized POIs into an MSJ-specific understanding of a region.

**Input:**

* Normalized POI dataset (<region>-poi.json)
* Universal category taxonomy
* Region-specific configuration (featured buckets, overrides)

**Responsibilities:**

* Scan normalized POIs and count occurrences per category
* Generate "universal buckets" (coffee, history, art, water, recreation, etc.)
* Include only buckets with at least one POI
* Identify region-specific "featured buckets" from config
* Detect outliers and unusual distributions
* Refine category assignments if needed
* Support walking-focused discovery (prioritize walkable POIs)

**Output:**

```
<region>-buckets.json
```

**This layer represents MSJ's product intelligence.** It should remain independent from map generation.

**Example Output:**

```json
{
  "city": "Norfolk",
  "universalBuckets": [
    {
      "name": "coffee",
      "displayName": "Coffee",
      "count": 47,
      "enabled": true,
      "icon": "☕"
    },
    {
      "name": "water",
      "displayName": "Water Access",
      "count": 89,
      "enabled": true,
      "icon": "💧"
    },
    {
      "name": "park",
      "displayName": "Parks",
      "count": 120,
      "enabled": true,
      "icon": "🌳"
    },
    {
      "name": "art",
      "displayName": "Art & Culture",
      "count": 0,
      "enabled": false,
      "icon": "🎨"
    }
  ],
  "featuredBuckets": [
    {
      "name": "elizabeth_river_trail",
      "displayName": "Elizabeth River Trail",
      "count": 15,
      "enabled": true,
      "icon": "🚶",
      "description": "Curated segments of the Elizabeth River Trail"
    }
  ]
}
```

---

### 4. Region Manager

**Purpose:**

The single point of contact between the application and the automation layer.

**Responsibility:**

The application communicates ONLY with the Region Manager. The Region Manager decides how to fulfill requests.

**API:**

```javascript
const region = await regionManager.getRegion("norfolk");
// Returns:
// {
//   name: "norfolk",
//   mapSource: { type: "local" | "remote", path: "..." },
//   pois: [...],
//   buckets: {...},
//   ready: boolean,
//   progress: "Building..." | "Ready"
// }
```

**Region Manager Decision Tree:**

```
requestRegion("norfolk")
  ↓
Step 1: Check local storage
  - Does data/regions/norfolk/norfolk.pmtiles exist?
  - Does data/regions/norfolk/norfolk-poi.json exist?
  - Does data/regions/norfolk/norfolk-buckets.json exist?
  
  If ALL exist → Return region object (ready: true)
  ↓
Step 2: Check if partial/missing
  If ANY missing → Proceed to Step 3
  ↓
Step 3: Trigger RegionBuilder
  - Load norfolk/config.json
  - Check if build is in progress (avoid duplicate builds)
  - Trigger builders in sequence:
    1. RegionBuilder (creates .pmtiles)
    2. POIBuilder (creates -poi.json)
    3. TaxonomyEngine (creates -buckets.json)
  ↓
Step 4: Monitor build progress
  - Report progress to application
  - Handle errors gracefully
  - Retry on failure (with limits)
  ↓
Step 5: Store artifacts
  - Move completed files to data/regions/norfolk/
  - Validate all files present and valid
  ↓
Step 6: Return complete region object
  - Application receives (ready: true, mapSource, pois, buckets)
```

**The application should never directly invoke build logic.** All build orchestration happens in Region Manager.

---

## Configuration-Driven Design

Each region is represented by a configuration file.

### Configuration File Structure

**Location:**

```
data/regions/
  norfolk/
    config.json
  hampton_roads/
    config.json
  vienna/
    config.json
```

### Configuration Schema

```json
{
  "name": "Norfolk",
  "regionKey": "norfolk",
  "description": "City of Norfolk, Virginia",
  "type": "city",
  "boundary": {
    "north": 36.95,
    "south": 36.75,
    "east": -76.2,
    "west": -76.35
  },
  "osmExtraction": {
    "tool": "osmium",
    "pbfSource": "planet",
    "extraTags": ["name", "amenity", "tourism", "historic", "sport"]
  },
  "poiSources": [
    {
      "id": "water_features",
      "type": "geojson",
      "path": "data/regions/norfolk/raw/water-features.json",
      "category": "water",
      "required": false
    },
    {
      "id": "coffee_shops",
      "type": "geojson",
      "path": "data/regions/norfolk/raw/coffee-shops.json",
      "category": "coffee",
      "required": false
    },
    {
      "id": "parks",
      "type": "geojson",
      "path": "data/regions/norfolk/raw/parks.json",
      "category": "park",
      "required": false
    }
  ],
  "attribution": "Norfolk Open Data + OpenStreetMap Contributors",
  "featuredBuckets": [
    {
      "id": "elizabeth_river_trail",
      "name": "Elizabeth River Trail",
      "description": "Key segments of the Elizabeth River Trail",
      "poiIds": ["poi_ert_segment_1", "poi_ert_segment_2"]
    }
  ],
  "categoryOverrides": {
    "historic": "history",
    "amenity:cafe": "coffee"
  },
  "exclude": {
    "categories": ["parking", "bench"],
    "tags": ["temporary=yes"]
  }
}
```

### Multi-City Region Example (Hampton Roads)

```json
{
  "name": "Hampton Roads",
  "regionKey": "hampton_roads",
  "description": "Metropolitan area: Norfolk, Virginia Beach, Newport News, Hampton, Chesapeake",
  "type": "metro",
  "boundary": {
    "north": 37.2,
    "south": 36.6,
    "east": -76.0,
    "west": -76.8
  },
  "osmExtraction": {
    "tool": "osmium",
    "pbfSource": "planet",
    "extraTags": ["name", "amenity", "tourism", "historic"]
  },
  "poiSources": [
    {
      "id": "hampton_roads_all",
      "type": "geojson",
      "path": "data/regions/hampton_roads/raw/all-poi.json",
      "category": "mixed",
      "required": true
    }
  ],
  "attribution": "Hampton Roads Regional Open Data + OSM Contributors",
  "featuredBuckets": [
    {
      "id": "waterfront_trail",
      "name": "Waterfront Trail",
      "description": "Connected waterfront attractions across Hampton Roads"
    },
    {
      "id": "historic_sites",
      "name": "Historic Colonial Sites",
      "description": "Colonial America historic locations"
    }
  ]
}
```

**The long-term goal:** Onboarding a new city requires mostly configuration rather than new code.

---

## Desktop First

The first implementation runs entirely on the developer's machine.

**Desktop Architecture:**

```
Developer runs: npm run build:region norfolk

Process:
  1. RegionManager loads data/regions/norfolk/config.json
  2. RegionBuilder extracts OSM data → generates PMTiles
  3. POIBuilder consolidates JSON files → normalizes data
  4. TaxonomyEngine analyzes POIs → generates buckets
  5. All artifacts saved to data/regions/norfolk/

Output:
  - norfolk.pmtiles (map tiles)
  - norfolk-poi.json (consolidated POI data)
  - norfolk-buckets.json (category taxonomy)
```

**Later, the same architecture should be portable to a backend service.**

Backend version:
```
POST /api/regions/build
  Input: { regionKey: "norfolk" }
  Process: Same engines, same config, same outputs
  Output: Artifacts stored in cloud storage
  Application downloads on demand
```

**No engine should assume where it runs.** Both desktop and backend use:
- Same configuration files
- Same build logic
- Same output format
- Same Region Manager interface

---

## Application Responsibilities

The application should:

* Call `regionManager.getRegion(cityName)` when user requests offline access
* Wait for the region object (async)
* Load map tiles from `region.mapSource` (could be local or remote)
* Load POIs from `region.pois`
* Load buckets from `region.buckets`
* Display build progress if region is being created
* Handle offline/online switching gracefully

The application should NOT:

* Check file existence
* Trigger builds directly
* Manage storage or artifact locations
* Know about Osmium, PMTiles, Planetiler, or build tools
* Cache or serve artifacts
* Make assumptions about where data comes from
* Hardcode region paths or configurations

---

## Design Philosophy

MSJ is not attempting to replace OpenStreetMap.

MSJ creates an intelligent layer on top of geographic data.

The map provides location. The POI pipeline provides normalized information. The taxonomy engine provides meaning. The user's journals, memories, visits, and social interactions provide personal context.

Together they create an intelligent regional experience.

---

## Success Criteria

A single command such as:

```bash
npm run build:region norfolk
npm run build:region hampton_roads
npm run build:region vienna
```

should produce:

```
data/regions/norfolk/
  norfolk.pmtiles
  norfolk-poi.json
  norfolk-buckets.json

data/regions/hampton_roads/
  hampton_roads.pmtiles
  hampton_roads-poi.json
  hampton_roads-buckets.json

data/regions/vienna/
  vienna.pmtiles
  vienna-poi.json
  vienna-buckets.json
```

The application should then be able to:

1. Discover these regions automatically
2. Install and use those artifacts without knowing how they were created
3. Switch between regions seamlessly
4. Use offline tiles for any installed region
5. Fall back to online OSM tiles if region is not installed

---

## Coding Expectations

Favor:

* Modular architecture (each engine is independent)
* Configuration-driven behavior (regions defined by config, not code)
* Extensibility (easy to add new POI sources, new categories)
* Maintainability (clear separation of responsibilities)
* Reusable components (storage provider, configuration loader, etc.)
* Clear error handling (builds fail gracefully with informative messages)
* Progress reporting (user knows what's happening during builds)

Avoid:

* Hardcoded regions
* Tightly coupled systems
* Duplicate logic across builders
* Unnecessary refactoring of existing app code
* Changes that break existing functionality
* Assumptions about deployment environment (desktop vs. backend)

---

## Example Workflow

### Step 1: User Requests Offline Vienna

```javascript
// Application
const region = await regionManager.getRegion("vienna");
```

### Step 2: Region Manager Checks

```javascript
// Region Manager
// Check: Does data/regions/vienna/ exist with all artifacts?
// Result: No

// Trigger build
await regionBuilder.build(viennaConfig);
await poiBuilder.build(viennaConfig);
await taxonomyEngine.build(viennaConfig);
```

### Step 3: Builders Execute (Desktop)

```
RegionBuilder:
  - Load vienna/config.json
  - Extract OSM data for boundary
  - Generate PMTiles
  - Save: data/regions/vienna/vienna.pmtiles

POIBuilder:
  - Load vienna/config.json
  - Load all POI sources from config
  - Normalize + deduplicate
  - Save: data/regions/vienna/vienna-poi.json

TaxonomyEngine:
  - Load vienna-poi.json
  - Count categories
  - Generate bucket manifest
  - Save: data/regions/vienna/vienna-buckets.json
```

### Step 4: Region Manager Returns

```javascript
// Region Manager
return {
  name: "vienna",
  mapSource: {
    type: "local",
    path: "data/regions/vienna/vienna.pmtiles"
  },
  pois: [...],
  buckets: {...},
  ready: true
};
```

### Step 5: Application Uses Region

```javascript
// Application
renderMap(region.mapSource);        // Uses local PMTiles
renderPOIs(region.pois);            // Uses consolidated data
renderBuckets(region.buckets);      // Uses generated taxonomy
```

### Step 6: Future Visits

```javascript
// User opens Vienna again
const region = await regionManager.getRegion("vienna");
// Region Manager checks: artifacts exist?
// Yes → Return immediately (no rebuild)
```

---

## This Branch Builds

The automation infrastructure that will eventually allow MSJ to onboard any supported region with minimal manual effort while preserving the existing application experience.

Start with the Region Manager and RegionBuilder. Everything else plugs in.

When in doubt, refer back to the constraints: Do not refactor unrelated code. Add capability, don't replace logic.