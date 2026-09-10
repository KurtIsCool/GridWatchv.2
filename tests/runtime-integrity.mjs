import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const manifest=JSON.parse(fs.readFileSync('data/geography-manifest.json','utf8'));

if(html.includes('GRIDWATCH_EMBEDDED_MANIFEST'))throw new Error('Runtime must not contain a stale embedded geography manifest.');
if(html.includes('const OFFICIAL_EVENTS'))throw new Error('Advisories must be loaded from the versioned data artifact, not hardcoded in index.html.');
if(html.includes('gridwatch.importedEvents'))throw new Error('Untrusted localStorage events must not enter the official evidence engine.');
if(!html.includes("return 'WINDOW_ENDED'"))throw new Error('Elapsed schedules must use WINDOW_ENDED, not RESTORED.');

const selectBody=html.match(/function selectBarangay\([\s\S]*?\n}\n\nfunction renderPlaceCard/)?.[0]||'';
if(!selectBody.includes('renderNow()'))throw new Error('Barangay selection must refresh the complete NOW evidence surface immediately.');

const context={window:{}};
vm.runInNewContext(fs.readFileSync('data/geography-bundle.js','utf8'),context);
const bundle=context.window.GRIDWATCH_GEOGRAPHY_BUNDLE;
if(!bundle||bundle.manifest?.status!=='VALIDATED')throw new Error('Validated geography bundle is missing.');
if(bundle.manifest.barangays?.length!==180||bundle.barangays?.features?.length!==180)throw new Error('Geography bundle must contain 180 accepted barangays.');
if(JSON.stringify(bundle.manifest)!==JSON.stringify(manifest))throw new Error('Geography bundle manifest differs from canonical JSON.');

for(const file of ['data/advisories.json','data/advisories-bundle.js'])if(!fs.existsSync(file))throw new Error(`Missing advisory runtime artifact: ${file}`);
if(!sw.includes("key.startsWith('gridwatch-')"))throw new Error('Service worker cache cleanup must be scoped to GridWatch caches.');
if(!sw.includes("caches.match(req)"))throw new Error('Offline navigation must attempt the requested cached route before the app fallback.');

console.log('PASS: runtime artifacts are authoritative, trusted events are external, elapsed windows are neutral, and UI/cache paths are synchronized.');
