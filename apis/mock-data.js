'use strict';

/**
 * Mock Data Factory — deterministic seeded fake data generation:
 * people, emails, addresses, phones, Luhn-valid credit cards, UUIDs,
 * dates, companies, colors and usernames.
 */

const { requireParams, toNumber } = require('../lib/http');

function need(params, keys) {
  const msg = requireParams(params, keys);
  if (msg) {
    const e = new Error(msg);
    e.status = 400;
    throw e;
  }
}

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  throw e;
}

// mulberry32 seeded PRNG.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const s = seed === undefined || seed === null || seed === ''
    ? Math.floor(Math.random() * 0xffffffff)
    : Number(seed);
  if (!Number.isFinite(s)) {
    badRequest('Parameter "seed" must be an integer');
  }
  return { rng: mulberry32(Math.floor(s)), seedUsed: Math.floor(s) };
}

const FIRST_NAMES = [
  'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
  'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Daniel', 'Nancy', 'Matthew', 'Lisa',
  'Anthony', 'Emma', 'Mark', 'Olivia', 'Steven', 'Sophia', 'Kevin', 'Isabella',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
];

const STREETS = [
  'Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Pine Rd', 'Elm St',
  'Washington Blvd', 'Lakeview Ter', 'Hillcrest Dr', 'Sunset Blvd',
  'River Rd', 'Church St', 'Highland Ave', 'Meadow Ln', 'Forest Dr', 'Park Pl',
];

const CITIES = [
  'Springfield', 'Riverton', 'Fairview', 'Greenville', 'Madison', 'Franklin',
  'Clinton', 'Georgetown', 'Salem', 'Bristol', 'Oxford', 'Arlington',
  'Burlington', 'Manchester', 'Milton', 'Newport',
];

const STATES = ['CA', 'TX', 'NY', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI', 'WA', 'AZ', 'MA', 'CO', 'VA', 'OR'];

const COMPANY_PREFIX = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Stark', 'Wayne', 'Apex', 'Nova', 'Zenith', 'Vertex', 'Summit', 'Pinnacle'];
const COMPANY_SUFFIX = ['Industries', 'Technologies', 'Solutions', 'Systems', 'Labs', 'Corp', 'Group', 'Dynamics', 'Enterprises', 'Works'];

const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'testmail.com', 'mockmail.com', 'sample.org'];

const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet', 'teal', 'magenta', 'cyan', 'maroon', 'navy', 'olive', 'coral', 'salmon', 'gold'];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function int(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function luhnCheckDigit(partial) {
  let sum = 0;
  let double = true; // rightmost of partial will be doubled first
  for (let i = partial.length - 1; i >= 0; i--) {
    let d = Number(partial[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

function genCreditCard(rng) {
  const kind = rng();
  let prefix;
  let length;
  if (kind < 0.5) {
    prefix = '4';
    length = 16; // Visa
  } else if (kind < 0.8) {
    prefix = '5' + String(int(rng, 1, 5));
    length = 16; // Mastercard
  } else {
    prefix = rng() < 0.5 ? '34' : '37';
    length = 15; // Amex
  }
  let partial = prefix;
  while (partial.length < length - 1) partial += String(int(rng, 0, 9));
  return partial + String(luhnCheckDigit(partial));
}

function genUuid(rng) {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      s += '-';
    } else if (i === 14) {
      s += '4';
    } else if (i === 19) {
      s += hex[8 + Math.floor(rng() * 4)]; // 8, 9, a, b
    } else {
      s += hex[Math.floor(rng() * 16)];
    }
  }
  return s;
}

function genDate(rng) {
  const start = Date.UTC(1970, 0, 1);
  const end = Date.UTC(2030, 11, 31);
  const t = start + rng() * (end - start);
  return new Date(t).toISOString();
}

function genPhone(rng) {
  return `+1${int(rng, 200, 989)}${String(int(rng, 0, 9999999)).padStart(7, '0')}`;
}

const GENERATORS = {
  person(rng) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    return {
      first_name: first,
      last_name: last,
      full_name: `${first} ${last}`,
      age: int(rng, 18, 85),
    };
  },
  email(rng) {
    const first = pick(rng, FIRST_NAMES).toLowerCase();
    const last = pick(rng, LAST_NAMES).toLowerCase();
    const sep = pick(rng, ['.', '_', '']);
    return `${first}${sep}${last}${int(rng, 1, 99)}@${pick(rng, EMAIL_DOMAINS)}`;
  },
  address(rng) {
    return {
      street: `${int(rng, 1, 9999)} ${pick(rng, STREETS)}`,
      city: pick(rng, CITIES),
      state: pick(rng, STATES),
      zip: String(int(rng, 10000, 99999)),
      country: 'US',
    };
  },
  phone(rng) {
    return genPhone(rng);
  },
  credit_card(rng) {
    return genCreditCard(rng);
  },
  uuid(rng) {
    return genUuid(rng);
  },
  date(rng) {
    return genDate(rng);
  },
  company(rng) {
    return `${pick(rng, COMPANY_PREFIX)} ${pick(rng, COMPANY_SUFFIX)}`;
  },
  color(rng) {
    return pick(rng, COLORS);
  },
  username(rng) {
    const word = pick(rng, FIRST_NAMES).toLowerCase();
    return `${word}${pick(rng, ['_', '.', ''])}${pick(rng, LAST_NAMES).toLowerCase()}${int(rng, 1, 999)}`;
  },
};

const TYPES = Object.keys(GENERATORS);

function generate(params) {
  need(params, ['type']);
  const type = String(params.type).toLowerCase();
  if (!GENERATORS[type]) {
    badRequest(`Unknown type: "${type}". Valid types: ${TYPES.join(', ')}`);
  }
  const count = params.count === undefined ? 1 : Math.round(toNumber(params.count, NaN));
  if (!Number.isFinite(count) || count < 1 || count > 100) {
    badRequest('Parameter "count" must be an integer between 1 and 100');
  }
  const { rng, seedUsed } = makeRng(params.seed);

  const data = [];
  for (let i = 0; i < count; i++) data.push(GENERATORS[type](rng));

  return { type, count, seed_used: seedUsed, data };
}

function types() {
  return { types: TYPES };
}

module.exports = {
  prefix: '/mock-data/v1',
  name: 'Mock Data Factory',
  tagline: 'Seeded, deterministic fake data: people, emails, cards (Luhn-valid), UUIDs and more.',
  description:
    'Mock Data Factory generates realistic test data with a seeded mulberry32 PRNG for reproducibility: people, emails, addresses, phone numbers, Luhn-valid credit cards (Visa/Mastercard/Amex prefixes), UUIDv4, dates, companies, colors and usernames. Batch up to 100 records per call. Perfect for development, demos and load testing.',
  freeTier: 30,
  endpoints: [
    {
      path: '/generate',
      method: 'GET',
      summary: 'Generate mock data',
      operationId: 'generateMockData',
      params: [
        { name: 'type', type: 'string', required: true, description: 'person|email|address|phone|credit_card|uuid|date|company|color|username', example: 'person' },
        { name: 'count', type: 'integer', required: false, description: 'How many records (1-100)', example: 5 },
        { name: 'seed', type: 'integer', required: false, description: 'PRNG seed for reproducible output', example: 42 },
      ],
      handler: generate,
    },
    {
      path: '/types',
      method: 'GET',
      summary: 'List available data types',
      operationId: 'listMockTypes',
      params: [],
      handler: types,
    },
  ],
};
