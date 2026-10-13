'use strict';

/**
 * Readability Lab — six classic readability formulas plus consensus grade
 * level and difficulty classification.
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

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  throw e;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const cleaned = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = cleaned.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function fleschBands(score) {
  if (score >= 90) return 'very_easy';
  if (score >= 80) return 'easy';
  if (score >= 70) return 'fairly_easy';
  if (score >= 60) return 'standard';
  if (score >= 50) return 'fairly_difficult';
  if (score >= 30) return 'difficult';
  return 'very_confusing';
}

function analyze(params) {
  need(params, ['text']);
  const text = String(params.text);

  const words = text.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w));
  const wordCount = words.length;
  if (wordCount === 0) {
    badRequest('Text contains no words to analyze');
  }

  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const sentenceCount = Math.max(1, sentences.length);

  let syllables = 0;
  let polysyllables = 0;
  let letters = 0;
  for (const w of words) {
    const syl = countSyllables(w);
    syllables += syl;
    if (syl >= 3) polysyllables++;
    letters += w.replace(/[^a-zA-Z]/g, '').length;
  }

  const wps = wordCount / sentenceCount; // words per sentence
  const spw = syllables / wordCount; // syllables per word

  const flesch = 206.835 - 1.015 * wps - 84.6 * spw;
  const fleschKincaid = 0.39 * wps + 11.8 * spw - 15.59;
  const gunningFog = 0.4 * (wps + 100 * (polysyllables / wordCount));
  const smog = 1.043 * Math.sqrt((polysyllables * 30) / sentenceCount) + 3.1291;
  const colemanLiau = 0.0588 * ((letters / wordCount) * 100) - 0.296 * ((sentenceCount / wordCount) * 100) - 15.8;
  const ari = 4.71 * (letters / wordCount) + 0.5 * wps - 21.43;

  const grades = [fleschKincaid, gunningFog, smog, colemanLiau, ari]
    .map((g) => Math.max(0, g));
  const consensus = grades.reduce((s, g) => s + g, 0) / grades.length;

  return {
    counts: {
      words: wordCount,
      sentences: sentenceCount,
      syllables,
      polysyllables,
      letters,
      avg_words_per_sentence: round2(wps),
      avg_syllables_per_word: round2(spw),
    },
    scores: {
      flesch_reading_ease: round2(flesch),
      flesch_kincaid_grade: round2(fleschKincaid),
      gunning_fog: round2(gunningFog),
      smog: round2(smog),
      coleman_liau: round2(colemanLiau),
      automated_readability_index: round2(ari),
    },
    grade_level: Math.round(consensus),
    difficulty: fleschBands(flesch),
  };
}

module.exports = {
  prefix: '/readability/v1',
  name: 'Readability Lab',
  tagline: 'Six readability formulas, consensus grade level and difficulty classification.',
  description:
    'Readability Lab scores any text with six classic formulas — Flesch Reading Ease, Flesch-Kincaid Grade, Gunning Fog, SMOG, Coleman-Liau and the Automated Readability Index — plus a consensus grade level and a plain-language difficulty band. Built on a syllable heuristic with silent-e handling. Great for content teams, education and compliance writing.',
  freeTier: 30,
  endpoints: [
    {
      path: '/analyze',
      method: 'POST',
      summary: 'Analyze text readability',
      operationId: 'analyzeReadability',
      params: [
        { name: 'text', type: 'string', required: true, description: 'Text to analyze', example: 'The cat sat on the mat. It was a sunny day.' },
      ],
      handler: analyze,
    },
  ],
};
