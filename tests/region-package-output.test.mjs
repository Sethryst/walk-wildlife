import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { RegionPackage } from '../js/region-package.js';

const root = path.resolve(import.meta.dirname, '..');
for (const id of process.argv.slice(2)) {
  const directory = path.join(root, 'regions', id);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, id);
  assert.ok(['Polygon', 'MultiPolygon'].includes(manifest.boundary.geometry.type));
  for (const artifact of [manifest.artifacts.pmtiles, manifest.artifacts.poi, manifest.artifacts.buckets, ...manifest.artifacts.supplemental]) {
    assert.ok((await stat(path.join(directory, artifact))).size > 0, `${id}: missing ${artifact}`);
  }
  const pmtiles = await readFile(path.join(directory, manifest.artifacts.pmtiles));
  assert.equal(pmtiles.subarray(0, 7).toString('ascii'), 'PMTiles');
  const pkg = new RegionPackage({ id, manifest, pmtilesBlob: new Blob([pmtiles]), poiData: JSON.parse(await readFile(path.join(directory, manifest.artifacts.poi))), bucketsData: JSON.parse(await readFile(path.join(directory, manifest.artifacts.buckets))) });
  assert.equal(pkg.name, manifest.name);
}
console.log('published region package runtime-contract test passed');
