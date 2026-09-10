import fs from 'node:fs';

const apiBaseUrl=String(process.env.GRIDWATCH_API_BASE_URL||'').trim().replace(/\/$/,'');
if(apiBaseUrl&&!/^https?:\/\//.test(apiBaseUrl))throw new Error('GRIDWATCH_API_BASE_URL must be an absolute HTTP(S) URL.');
fs.writeFileSync('data/runtime-config.js',`window.GRIDWATCH_CONFIG = Object.freeze(${JSON.stringify({apiBaseUrl})});\n`);
console.log(apiBaseUrl?'Built resident API configuration.':'Built local-only resident configuration with no live API URL.');
