# Region import contract

This contract is build-time only. A producer such as Gremlin Lab can hand files to the region builder; it does not become a runtime dependency.

## Required POI import

`region.json` names a JSON file through `imports.poi`. The file must contain either the current app seed shape or the package shape:

```json
{ "pointsOfInterest": [{ "id": "stable-id", "name": "Name", "lat": 36.85, "lng": -76.29, "category": "park" }] }
```

```json
{ "pois": [{ "id": "stable-id", "name": "Name", "lat": 36.85, "lng": -76.29, "category": "park" }] }
```

The builder copies entries without altering their identifiers or fields and emits the runtime region shape `{ "pois": [...] }`. Producers should provide stable IDs, WGS84 decimal `lat`/`lng`, a human-readable name, and a category. Additional fields are preserved for future runtime use.

## Optional imports

- `imports.buckets`: JSON written directly as `<region>-buckets.json`.
- `imports.supplemental`: an array of relative file paths copied into the completed package and listed in the manifest.

Routes, events, AI-generated content, and Gremlin-specific exports belong in `supplemental` until a named, validated package stage is introduced. No producer code, credentials, scraper, or network dependency is included in this repository.
