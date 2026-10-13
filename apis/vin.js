'use strict';

/**
 * VIN Decoder — validates 17-character Vehicle Identification Numbers,
 * verifies the ISO 3779 check digit, resolves WMI manufacturer/country and
 * decodes the model year.
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

const TRANSLITERATION = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

// World Manufacturer Identifier table (30+ entries).
const WMI_TABLE = {
  '1HG': { manufacturer: 'Honda', country: 'USA' },
  '2HG': { manufacturer: 'Honda', country: 'Canada' },
  '1FT': { manufacturer: 'Ford', country: 'USA' },
  '1FA': { manufacturer: 'Ford', country: 'USA' },
  '1FM': { manufacturer: 'Ford', country: 'USA' },
  '1G1': { manufacturer: 'Chevrolet', country: 'USA' },
  '1GC': { manufacturer: 'Chevrolet', country: 'USA' },
  '2G1': { manufacturer: 'Chevrolet', country: 'Canada' },
  '1G4': { manufacturer: 'Buick', country: 'USA' },
  '1GT': { manufacturer: 'GMC', country: 'USA' },
  '1B3': { manufacturer: 'Dodge', country: 'USA' },
  '1C4': { manufacturer: 'Jeep/Chrysler', country: 'USA' },
  '1LN': { manufacturer: 'Lincoln', country: 'USA' },
  '1NX': { manufacturer: 'Toyota', country: 'USA' },
  '2T1': { manufacturer: 'Toyota', country: 'Canada' },
  '4T1': { manufacturer: 'Toyota', country: 'USA' },
  'JHM': { manufacturer: 'Honda', country: 'Japan' },
  'JTD': { manufacturer: 'Toyota', country: 'Japan' },
  'JN1': { manufacturer: 'Nissan', country: 'Japan' },
  'JF1': { manufacturer: 'Subaru', country: 'Japan' },
  'JM1': { manufacturer: 'Mazda', country: 'Japan' },
  'WBA': { manufacturer: 'BMW', country: 'Germany' },
  'WBS': { manufacturer: 'BMW M', country: 'Germany' },
  'WDB': { manufacturer: 'Mercedes-Benz', country: 'Germany' },
  'WVW': { manufacturer: 'Volkswagen', country: 'Germany' },
  'WAU': { manufacturer: 'Audi', country: 'Germany' },
  'WP0': { manufacturer: 'Porsche', country: 'Germany' },
  '3VW': { manufacturer: 'Volkswagen', country: 'Mexico' },
  'SAL': { manufacturer: 'Land Rover', country: 'United Kingdom' },
  '5YJ': { manufacturer: 'Tesla', country: 'USA' },
  'KMH': { manufacturer: 'Hyundai', country: 'South Korea' },
  'KM8': { manufacturer: 'Hyundai', country: 'South Korea' },
  'KNA': { manufacturer: 'Kia', country: 'South Korea' },
  'ZFF': { manufacturer: 'Ferrari', country: 'Italy' },
  'ZAM': { manufacturer: 'Maserati', country: 'Italy' },
};

// Model-year codes (position 10). Letters skip I, O, Q, U, Z.
const YEAR_CODES = {};
{
  const letters = 'ABCDEFGHJKLMNPRSTVWXY'; // A=2010 ... Y=2030
  for (let i = 0; i < letters.length; i++) YEAR_CODES[letters[i]] = 2010 + i;
  for (let d = 1; d <= 9; d++) YEAR_CODES[String(d)] = 2000 + d;
}

function transliterate(ch) {
  if (ch >= '0' && ch <= '9') return Number(ch);
  return TRANSLITERATION[ch];
}

function computeCheckDigit(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const value = transliterate(vin[i]);
    if (value === undefined) return null;
    sum += value * WEIGHTS[i];
  }
  const rem = sum % 11;
  return rem === 10 ? 'X' : String(rem);
}

function structuralErrors(vin) {
  const errors = [];
  if (vin.length !== 17) errors.push(`VIN must be 17 characters, got ${vin.length}`);
  if (/[IOQ]/.test(vin)) errors.push('VIN must not contain the letters I, O or Q');
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) errors.push('VIN contains invalid characters');
  return errors;
}

function decode(params) {
  need(params, ['vin']);
  const vin = String(params.vin).trim().toUpperCase();
  const errors = structuralErrors(vin);

  let checkDigitValid = null;
  let expectedCheckDigit = null;
  if (vin.length === 17 && errors.length === 0) {
    expectedCheckDigit = computeCheckDigit(vin);
    checkDigitValid = expectedCheckDigit === vin[8];
    if (!checkDigitValid) {
      errors.push(`Check digit mismatch: position 9 is "${vin[8]}", expected "${expectedCheckDigit}"`);
    }
  }

  const wmi = vin.slice(0, 3);
  const wmiInfo = WMI_TABLE[wmi] || null;
  const modelYear = YEAR_CODES[vin[9]] || null;

  return {
    vin,
    valid: errors.length === 0 && vin.length === 17,
    wmi,
    manufacturer: wmiInfo ? wmiInfo.manufacturer : null,
    country: wmiInfo ? wmiInfo.country : null,
    model_year: modelYear,
    year_code: vin.length === 17 ? vin[9] : null,
    check_digit: vin.length === 17 ? vin[8] : null,
    expected_check_digit: expectedCheckDigit,
    check_digit_valid: checkDigitValid,
    errors,
  };
}

function validate(params) {
  need(params, ['vin']);
  const vin = String(params.vin).trim().toUpperCase();
  const errors = structuralErrors(vin);
  return {
    vin,
    valid: errors.length === 0,
    length: vin.length,
    errors,
  };
}

module.exports = {
  prefix: '/vin/v1',
  name: 'VIN Decoder',
  tagline: 'VIN validation with ISO 3779 check digit, WMI lookup and model-year decoding.',
  description:
    'VIN Decoder validates 17-character Vehicle Identification Numbers: character-set rules (no I/O/Q), ISO 3779 check-digit verification with transliteration and weighting, World Manufacturer Identifier resolution for 30+ makers, and model-year decoding from the 10th position. Ideal for automotive marketplaces, insurance and fleet tools.',
  freeTier: 30,
  endpoints: [
    {
      path: '/decode',
      method: 'GET',
      summary: 'Decode a VIN',
      operationId: 'decodeVin',
      params: [
        { name: 'vin', type: 'string', required: true, description: '17-character VIN', example: '1HGCM82633A004352' },
      ],
      handler: decode,
    },
    {
      path: '/validate',
      method: 'GET',
      summary: 'Validate VIN structure',
      operationId: 'validateVin',
      params: [
        { name: 'vin', type: 'string', required: true, description: 'VIN to validate', example: '1HGCM82633A004352' },
      ],
      handler: validate,
    },
  ],
};
