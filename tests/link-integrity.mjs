import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const html=fs.readFileSync('index.html','utf8');
const refs=[...html.matchAll(/(?:src|href)=["']([^"'#?]+)["']/g)].map(x=>x[1]).filter(x=>!/^https?:|^data:|^mailto:/.test(x));
for(const ref of refs){const local=ref.replace(/^\.\//,'');if(!fs.existsSync(path.join(root,local)))throw new Error(`Broken local asset reference: ${ref}`);}
console.log(`PASS: ${refs.length} local resident-app references resolve.`);
