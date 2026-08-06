#!/usr/bin/env node
/**
 * Developer-only offline region packager. Requires Docker; the two pinned
 * container images run osmium (PBF clipping) and tilemaker (valid PMTiles).
 * It never imports browser/runtime modules.
 */
import { createWriteStream } from 'node:fs';
import { access, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { resolveBoundary } from './boundary-resolver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const regionId = args.find((arg) => !arg.startsWith('-'));
const dryRun = args.includes('--dry-run');
if (!regionId) throw new Error('Usage: npm run build:region -- <region-id> [--dry-run]');

const configPath = path.join(root, 'regions', regionId, 'region.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (config.id !== regionId) throw new Error(`region.json id must equal folder name (${regionId}), not ${config.id}`);
if (!config.name || !config.boundary?.source || !config.osm?.pbfUrl || !config.imports?.poi) {
  throw new Error('region.json requires name, boundary.source, osm.pbfUrl, and imports.poi');
}

const cacheDir = path.join(root, '.cache', 'region-build', regionId);
const staging = path.join(root, '.tmp', `region-${regionId}-${Date.now()}`);
const output = path.join(root, 'regions', regionId);
const pbf = path.join(cacheDir, 'source.osm.pbf');
const clipped = path.join(staging, `${regionId}.osm.pbf`);
const pmtiles = path.join(staging, `${regionId}.pmtiles`);
const boundary = await resolveBoundary(config.boundary, { root, cacheDir });
const { west, south, east, north } = boundary.bbox;

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', shell: false });
    child.on('error', (error) => reject(error.code === 'ENOENT'
      ? new Error(`Required build dependency '${command}' was not found. Install and start Docker Desktop, then retry.`)
      : error));
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function download(url, file) {
  console.log(`Downloading OSM PBF: ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`PBF download failed: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html') || contentType.includes('application/json')) throw new Error(`PBF download returned ${contentType}, not an OSM PBF (${response.url})`);
  const temporary = `${file}.downloading`;
  await rm(temporary, { force: true });
  try {
    await pipeline(response.body, createWriteStream(temporary));
    if ((await stat(temporary)).size < 1024) throw new Error('PBF download is unexpectedly small');
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
async function pmtilesIsValid(file) {
  const handle = await readFile(file);
  return handle.length > 127 && handle.subarray(0, 7).toString('ascii') === 'PMTiles';
}
async function osmPbfIsPlausible(file) {
  const header = await readFile(file);
  // OSM PBF starts with a four-byte big-endian BlobHeader length. Valid headers
  // are small; an HTML error page starts with '<' and must never enter cache.
  return header.length >= 1024 && header[0] === 0 && header[1] === 0 && header[2] === 0;
}
async function validatePackage(directory, manifest) {
  for (const artifact of [manifest.artifacts.pmtiles, manifest.artifacts.poi, manifest.artifacts.buckets, ...manifest.artifacts.supplemental]) {
    if (!artifact || path.isAbsolute(artifact) || artifact.includes('..')) throw new Error(`Invalid manifest artifact path: ${artifact}`);
    await stat(path.join(directory, artifact));
  }
  if (!await pmtilesIsValid(path.join(directory, manifest.artifacts.pmtiles))) throw new Error('Package PMTiles header validation failed');
}
function dockerArgs(image, command) {
  // Docker receives a stable POSIX mount even when the host is Windows.
  return ['run', '--rm', '-v', `${root}:/workspace`, '-w', '/workspace', image, ...command];
}
function relative(file) { return path.relative(root, file).replaceAll('\\', '/'); }
function inputPath(file) { return path.isAbsolute(file) ? file : path.join(root, file); }
async function importedPois(imports) {
  const source = imports.buildTimePoiSource || imports.poi;
  const bytes = await readFile(inputPath(source));
  if (imports.producerManifest) {
    const producer = JSON.parse(await readFile(inputPath(imports.producerManifest), 'utf8'));
    const expected = producer.checksums?.['pois.json']?.replace(/^sha256:/, '');
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (!expected || expected !== actual) throw new Error(`Gremlin Lab producer manifest checksum does not match ${source}`);
  }
  const imported = JSON.parse(bytes);
  const pois = imported.pois || imported.pointsOfInterest;
  if (!Array.isArray(pois)) throw new Error(`POI import ${source} must contain a pois or pointsOfInterest array`);
  const supplementalPois = [];
  for (const supplement of imports.buildTimeSupplements || []) {
    const bundle = JSON.parse(await readFile(inputPath(supplement.path), 'utf8'));
    const category = supplement.filter?.category;
    const coffeeStops = (bundle.pois || []).filter((poi) => !category || poi.category === category);
    for (const poi of coffeeStops) {
      if (!poi?.id || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) continue;
      supplementalPois.push({
        id: poi.id,
        name: poi.name || 'Coffee stop',
        lat: poi.lat,
        lng: poi.lng,
        category: poi.category,
        tags: [poi.category],
        source: supplement.attribution || supplement.id,
        sourceType: 'build-time-supplement',
        walkRelevanceScore: Number(poi.walkRelevanceScore) || 0,
        walkRelevanceReasons: Array.isArray(poi.walkRelevanceReasons) ? poi.walkRelevanceReasons : [],
        historicalContext: poi.historicalContext || null,
        hours: poi.hours || null,
        outdoorSeating: poi.outdoorSeating || null,
        accessibility: poi.accessibility || null
      });
    }
  }
  const ids = new Set(pois.map((poi) => poi.id));
  return { pois: [...pois, ...supplementalPois.filter((poi) => !ids.has(poi.id))], source };
}

console.log(`Region build: ${regionId}${dryRun ? ' (dry run)' : ''}`);
console.log(`Boundary: ${west},${south},${east},${north}`);
console.log(`Boundary source: ${boundary.sourceDescription}`);
console.log(`POI import: ${config.imports.buildTimePoiSource || config.imports.poi}`);
if (dryRun) process.exit(0);

await run('docker', ['version', '--format', '{{.Server.Version}}']);
await mkdir(cacheDir, { recursive: true });
await mkdir(staging, { recursive: true });
try {
  if (await exists(pbf) && !await osmPbfIsPlausible(pbf)) await rm(pbf, { force: true });
  if (!await exists(pbf)) await download(config.osm.pbfUrl, pbf);
  const mountPbf = relative(pbf);
  const mountClipped = relative(clipped);
  const mountPolygon = relative(boundary.polygonFile);
  await run('docker', dockerArgs('krizleebear/docker-osmium-tool:v1.18.0', [
    'osmium', 'extract', '--polygon', `/workspace/${mountPolygon}`, '--set-bounds', '--overwrite',
    '-o', `/workspace/${mountClipped}`, `/workspace/${mountPbf}`
  ]));
  await run('docker', dockerArgs('ghcr.io/systemed/tilemaker:master', [
    '--input', `/workspace/${mountClipped}`, '--output', `/workspace/${relative(pmtiles)}`,
    '--bbox', `${west},${south},${east},${north}`,
    '--config', '/usr/src/app/config.json', '--process', '/usr/src/app/process.lua'
  ]));
  if (!await pmtilesIsValid(pmtiles)) throw new Error('tilemaker did not produce a valid PMTiles v3 archive');

  const { pois } = await importedPois(config.imports);
  await writeFile(path.join(staging, `${regionId}-poi.json`), JSON.stringify({ pois }, null, 2));
  const buckets = config.imports.buckets ? JSON.parse(await readFile(path.join(root, config.imports.buckets), 'utf8')) : { universalBuckets: [], featuredBuckets: [] };
  await writeFile(path.join(staging, `${regionId}-buckets.json`), JSON.stringify(buckets, null, 2));
  const supplemental = [];
  // Ship the resolved polygon so a published package remains self-describing
  // and cache-file definitions continue to work on its next rebuild.
  const boundaryArtifact = `${regionId}-boundary.geojson`;
  await cp(boundary.polygonFile, path.join(staging, boundaryArtifact));
  supplemental.push(boundaryArtifact);
  for (const item of config.imports.supplemental || []) {
    const source = path.join(root, item);
    const name = path.basename(item);
    await cp(source, path.join(staging, name));
    supplemental.push(name);
  }
  const manifest = {
    id: regionId, name: config.name, version: 1, generatedAt: new Date().toISOString(),
    boundary: { source: config.boundary.source, geometry: boundary.geometry, bbox: boundary.bbox }, source: { provider: 'OpenStreetMap', pbfUrl: config.osm.pbfUrl },
    artifacts: { pmtiles: `${regionId}.pmtiles`, poi: `${regionId}-poi.json`, buckets: `${regionId}-buckets.json`, supplemental },
    stats: { poiCount: pois.length }
  };
  await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await cp(configPath, path.join(staging, 'region.json'));
  await validatePackage(staging, manifest);
  const backup = `${output}.previous`;
  await rm(backup, { recursive: true, force: true });
  if (await exists(output)) await rename(output, backup);
  await rename(staging, output);
  await rm(backup, { recursive: true, force: true });
  console.log(`✓ Published valid region package: regions/${regionId}/`);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}
