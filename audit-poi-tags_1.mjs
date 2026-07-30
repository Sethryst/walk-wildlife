#!/usr/bin/env node
/**
 * audit-poi-tags.mjs
 *
 * Flags POI entries whose name/description hints at a category that isn't
 * reflected in their tags — the root cause of "parks showing up as history
 * sites." Run against a city's raw dataFile JSON before it ships.
 *
 * Usage:
 *   node audit-poi-tags.mjs ./data/norfolk-poi.json
 *   node audit-poi-tags.mjs ./data/*.json          (audit several at once)
 */
import { readFileSync } from 'node:fs';

// Keyword → tag it implies. Mirrors the app's POI_TAGS vocabulary.
const HINTS = [
  [/\bpark\b/i, 'park'],
  [/\bplayground\b/i, 'park'],
  [/\btrail(head)?\b/i, 'trail'],
  [/\blibrary\b/i, 'library'],
  [/\brec(reation)?\s*center\b/i, 'recreation_center'],
  [/\bcommunity\s*garden\b/i, 'community_garden'],
  [/\b(pier|boat\s*ramp|marina|beach|waterfront)\b/i, 'water_access'],
  [/\b(mural|sculpture|public\s*art)\b/i, 'public_art'],
  [/\b(museum|monument|memorial|historic|heritage|landmark|marker)\b/i, 'history'],
  [/\b(basketball)\b/i, 'basketball'],
  [/\b(tennis)\b/i, 'tennis'],
  [/\b(dog\s*park)\b/i, 'dog_park'],
  [/\b(splash\s*pad)\b/i, 'splash_pad'],
  [/\b(disc\s*golf)\b/i, 'disc_golf'],
  [/\b(skate\s*park)\b/i, 'skate_park']
];

function normalizeTags(poi) {
  const tags = new Set(poi.tags || []);
  if (poi.category) tags.add(poi.category);
  (poi.amenities || []).forEach((amenity) => tags.add(amenity));
  return tags;
}

function suggestSubtype(text) {
  if (/museum/i.test(text)) return 'museum';
  if (/monument/i.test(text)) return 'monument';
  if (/cemetery/i.test(text)) return 'cemetery';
  if (/librar|building|hall|house|church/i.test(text)) return 'landmark';
  return 'marker';
}

function auditFile(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const pois = raw.pointsOfInterest || [];
  const issues = [];

  pois.forEach((poi) => {
    const tags = normalizeTags(poi);
    const text = `${poi.name || ''} ${poi.description || ''} ${poi.subcategory || ''}`;
    const impliedTags = new Set(HINTS.filter(([re]) => re.test(text)).map(([, tag]) => tag));

    // Case 1: text implies a tag the record doesn't have.
    const missing = [...impliedTags].filter((tag) => !tags.has(tag));
    if (missing.length) {
      const note = missing.includes('history') ? `  (would land in subtype: ${suggestSubtype(text)})` : '';
      issues.push({ id: poi.id, name: poi.name, kind: 'missing-tag', have: [...tags], suggest: missing, note });
    }

    // Case 2: tagged 'history' but nothing in the text/other tags
    // supports it being a historic site specifically — likely a
    // park/rec facility that was bulk-tagged 'history' by mistake.
    if (tags.has('history') && !impliedTags.has('history') && impliedTags.size) {
      issues.push({ id: poi.id, name: poi.name, kind: 'suspect-history-tag', have: [...tags], suggest: [...impliedTags] });
    }

    // Case 3: no tags and no category at all.
    if (tags.size === 0) {
      issues.push({ id: poi.id, name: poi.name, kind: 'untagged', have: [], suggest: [] });
    }
  });

  console.log(`\n${path} — ${pois.length} POIs, ${issues.length} flagged`);
  issues.forEach((issue) => {
    console.log(`  [${issue.kind}] ${issue.id || '(no id)'} "${issue.name}" — has: [${issue.have.join(', ')}] suggest: [${issue.suggest.join(', ')}]${issue.note || ''}`);
  });
  return issues.length;
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node audit-poi-tags.mjs <path-to-city-poi.json> [...]');
  process.exit(1);
}
const total = files.reduce((sum, file) => sum + auditFile(file), 0);
console.log(`\nTotal flagged across ${files.length} file(s): ${total}`);
process.exit(total ? 1 : 0);
