'use strict';

/**
 * Bank Code Suite — validates and parses the world's national bank-identifier
 * systems: ISO 9362 SWIFT/BIC, US ABA routing numbers, UK sort codes,
 * India IFSC and Australia BSB.
 */

const { requireParams } = require('../lib/http');

function need(params, keys) {
  const msg = requireParams(params, keys);
  if (msg) {
    const e = new Error(msg);
    e.status = 400;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// ISO 3166-1 alpha-2 country code -> English short name (~250 entries).
// ---------------------------------------------------------------------------
const COUNTRY_NAMES = {
  AD: 'Andorra', AE: 'United Arab Emirates', AF: 'Afghanistan', AG: 'Antigua and Barbuda',
  AI: 'Anguilla', AL: 'Albania', AM: 'Armenia', AO: 'Angola', AQ: 'Antarctica',
  AR: 'Argentina', AS: 'American Samoa', AT: 'Austria', AU: 'Australia', AW: 'Aruba',
  AX: 'Åland Islands', AZ: 'Azerbaijan', BA: 'Bosnia and Herzegovina', BB: 'Barbados',
  BD: 'Bangladesh', BE: 'Belgium', BF: 'Burkina Faso', BG: 'Bulgaria', BH: 'Bahrain',
  BI: 'Burundi', BJ: 'Benin', BL: 'Saint Barthélemy', BM: 'Bermuda',
  BN: 'Brunei Darussalam', BO: 'Bolivia', BQ: 'Bonaire, Sint Eustatius and Saba',
  BR: 'Brazil', BS: 'Bahamas', BT: 'Bhutan', BV: 'Bouvet Island', BW: 'Botswana',
  BY: 'Belarus', BZ: 'Belize', CA: 'Canada', CC: 'Cocos (Keeling) Islands',
  CD: 'Congo (the Democratic Republic of the)', CF: 'Central African Republic',
  CG: 'Congo', CH: 'Switzerland', CI: "Côte d'Ivoire", CK: 'Cook Islands', CL: 'Chile',
  CM: 'Cameroon', CN: 'China', CO: 'Colombia', CR: 'Costa Rica', CU: 'Cuba',
  CV: 'Cabo Verde', CW: 'Curaçao', CX: 'Christmas Island', CY: 'Cyprus', CZ: 'Czechia',
  DE: 'Germany', DJ: 'Djibouti', DK: 'Denmark', DM: 'Dominica', DO: 'Dominican Republic',
  DZ: 'Algeria', EC: 'Ecuador', EE: 'Estonia', EG: 'Egypt', EH: 'Western Sahara',
  ER: 'Eritrea', ES: 'Spain', ET: 'Ethiopia', FI: 'Finland', FJ: 'Fiji',
  FK: 'Falkland Islands (Malvinas)', FM: 'Micronesia', FO: 'Faroe Islands', FR: 'France',
  GA: 'Gabon', GB: 'United Kingdom', GD: 'Grenada', GE: 'Georgia', GF: 'French Guiana',
  GG: 'Guernsey', GH: 'Ghana', GI: 'Gibraltar', GL: 'Greenland', GM: 'Gambia',
  GN: 'Guinea', GP: 'Guadeloupe', GQ: 'Equatorial Guinea', GR: 'Greece',
  GS: 'South Georgia and the South Sandwich Islands', GT: 'Guatemala', GU: 'Guam',
  GW: 'Guinea-Bissau', GY: 'Guyana', HK: 'Hong Kong', HM: 'Heard Island and McDonald Islands',
  HN: 'Honduras', HR: 'Croatia', HT: 'Haiti', HU: 'Hungary', ID: 'Indonesia',
  IE: 'Ireland', IL: 'Israel', IM: 'Isle of Man', IN: 'India',
  IO: 'British Indian Ocean Territory', IQ: 'Iraq', IR: 'Iran', IS: 'Iceland', IT: 'Italy',
  JE: 'Jersey', JM: 'Jamaica', JO: 'Jordan', JP: 'Japan', KE: 'Kenya', KG: 'Kyrgyzstan',
  KH: 'Cambodia', KI: 'Kiribati', KM: 'Comoros', KN: 'Saint Kitts and Nevis',
  KP: 'North Korea', KR: 'South Korea', KW: 'Kuwait', KY: 'Cayman Islands',
  KZ: 'Kazakhstan', LA: 'Laos', LB: 'Lebanon', LC: 'Saint Lucia', LI: 'Liechtenstein',
  LK: 'Sri Lanka', LR: 'Liberia', LS: 'Lesotho', LT: 'Lithuania', LU: 'Luxembourg',
  LV: 'Latvia', LY: 'Libya', MA: 'Morocco', MC: 'Monaco', MD: 'Moldova', ME: 'Montenegro',
  MF: 'Saint Martin (French part)', MG: 'Madagascar', MH: 'Marshall Islands',
  MK: 'North Macedonia', ML: 'Mali', MM: 'Myanmar', MN: 'Mongolia', MO: 'Macao',
  MP: 'Northern Mariana Islands', MQ: 'Martinique', MR: 'Mauritania', MS: 'Montserrat',
  MT: 'Malta', MU: 'Mauritius', MV: 'Maldives', MW: 'Malawi', MX: 'Mexico', MY: 'Malaysia',
  MZ: 'Mozambique', NA: 'Namibia', NC: 'New Caledonia', NE: 'Niger', NF: 'Norfolk Island',
  NG: 'Nigeria', NI: 'Nicaragua', NL: 'Netherlands', NO: 'Norway', NP: 'Nepal', NR: 'Nauru',
  NU: 'Niue', NZ: 'New Zealand', OM: 'Oman', PA: 'Panama', PE: 'Peru', PF: 'French Polynesia',
  PG: 'Papua New Guinea', PH: 'Philippines', PK: 'Pakistan', PL: 'Poland',
  PM: 'Saint Pierre and Miquelon', PN: 'Pitcairn', PR: 'Puerto Rico', PS: 'Palestine',
  PT: 'Portugal', PW: 'Palau', PY: 'Paraguay', QA: 'Qatar', RE: 'Réunion', RO: 'Romania',
  RS: 'Serbia', RU: 'Russia', RW: 'Rwanda', SA: 'Saudi Arabia', SB: 'Solomon Islands',
  SC: 'Seychelles', SD: 'Sudan', SE: 'Sweden', SG: 'Singapore', SH: 'Saint Helena',
  SI: 'Slovenia', SJ: 'Svalbard and Jan Mayen', SK: 'Slovakia', SL: 'Sierra Leone',
  SM: 'San Marino', SN: 'Senegal', SO: 'Somalia', SR: 'Suriname', SS: 'South Sudan',
  ST: 'Sao Tome and Principe', SV: 'El Salvador', SX: 'Sint Maarten (Dutch part)',
  SY: 'Syria', SZ: 'Eswatini', TC: 'Turks and Caicos Islands', TD: 'Chad',
  TF: 'French Southern Territories', TG: 'Togo', TH: 'Thailand', TJ: 'Tajikistan',
  TK: 'Tokelau', TL: 'Timor-Leste', TM: 'Turkmenistan', TN: 'Tunisia', TO: 'Tonga',
  TR: 'Turkey', TT: 'Trinidad and Tobago', TV: 'Tuvalu', TW: 'Taiwan',
  TZ: 'Tanzania, the United Republic of', UA: 'Ukraine', UG: 'Uganda',
  UM: 'United States Minor Outlying Islands', US: 'United States', UY: 'Uruguay',
  UZ: 'Uzbekistan', VA: 'Holy See', VC: 'Saint Vincent and the Grenadines',
  VE: 'Venezuela', VG: 'Virgin Islands (British)', VI: 'Virgin Islands (U.S.)',
  VN: 'Vietnam', VU: 'Vanuatu', WF: 'Wallis and Futuna', WS: 'Samoa', YE: 'Yemen',
  YT: 'Mayotte', ZA: 'South Africa', ZM: 'Zambia', ZW: 'Zimbabwe',
};

// ---------------------------------------------------------------------------
// 1. ISO 9362 SWIFT/BIC — AAAABBCCDDD (8 or 11 characters).
// ---------------------------------------------------------------------------
function validateBic(params) {
  need(params, ['bic']);
  const bic = String(params.bic).replace(/\s+/g, '').toUpperCase();
  const errors = [];

  const formatValid =
    (bic.length === 8 || bic.length === 11) &&
    /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);

  if (bic.length !== 8 && bic.length !== 11) {
    errors.push(`BIC must be 8 or 11 characters, got ${bic.length}`);
  } else if (!formatValid) {
    errors.push('BIC structure must be AAAABBCCDDD (bank 4 letters, country 2 letters, location 2 alphanumeric, optional branch 3 alphanumeric)');
  }

  let bankCode = null;
  let countryCode = null;
  let countryName = null;
  let locationCode = null;
  let branchCode = null;
  let isPrimaryOffice = null;
  let isPassive = null;

  if (formatValid) {
    bankCode = bic.slice(0, 4);
    countryCode = bic.slice(4, 6);
    locationCode = bic.slice(6, 8);
    branchCode = bic.length === 11 ? bic.slice(8, 11) : null;
    countryName = COUNTRY_NAMES[countryCode] || null;

    if (!countryName) {
      errors.push(`Unknown ISO 3166-1 alpha-2 country code: ${countryCode}`);
    }

    const locationStatus = locationCode[1];
    isPassive = locationStatus === '1';
    isPrimaryOffice =
      bic.length === 8 ||
      locationStatus === '0' ||
      locationStatus === '1' ||
      branchCode === 'XXX' ||
      branchCode === '000';
  }

  return {
    bic,
    valid: formatValid && errors.length === 0,
    format_valid: formatValid,
    bank_code: bankCode,
    country_code: countryCode,
    country_name: countryName,
    location_code: locationCode,
    branch_code: branchCode,
    is_primary_office: isPrimaryOffice,
    is_passive: isPassive,
    errors,
  };
}

// ---------------------------------------------------------------------------
// 2. US ABA routing number — 9 digits, 3-7-1 weighted checksum mod 10.
// ---------------------------------------------------------------------------
const ABA_WEIGHTS = [3, 7, 1, 3, 7, 1, 3, 7, 1];

const FED_DISTRICT_CITIES = {
  1: 'Boston', 2: 'New York', 3: 'Philadelphia', 4: 'Cleveland', 5: 'Richmond',
  6: 'Atlanta', 7: 'Chicago', 8: 'St. Louis', 9: 'Minneapolis', 10: 'Kansas City',
  11: 'Dallas', 12: 'San Francisco',
};

function fedDistrict(prefix2) {
  const n = Number(prefix2);
  if (n >= 1 && n <= 12) return n;
  if (n >= 21 && n <= 32) return n - 20;
  if (n >= 61 && n <= 72) return n - 60;
  return null;
}

function institutionType(prefix2) {
  const n = Number(prefix2);
  if (prefix2 === '00') return 'US Government';
  if (n >= 1 && n <= 12) return 'Federal Reserve / Commercial Bank';
  if (n >= 21 && n <= 32) return 'Thrift Institution (Savings Bank)';
  if (n >= 61 && n <= 72) return 'Electronic Transaction (ACH)';
  if (n === 80) return "Traveler's Cheques";
  return 'Unknown';
}

function validateAba(params) {
  need(params, ['routing_number']);
  const routingNumber = String(params.routing_number).trim();
  const errors = [];

  if (!/^\d{9}$/.test(routingNumber)) {
    errors.push('ABA routing number must be exactly 9 digits');
    return {
      routing_number: routingNumber,
      valid: false,
      checksum_valid: null,
      fed_district: null,
      district_city: null,
      institution_type: null,
      errors,
    };
  }

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(routingNumber[i]) * ABA_WEIGHTS[i];
  const checksumValid = sum % 10 === 0;
  if (!checksumValid) {
    errors.push(`Checksum failed: weighted sum ${sum} is not divisible by 10`);
  }

  const prefix2 = routingNumber.slice(0, 2);
  const district = fedDistrict(prefix2);
  const districtCity = district ? FED_DISTRICT_CITIES[district] : null;

  return {
    routing_number: routingNumber,
    valid: checksumValid,
    checksum_valid: checksumValid,
    fed_district: district,
    district_city: districtCity,
    institution_type: institutionType(prefix2),
    errors,
  };
}

// ---------------------------------------------------------------------------
// 3. UK sort code — 6 digits, optional account number modulus 10/11 check.
//    Standard weight tables (Vocalink): the 14-digit sort code + account
//    number is right-padded into a 16-position table.
// ---------------------------------------------------------------------------
const MOD10_WEIGHTS = [0, 0, 1, 2, 5, 3, 6, 4, 8, 7, 6, 5, 4, 3, 2, 1];
const MOD11_WEIGHTS = [0, 0, 1, 2, 5, 3, 6, 4, 8, 7, 6, 5, 4, 3, 2, 1];

function modulusSum(digits14, weights) {
  const padded = '00' + digits14; // 16 digits
  let sum = 0;
  for (let i = 0; i < 16; i++) sum += Number(padded[i]) * weights[i];
  return sum;
}

function validateSortCode(params) {
  need(params, ['sort_code']);
  const raw = String(params.sort_code).trim();
  const digits = raw.replace(/[\s-]+/g, '');
  const errors = [];

  const formatValid = /^\d{6}$/.test(digits);
  if (!formatValid) {
    errors.push('UK sort code must be 6 digits (accepts "40-47-84", "40 47 84" or "404784")');
  }

  const formatted = formatValid
    ? `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
    : null;

  let modulus10Valid = null;
  let modulus11Valid = null;
  let modulusPass = null;

  if (params.account_number !== undefined && params.account_number !== null && params.account_number !== '') {
    const account = String(params.account_number).trim();
    if (!/^\d{8}$/.test(account)) {
      errors.push('account_number must be 8 digits for modulus checking');
    } else if (formatValid) {
      const combined = digits + account;
      const sum = modulusSum(combined, MOD10_WEIGHTS);
      modulus10Valid = sum % 10 === 0;
      modulus11Valid = sum % 11 === 0;
      modulusPass = modulus10Valid || modulus11Valid;
    }
  }

  return {
    sort_code: digits,
    formatted,
    valid: formatValid,
    modulus10_valid: modulus10Valid,
    modulus11_valid: modulus11Valid,
    modulus_10_11_pass: modulusPass,
    errors,
  };
}

// ---------------------------------------------------------------------------
// 4. India IFSC — 4 letters + "0" + 6 alphanumeric.
// ---------------------------------------------------------------------------
const IFSC_BANKS = {
  HDFC: 'HDFC Bank',
  ICIC: 'ICICI Bank',
  SBIN: 'State Bank of India',
  AXIS: 'Axis Bank',
  KOTAK: 'Kotak Mahindra Bank',
  YESB: 'Yes Bank',
  UTIB: 'Axis Bank',
  PUNB: 'Punjab National Bank',
  IDIB: 'Indian Bank',
  CNRB: 'Canara Bank',
};

function validateIfsc(params) {
  need(params, ['ifsc']);
  const ifsc = String(params.ifsc).trim().toUpperCase();
  const errors = [];

  const formatValid = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc);
  if (!formatValid) {
    errors.push('IFSC must be 4 letters, a reserved "0", then 6 alphanumeric characters');
  }

  const bankCode = formatValid ? ifsc.slice(0, 4) : (ifsc.length >= 4 ? ifsc.slice(0, 4) : null);
  const branchCode = formatValid ? ifsc.slice(5) : null;
  const bankName = bankCode ? (IFSC_BANKS[bankCode] || null) : null;

  return {
    ifsc,
    valid: formatValid,
    bank_code: bankCode,
    branch_code: branchCode,
    bank_name: bankName,
    supported_banks: IFSC_BANKS,
    errors,
  };
}

// ---------------------------------------------------------------------------
// 5. Australia BSB — 6 digits, formatted "062-000".
//    No public/standardised checksum is defined, so checksum validation is
//    reported as not applicable.
// ---------------------------------------------------------------------------
function validateBsb(params) {
  need(params, ['bsb']);
  const raw = String(params.bsb).trim();
  const digits = raw.replace(/[\s-]+/g, '');
  const errors = [];

  const formatValid = /^\d{6}$/.test(digits);
  if (!formatValid) {
    errors.push('Australian BSB must be 6 digits (accepts "062-000", "062 000" or "062000")');
  }

  const formatted = formatValid
    ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}`
    : null;

  return {
    bsb: digits,
    formatted,
    valid: formatValid,
    checksum_applicable: false,
    checksum_valid: null,
    errors,
  };
}

// ---------------------------------------------------------------------------
// 6. Catalogue of supported bank-code systems.
// ---------------------------------------------------------------------------
function listSystems() {
  return {
    endpoint: '/bank-code/v1',
    description:
      'Bank Code Suite validates and parses national bank-identifier systems: ISO 9362 SWIFT/BIC, US ABA routing numbers, UK sort codes (modulus 10/11), India IFSC and Australia BSB.',
    systems: [
      { system: 'SWIFT/BIC', country: 'International (ISO 9362)', path: '/bic', param: 'bic' },
      { system: 'ABA routing number', country: 'United States', path: '/aba', param: 'routing_number' },
      { system: 'Sort code', country: 'United Kingdom', path: '/sort-code', param: 'sort_code' },
      { system: 'IFSC', country: 'India', path: '/ifsc', param: 'ifsc' },
      { system: 'BSB', country: 'Australia', path: '/bsb', param: 'bsb' },
    ],
  };
}

module.exports = {
  prefix: '/bank-code/v1',
  name: 'Bank Code Suite',
  tagline: 'Validate SWIFT/BIC, US ABA routing, UK sort codes, IBAN-linked bank codes, IFSC, BSB and more.',
  description:
    'Bank Code Suite validates and parses the world\'s national bank-identifier systems in one API: ISO 9362 SWIFT/BIC (with full ISO 3166-1 country resolution), US ABA routing numbers (3-7-1 checksum plus Federal Reserve district and institution-type decoding), UK sort codes (modulus 10/11 account checks), India IFSC and Australian BSB. Each scheme relies on its own country-specific algorithm and reference data — detail that is tedious and error-prone to rebuild in-house. Built for fintech KYC, payment processors, cross-border payout and reconciliation tools.',
  freeTier: 30,
  endpoints: [
    {
      path: '/bic',
      method: 'GET',
      summary: 'Validate a SWIFT/BIC code',
      operationId: 'validateBic',
      description: 'Parse and validate an 8 or 11 character ISO 9362 SWIFT/BIC code, resolving the bank, ISO country and primary-office/passive status.',
      params: [
        { name: 'bic', type: 'string', required: true, description: '8 or 11 character SWIFT/BIC code', example: 'DEUTDEFF500' },
      ],
      handler: validateBic,
    },
    {
      path: '/aba',
      method: 'GET',
      summary: 'Validate a US ABA routing number',
      operationId: 'validateAba',
      description: 'Validate a 9-digit US ABA routing number using the 3-7-1 weighted checksum and decode the Federal Reserve district and institution type.',
      params: [
        { name: 'routing_number', type: 'string', required: true, description: '9-digit ABA routing number', example: '021000021' },
      ],
      handler: validateAba,
    },
    {
      path: '/sort-code',
      method: 'GET',
      summary: 'Validate a UK sort code',
      operationId: 'validateSortCode',
      description: 'Validate and format a UK sort code and, when a 8-digit account number is supplied, run the UK modulus 10 and modulus 11 account checks.',
      params: [
        { name: 'sort_code', type: 'string', required: true, description: 'UK sort code (e.g. "40-47-84", "40 47 84" or "404784")', example: '40-47-84' },
        { name: 'account_number', type: 'string', required: false, description: 'Optional 8-digit account number to run the modulus 10/11 check', example: '70872490' },
      ],
      handler: validateSortCode,
    },
    {
      path: '/ifsc',
      method: 'GET',
      summary: 'Validate an Indian IFSC code',
      operationId: 'validateIfsc',
      description: 'Validate a 4-letter + 0 + 6-character Indian IFSC code and resolve the issuing bank from a reference table.',
      params: [
        { name: 'ifsc', type: 'string', required: true, description: 'Indian IFSC code', example: 'HDFC0000001' },
      ],
      handler: validateIfsc,
    },
    {
      path: '/bsb',
      method: 'GET',
      summary: 'Validate an Australian BSB',
      operationId: 'validateBsb',
      description: 'Validate and format a 6-digit Australian BSB number.',
      params: [
        { name: 'bsb', type: 'string', required: true, description: 'Australian BSB (e.g. "062-000")', example: '062-000' },
      ],
      handler: validateBsb,
    },
    {
      path: '/list',
      method: 'GET',
      summary: 'List supported bank-code systems',
      operationId: 'listBankCodeSystems',
      description: 'Catalogue of the bank-code systems supported by this API.',
      params: [],
      handler: listSystems,
    },
  ],
};
