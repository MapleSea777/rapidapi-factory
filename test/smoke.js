'use strict';

/**
 * Smoke test: boots the server on a random port and hits every endpoint.
 * Run with: npm test
 */

const { spawn } = require('child_process');
const path = require('path');

const PORT = 8123 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${name}: ${e.message}`);
  }
}

async function get(pathname) {
  const res = await fetch(BASE + pathname);
  const body = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function post(pathname, payload) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  // Boot server.
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 700));

  try {
    await check('catalog /', async () => {
      const b = await get('/');
      assert(b.products.length === 16, `expected 16 products, got ${b.products.length}`);
    });

    // ---- qr ----
    await check('qr /generate png', async () => {
      const b = await get('/qr/v1/generate?text=HELLO&format=png&scale=4');
      assert(b.format === 'png' && b.png_base64.length > 100, 'png missing');
      assert(b.version >= 1 && b.modules > 0, 'meta missing');
      // Verify PNG magic in decoded bytes
      const buf = Buffer.from(b.png_base64, 'base64');
      assert(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47, 'not a PNG');
    });
    await check('qr /generate svg', async () => {
      const b = await get('/qr/v1/generate?text=https://example.com&format=svg&ecc=H');
      assert(b.svg.startsWith('<svg'), 'svg missing');
      assert(b.ecc_level === 'H', 'ecc echo wrong');
    });
    await check('qr /generate too long -> 400', async () => {
      try {
        await get('/qr/v1/generate?text=' + encodeURIComponent('x'.repeat(400)));
        throw new Error('should have failed');
      } catch (e) {
        assert(e.message.includes('400'), 'expected 400');
      }
    });
    await check('qr /capacity', async () => {
      const b = await get('/qr/v1/capacity?ecc=L');
      assert(b.byte_mode_capacity.v1 === 17 && b.byte_mode_capacity.v10 === 271, `caps wrong: ${JSON.stringify(b.byte_mode_capacity)}`);
    });

    // ---- email-verify ----
    await check('email-verify /verify valid email', async () => {
      const b = await get('/email-verify/v1/verify?email=user@example.com');
      assert(b.valid_syntax === true, 'syntax should be valid');
      assert(b.is_disposable === false, 'should not be disposable');
      assert(typeof b.mx_found === 'boolean', 'mx_found missing');
      assert(Array.isArray(b.mx_hosts), 'mx_hosts missing');
      assert(typeof b.score === 'number' && typeof b.quality === 'string', 'score/quality missing');
      assert(typeof b.deliverable === 'boolean', 'deliverable missing');
    });
    await check('email-verify /verify flags disposable', async () => {
      const b = await get('/email-verify/v1/verify?email=x@mailinator.com');
      assert(b.is_disposable === true, 'should flag mailinator.com');
    });
    await check('email-verify /verify typo correction', async () => {
      const b = await get('/email-verify/v1/verify?email=user@gmial.com');
      assert(b.suggested_correction === 'user@gmail.com', `got ${b.suggested_correction}`);
    });
    await check('email-verify /verify missing param', async () => {
      try {
        await get('/email-verify/v1/verify');
        throw new Error('should have failed');
      } catch (e) {
        assert(e.message.includes('400'), 'expected 400');
      }
    });
    await check('email-verify /mx shape', async () => {
      const b = await get('/email-verify/v1/mx?domain=example.com');
      assert(b.domain === 'example.com', 'domain echo missing');
      assert(typeof b.found === 'boolean' && Array.isArray(b.records), 'shape wrong');
    });

    // ---- iban ----
    await check('iban /validate valid DE IBAN', async () => {
      const b = await get('/iban/v1/validate?iban=DE89370400440532013000');
      assert(b.valid === true, 'should be valid');
      assert(b.country === 'DE' && b.checksum_ok === true, 'country/checksum wrong');
      assert(b.bank_code === '37040044', `bank_code got ${b.bank_code}`);
    });
    await check('iban /validate bad checksum', async () => {
      const b = await get('/iban/v1/validate?iban=DE89370400440532013001');
      assert(b.valid === false && b.checksum_ok === false, 'should fail checksum');
    });
    await check('iban /validate unknown country', async () => {
      const b = await get('/iban/v1/validate?iban=XX89370400440532013000');
      assert(b.valid === false && b.country === 'XX', 'should reject unknown country');
    });
    await check('iban /format', async () => {
      const b = await get('/iban/v1/format?iban=DE89370400440532013000');
      assert(b.formatted === 'DE89 3704 0044 0532 0130 00', `got ${b.formatted}`);
    });
    await check('iban /generate check digits', async () => {
      const b = await get('/iban/v1/generate?country=DE&bban=370400440532013000');
      assert(b.iban === 'DE89370400440532013000', `got ${b.iban}`);
    });
    await check('iban /validate missing param', async () => {
      try {
        await get('/iban/v1/validate');
        throw new Error('should have failed');
      } catch (e) {
        assert(e.message.includes('400'), 'expected 400');
      }
    });

    // ---- vin ----
    await check('vin /decode valid VIN', async () => {
      const b = await get('/vin/v1/decode?vin=1HGCM82633A004352');
      assert(b.valid === true, `should be valid, errors: ${JSON.stringify(b.errors)}`);
      assert(b.manufacturer === 'Honda', `got ${b.manufacturer}`);
      assert(b.check_digit_valid === true, 'check digit should pass');
      assert(b.model_year === 2003, `got ${b.model_year}`);
    });
    await check('vin /decode bad check digit', async () => {
      const b = await get('/vin/v1/decode?vin=1HGCM82633A004353');
      assert(b.check_digit_valid === false, 'check digit should fail');
      assert(b.valid === false, 'should be invalid');
    });
    await check('vin /validate short VIN', async () => {
      const b = await get('/vin/v1/validate?vin=ABC');
      assert(b.valid === false && b.errors.length > 0, 'should reject short VIN');
    });
    await check('vin /decode missing param', async () => {
      try {
        await get('/vin/v1/decode');
        throw new Error('should have failed');
      } catch (e) {
        assert(e.message.includes('400'), 'expected 400');
      }
    });

    // ---- readability ----
    await check('readability /analyze', async () => {
      const b = await post('/readability/v1/analyze', { text: 'The cat sat on the mat. It was a sunny day.' });
      assert(b.counts.words === 11, `expected 11 words, got ${b.counts.words}`);
      assert(typeof b.scores.flesch_reading_ease === 'number', 'flesch missing');
      assert(typeof b.grade_level === 'number' && typeof b.difficulty === 'string', 'grade/difficulty missing');
      assert(b.counts.sentences === 2, `expected 2 sentences, got ${b.counts.sentences}`);
    });
    await check('readability /analyze missing param', async () => {
      try {
        await post('/readability/v1/analyze', {});
        throw new Error('should have failed');
      } catch (e) {
        assert(e.message.includes('400'), 'expected 400');
      }
    });

    // ---- sentiment ----
    await check('sentiment /analyze positive', async () => {
      const b = await post('/sentiment/v1/analyze', { text: 'I love this product, it is amazing!' });
      assert(b.score > 0 && b.label === 'positive', `got ${b.score}/${b.label}`);
      assert(Array.isArray(b.matched_tokens) && b.matched_tokens.length > 0, 'no matched tokens');
      assert(typeof b.comparative === 'number' && typeof b.token_count === 'number', 'comparative/token_count missing');
    });
    await check('sentiment /analyze negation flips', async () => {
      const b = await post('/sentiment/v1/analyze', { text: 'This is not good at all.' });
      assert(b.score < 0, `expected negative, got ${b.score}`);
    });
    await check('sentiment /analyze negative emoji', async () => {
      const b = await post('/sentiment/v1/analyze', { text: 'Terrible service 😡' });
      assert(b.score < 0 && b.label === 'negative', `got ${b.score}/${b.label}`);
    });

    // ---- mock-data ----
    await check('mock-data /generate person seeded', async () => {
      const b = await get('/mock-data/v1/generate?type=person&count=3&seed=42');
      assert(b.count === 3 && b.data.length === 3, 'wrong count');
      assert(b.seed_used === 42, 'seed echo wrong');
      assert(typeof b.data[0].full_name === 'string', 'person shape wrong');
      const c = await get('/mock-data/v1/generate?type=person&count=3&seed=42');
      assert(JSON.stringify(c.data) === JSON.stringify(b.data), 'same seed must be deterministic');
    });
    await check('mock-data /generate credit_card luhn-valid', async () => {
      const b = await get('/mock-data/v1/generate?type=credit_card&count=5&seed=7');
      const luhnValid = (num) => {
        let sum = 0;
        let dbl = false;
        for (let i = num.length - 1; i >= 0; i--) {
          let d = Number(num[i]);
          if (dbl) { d *= 2; if (d > 9) d -= 9; }
          sum += d;
          dbl = !dbl;
        }
        return sum % 10 === 0;
      };
      for (const card of b.data) {
        assert(/^\d{15,16}$/.test(card), `bad card format: ${card}`);
        assert(luhnValid(card), `card fails Luhn: ${card}`);
      }
    });
    await check('mock-data /generate uuid', async () => {
      const b = await get('/mock-data/v1/generate?type=uuid&seed=1');
      assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(b.data[0]), `bad uuid: ${b.data[0]}`);
    });
    await check('mock-data /generate unknown type', async () => {
      try {
        await get('/mock-data/v1/generate?type=bogus');
        throw new Error('should have failed');
      } catch (e) {
        assert(e.message.includes('400'), 'expected 400');
      }
    });
    await check('mock-data /types', async () => {
      const b = await get('/mock-data/v1/types');
      assert(Array.isArray(b.types) && b.types.includes('person') && b.types.length === 10, 'types list wrong');
    });

    // ---- domain-intel (network-dependent: shape-only assertions) ----
    await check('domain-intel /dns shape', async () => {
      const b = await get('/domain-intel/v1/dns?domain=example.com');
      assert(b.domain === 'example.com', 'domain echo missing');
      for (const k of ['a', 'aaaa', 'mx', 'ns', 'txt', 'cname']) {
        assert(Array.isArray(b[k]), `${k} should be an array`);
      }
      assert('soa' in b && typeof b.resolved === 'boolean', 'soa/resolved missing');
    });
    await check('domain-intel /whois shape', async () => {
      const b = await get('/domain-intel/v1/whois?domain=example.com');
      assert(b.domain === 'example.com', 'domain echo missing');
      assert(typeof b.registered === 'boolean', 'registered missing');
      assert(Array.isArray(b.status) && Array.isArray(b.events) && Array.isArray(b.nameservers), 'arrays missing');
      assert('registrar' in b, 'registrar missing');
    });
    await check('domain-intel /availability shape', async () => {
      const b = await get('/domain-intel/v1/availability?domain=example.com');
      assert(typeof b.available === 'boolean' && typeof b.registered === 'boolean', 'flags missing');
    });
    await check('domain-intel missing param', async () => {
      try {
        await get('/domain-intel/v1/dns');
        throw new Error('should have failed');
      } catch (e) {
        assert(e.message.includes('400'), 'expected 400');
      }
    });

    // ---- vat ----
    await check('vat /validate valid DE', async () => {
      const b = await get('/vat/v1/validate?country=DE&vat=DE123456788');
      assert(b.valid === true && b.checksum_valid === true, 'DE VAT should be valid');
    });
    await check('vat /validate mutated -> invalid', async () => {
      const b = await get('/vat/v1/validate?country=DE&vat=DE123456789');
      assert(b.valid === false, 'mutated DE VAT should be invalid');
    });
    await check('vat /countries', async () => {
      const b = await get('/vat/v1/countries');
      assert(b.count >= 24, `expected >=24 countries, got ${b.count}`);
    });
    await check('vat missing param -> 400', async () => {
      try {
        await get('/vat/v1/validate?country=DE');
        throw new Error('should have failed');
      } catch (e) {
        assert(e.message.includes('400'), 'expected 400');
      }
    });

    // ---- bank-code ----
    await check('bank-code /bic', async () => {
      const b = await get('/bank-code/v1/bic?bic=DEUTDEFF');
      assert(b.valid === true && b.country_code === 'DE', `bad BIC: ${JSON.stringify(b)}`);
    });
    await check('bank-code /aba checksum', async () => {
      const b = await get('/bank-code/v1/aba?routing_number=021000021');
      assert(b.valid === true && b.fed_district === 2, 'ABA 021000021 should be valid');
    });
    await check('bank-code /aba mutated -> invalid', async () => {
      const b = await get('/bank-code/v1/aba?routing_number=021000022');
      assert(b.valid === false, 'mutated ABA should be invalid');
    });
    await check('bank-code /ifsc', async () => {
      const b = await get('/bank-code/v1/ifsc?ifsc=HDFC0000001');
      assert(b.valid === true && b.bank_name === 'HDFC Bank', 'bad IFSC');
    });

    // ---- product-code ----
    await check('product-code /validate EAN-13', async () => {
      const b = await get('/product-code/v1/validate?code=4006381333931');
      assert(b.valid === true && b.detected_type === 'EAN-13', `bad EAN-13: ${JSON.stringify(b)}`);
    });
    await check('product-code /validate ISBN-13', async () => {
      const b = await get('/product-code/v1/validate?code=9780306406157');
      assert(b.valid === true && b.detected_type === 'ISBN-13', 'bad ISBN-13');
    });
    await check('product-code /generate round-trip', async () => {
      const b = await get('/product-code/v1/generate?type=ean13&body=400638133393');
      assert(b.code === '4006381333931', `got ${b.code}`);
    });

    // ---- crypto-addr ----
    await check('crypto-addr /validate BTC P2PKH', async () => {
      const b = await get('/crypto-addr/v1/validate?address=1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
      assert(b.valid === true && b.chain === 'BTC' && b.type === 'P2PKH', 'bad BTC address');
    });
    await check('crypto-addr /validate ETH EIP-55', async () => {
      const b = await get('/crypto-addr/v1/validate?address=0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
      assert(b.valid === true && b.chain === 'ETH' && b.checksum_valid === true, 'bad ETH address');
    });
    await check('crypto-addr /validate BTC bech32', async () => {
      const b = await get('/crypto-addr/v1/validate?address=bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
      assert(b.valid === true, 'bad bech32 address');
    });
    await check('crypto-addr mutated -> invalid', async () => {
      const b = await get('/crypto-addr/v1/validate?address=1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3');
      assert(b.valid === false, 'mutated BTC address should be invalid');
    });

    // ---- rrule ----
    await check('rrule /expand weekly', async () => {
      const b = await post('/rrule/v1/expand', { rrule: 'FREQ=WEEKLY;COUNT=10', dtstart: '1997-09-02T09:00:00Z' });
      assert(b.occurrences.length === 10, `expected 10, got ${b.occurrences.length}`);
      assert(b.occurrences[0] === '1997-09-02T09:00:00Z', `first was ${b.occurrences[0]}`);
      assert(b.occurrences[9].startsWith('1997-11-04'), `last was ${b.occurrences[9]}`);
    });
    await check('rrule /expand 2nd Monday', async () => {
      const b = await post('/rrule/v1/expand', { rrule: 'FREQ=MONTHLY;BYDAY=2MO;COUNT=3', dtstart: '1997-09-02T09:00:00Z' });
      assert(b.occurrences[0].startsWith('1997-09-08'), `first was ${b.occurrences[0]}`);
    });
    await check('rrule /expand month overflow', async () => {
      const b = await post('/rrule/v1/expand', { rrule: 'FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3', dtstart: '2024-01-31T00:00:00Z' });
      assert(b.occurrences.map((d) => d.slice(0, 10)).join(',') === '2024-01-31,2024-03-31,2024-05-31', `got ${b.occurrences}`);
    });
    await check('rrule missing param -> 400', async () => {
      try {
        await post('/rrule/v1/expand', { rrule: 'FREQ=DAILY' });
        throw new Error('should have failed');
      } catch (e) {
        assert(e.message.includes('400'), 'expected 400');
      }
    });

    // ---- cron ----
    await check('cron /parse every 15 min', async () => {
      const b = await post('/cron/v1/parse', { expression: '*/15 * * * *', from: '2024-01-01T00:00:00Z', count: 5 });
      assert(b.valid === true, 'should be valid');
      assert(b.next[0] === '2024-01-01T00:00:00.000Z' && b.next[4] === '2024-01-01T01:00:00.000Z', `got ${b.next}`);
    });
    await check('cron /parse weekdays 9am', async () => {
      const b = await post('/cron/v1/parse', { expression: '0 9 * * 1-5', from: '2024-01-01T00:00:00Z', count: 2 });
      assert(b.next[0].startsWith('2024-01-01T09:00') && b.next[1].startsWith('2024-01-02T09:00'), `got ${b.next}`);
    });
    await check('cron /parse impossible -> exhausted', async () => {
      const b = await post('/cron/v1/parse', { expression: '0 0 31 2 *', from: '2024-01-01T00:00:00Z', count: 5 });
      assert(Array.isArray(b.next) && b.next.length === 0, 'expected no occurrences');
    });
    await check('cron /validate invalid', async () => {
      const b = await get('/cron/v1/validate?expression=' + encodeURIComponent('not a cron'));
      assert(b.valid === false, 'expected invalid');
    });

    // ---- timezone ----
    await check('timezone /convert DST summer', async () => {
      const b = await get('/timezone/v1/convert?instant=2024-07-15T12:00:00Z&zones=America/New_York');
      assert(b.results[0].utc_offset === '-04:00', `got ${b.results[0].utc_offset}`);
    });
    await check('timezone /convert DST winter', async () => {
      const b = await get('/timezone/v1/convert?instant=2024-01-15T12:00:00Z&zones=America/New_York');
      assert(b.results[0].utc_offset === '-05:00', `got ${b.results[0].utc_offset}`);
    });
    await check('timezone invalid zone -> 400', async () => {
      try {
        await get('/timezone/v1/convert?instant=2024-01-15T12:00:00Z&zones=Mars/Phobos');
        throw new Error('should have failed');
      } catch (e) {
        assert(e.message.includes('400'), 'expected 400');
      }
    });

    // ---- semver ----
    await check('semver /compare prerelease', async () => {
      const b = await get('/semver/v1/compare?a=1.0.0-alpha&b=1.0.0');
      assert(b.comparison === -1, `got ${b.comparison}`);
    });
    await check('semver /satisfies caret', async () => {
      const ok = await get('/semver/v1/satisfies?version=1.2.3&range=' + encodeURIComponent('^1.2.0'));
      const no = await get('/semver/v1/satisfies?version=2.0.0&range=' + encodeURIComponent('^1.2.0'));
      assert(ok.satisfies === true && no.satisfies === false, 'caret range wrong');
    });
    await check('semver /bump premajor', async () => {
      const b = await get('/semver/v1/bump?version=1.2.3&release=premajor&prerelease_id=beta');
      assert(b.next === '2.0.0-beta.0', `got ${b.next}`);
    });

    // ---- infra ----
    await check('openapi spec generation', async () => {
      const b = await get('/spec/qr');
      assert(b.openapi === '3.0.3' && b.paths['/generate'], 'spec malformed');
    });
    await check('error handling: 404 route', async () => {
      try {
        await get('/nope/v1/x');
        throw new Error('should have failed');
      } catch (e) {
        assert(e.message.includes('404'), 'expected 404');
      }
    });
  } finally {
    child.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
