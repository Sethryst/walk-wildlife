import { RegionManager, createInMemoryStorageProvider } from '../js/region-manager.js';

const regionKey = process.argv[2] || 'vienna';
const storage = createInMemoryStorageProvider();
const manager = new RegionManager(storage);

const region = await manager.getRegion(regionKey);
console.log(`✓ Region created: ${region.id}`);
console.log(`  Path: regions/${region.id}/`);
console.log(`  POIs: ${region.pois.length}`);
console.log(`  Buckets: ${region.buckets?.universalBuckets?.length || 0}`);
console.log('  Ready for offline use');
