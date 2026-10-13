'use strict';

/**
 * Dumps an OpenAPI 3.0 spec for every API product into ./specs.
 * Each file can be imported directly into RapidAPI when creating a listing.
 * Run: npm run specs
 */

const fs = require('fs');
const path = require('path');
const { buildSpec } = require('../lib/openapi');

const BASE_URL = process.env.PUBLIC_URL || 'https://rapidapi-factory.onrender.com';

const apisDir = path.join(__dirname, '..', 'apis');
const outDir = path.join(__dirname, '..', 'specs');
fs.mkdirSync(outDir, { recursive: true });

let count = 0;
for (const file of fs.readdirSync(apisDir)) {
  if (!file.endsWith('.js')) continue;
  const product = require(path.join(apisDir, file));
  if (!product || !product.prefix) continue;
  const spec = buildSpec(product, BASE_URL + product.prefix);
  const slug = product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const out = path.join(outDir, `${slug}.openapi.json`);
  fs.writeFileSync(out, JSON.stringify(spec, null, 2));
  console.log(`wrote ${out}`);
  count++;
}
console.log(`\n${count} OpenAPI specs written to ./specs`);
console.log(`Base URL used: ${BASE_URL}`);
console.log('Tip: set PUBLIC_URL=https://your-domain.com npm run specs before importing to RapidAPI.');
