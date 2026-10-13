'use strict';

/**
 * Sentiment Engine — lexicon-based sentiment scoring with negation handling,
 * intensifiers and emoji support.
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

// Lexicon: 170 weighted words in [-1, 1].
const LEXICON = {
  // Positive
  good: 0.3, great: 0.6, excellent: 0.9, amazing: 0.9, awesome: 0.8,
  wonderful: 0.9, fantastic: 0.9, love: 0.8, loved: 0.8, loves: 0.8,
  like: 0.3, liked: 0.3, enjoy: 0.5, enjoyed: 0.5, enjoying: 0.5,
  happy: 0.8, happier: 0.8, happiest: 0.9, glad: 0.6, pleased: 0.6,
  delighted: 0.9, thrilled: 0.9, excited: 0.7, exciting: 0.7,
  beautiful: 0.7, nice: 0.4, fine: 0.2, perfect: 1, superb: 1,
  outstanding: 0.9, brilliant: 0.9, impressive: 0.7, remarkable: 0.7,
  incredible: 0.8, terrific: 0.9, splendid: 0.8, marvelous: 0.9,
  fabulous: 0.9, delightful: 0.8, charming: 0.6, pleasant: 0.5,
  comfortable: 0.4, convenient: 0.4, reliable: 0.5, solid: 0.4,
  strong: 0.4, fast: 0.3, quick: 0.3, easy: 0.4, easier: 0.4,
  simple: 0.3, helpful: 0.5, useful: 0.5, valuable: 0.5, worth: 0.4,
  recommend: 0.6, recommended: 0.6, recommending: 0.6,
  thanks: 0.4, thank: 0.4, grateful: 0.7, thankful: 0.7,
  win: 0.6, won: 0.6, wins: 0.6, winning: 0.6,
  success: 0.6, successful: 0.7, succeed: 0.6, achievement: 0.6,
  improve: 0.4, improved: 0.5, improvement: 0.5,
  better: 0.4, best: 0.7, favorite: 0.6, fun: 0.6, funny: 0.5,
  laugh: 0.5, laughed: 0.5, laughing: 0.5, smile: 0.5, smiled: 0.5,
  friendly: 0.5, kind: 0.5, generous: 0.6, polite: 0.4,
  professional: 0.5, quality: 0.4, premium: 0.4, elegant: 0.6,
  gorgeous: 0.8, stunning: 0.8, breathtaking: 0.9, positive: 0.5,
  correct: 0.3, right: 0.2, safe: 0.4, secure: 0.4, clean: 0.3,
  fresh: 0.3, smooth: 0.4, bright: 0.3, warm: 0.3, sweet: 0.4,
  tasty: 0.5, delicious: 0.7, yummy: 0.6,
  // Negative
  bad: -0.4, worse: -0.6, worst: -1, terrible: -0.9, awful: -0.9,
  horrible: -0.9, horrendous: -0.9, atrocious: -0.9, poor: -0.5,
  disappointing: -0.6, disappointed: -0.6, disappointment: -0.6,
  hate: -0.9, hated: -0.9, hates: -0.9, dislike: -0.5, disliked: -0.5,
  angry: -0.7, anger: -0.7, furious: -0.9, annoyed: -0.6, annoying: -0.6,
  frustrated: -0.6, frustrating: -0.6, frustration: -0.6,
  sad: -0.7, sadness: -0.7, unhappy: -0.7, miserable: -0.9,
  depressed: -0.8, upsetting: -0.6, worried: -0.5, worry: -0.5,
  worrying: -0.5, anxious: -0.5, anxiety: -0.5, fear: -0.7,
  afraid: -0.6, scared: -0.7, frightening: -0.7, ugly: -0.6,
  hideous: -0.9, gross: -0.7, disgusting: -0.9, nasty: -0.7,
  dirty: -0.4, broken: -0.6, broke: -0.4, fail: -0.6, failed: -0.7,
  fails: -0.6, failure: -0.8, failing: -0.6, error: -0.4, errors: -0.4,
  bug: -0.3, bugs: -0.3, problem: -0.4, problems: -0.4, issue: -0.3,
  issues: -0.3, trouble: -0.4, difficult: -0.3, hard: -0.2,
  slow: -0.3, slowest: -0.5, weak: -0.3, expensive: -0.3,
  overpriced: -0.6, useless: -0.8, worthless: -0.9, pointless: -0.6,
  boring: -0.5, bored: -0.4, dull: -0.4, tedious: -0.5,
  lose: -0.4, lost: -0.4, loss: -0.5, losing: -0.5,
  wrong: -0.4, incorrect: -0.4, false: -0.4, lie: -0.6, lies: -0.7,
  lying: -0.7, scam: -0.8, fraud: -0.8, spam: -0.5,
  crash: -0.5, crashed: -0.6, crashes: -0.6,
  pain: -0.5, painful: -0.6, hurt: -0.6, hurts: -0.6, hurting: -0.6,
  damage: -0.5, damaged: -0.6, destroy: -0.7, destroyed: -0.8,
  kill: -0.7, killed: -0.8, dead: -0.6, death: -0.6, die: -0.7, died: -0.7,
  sick: -0.5, illness: -0.6, disease: -0.6, danger: -0.6,
  dangerous: -0.6, unsafe: -0.5, risky: -0.4, warning: -0.4,
  threat: -0.6, threatening: -0.7, attack: -0.7, attacked: -0.7,
  victim: -0.6, crime: -0.6, criminal: -0.7, steal: -0.6,
  stole: -0.6, stolen: -0.7, corrupt: -0.7, corruption: -0.7,
  evil: -0.8, cruel: -0.8, brutal: -0.8, violent: -0.7, violence: -0.7,
  disaster: -0.8, disastrous: -0.8, catastrophe: -0.9,
  catastrophic: -0.9, emergency: -0.5, crisis: -0.6, panic: -0.6,
  nightmare: -0.7, horror: -0.8, tragedy: -0.8, tragic: -0.8,
  grief: -0.7, sorrow: -0.7, cry: -0.5, crying: -0.5, tears: -0.5,
  lonely: -0.6, tired: -0.3, exhausted: -0.5, stressed: -0.5,
  stress: -0.4, stressful: -0.5, overwhelmed: -0.5, confused: -0.3,
  confusing: -0.3, unclear: -0.3, complicated: -0.3, mess: -0.4,
  messy: -0.4, chaos: -0.5, chaotic: -0.5, junk: -0.5, garbage: -0.6,
  trash: -0.5, rubbish: -0.6,
};

const NEGATIONS = new Set([
  'not', 'never', 'no', 'nothing', "can't", 'cannot', "won't", "don't",
  "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't", "wouldn't",
  "shouldn't", 'hardly', 'barely', 'neither', 'nor',
]);

const INTENSIFIERS = { very: 1.5, really: 1.5, extremely: 1.5, so: 1.5, incredibly: 1.5, absolutely: 1.5 };
const DIMINISHERS = { slight: 0.5, slightly: 0.5, somewhat: 0.5, barely: 0.5, mildly: 0.5 };

const EMOJI_SCORES = {
  '🙂': 0.5, '😊': 0.6, '😃': 0.7, '😄': 0.7, '😍': 0.8, '🥳': 0.7,
  '❤️': 0.7, '❤': 0.7, '💕': 0.6, '👍': 0.5, '🎉': 0.6, '👏': 0.5,
  '💯': 0.5, '🌟': 0.5, '😀': 0.6, '😉': 0.4, '😎': 0.5,
  '🙁': -0.5, '😢': -0.7, '😭': -0.8, '😡': -0.9, '😠': -0.8,
  '👎': -0.5, '😞': -0.6, '😔': -0.5, '💔': -0.7, '😤': -0.6,
  '🤮': -0.8, '😱': -0.6, '😩': -0.6, '😒': -0.4,
};

function tokenize(text) {
  // Extract emojis separately, then split words.
  const tokens = [];
  const emojiRegex = /\p{Extended_Pictographic}/gu;
  let m;
  const emojis = [];
  while ((m = emojiRegex.exec(text)) !== null) emojis.push(m[0]);
  const words = String(text)
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .split(/[^\p{L}\p{N}'’]+/u)
    .filter(Boolean)
    .map((w) => w.replace(/’/g, "'"));
  return { words, emojis };
}

function analyze(params) {
  need(params, ['text']);
  const text = String(params.text);
  const { words, emojis } = tokenize(text);

  let total = 0;
  const matchedTokens = [];

  for (let i = 0; i < words.length; i++) {
    const token = words[i];
    let weight = LEXICON[token];
    if (weight === undefined) continue;

    // Intensifier/diminisher immediately before.
    const prev = i > 0 ? words[i - 1] : null;
    if (prev && INTENSIFIERS[prev] !== undefined) weight *= INTENSIFIERS[prev];
    else if (prev && DIMINISHERS[prev] !== undefined) weight *= DIMINISHERS[prev];

    // Negation within the previous 3 tokens flips the sign.
    let negated = false;
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (NEGATIONS.has(words[j])) {
        negated = true;
        break;
      }
    }
    if (negated) weight = -weight;

    total += weight;
    matchedTokens.push({ token, weight: Math.round(weight * 1000) / 1000 });
  }

  for (const emoji of emojis) {
    const w = EMOJI_SCORES[emoji];
    if (w !== undefined) {
      total += w;
      matchedTokens.push({ token: emoji, weight: w });
    }
  }

  const tokenCount = words.length + emojis.length;
  const matched = matchedTokens.length;
  const rawScore = matched > 0 ? total / matched : 0;
  const score = Math.round(Math.max(-1, Math.min(1, rawScore)) * 1000) / 1000;
  const label = score > 0.1 ? 'positive' : score < -0.1 ? 'negative' : 'neutral';

  return {
    score,
    label,
    comparative: tokenCount > 0 ? Math.round((total / tokenCount) * 1000) / 1000 : 0,
    matched_tokens: matchedTokens,
    token_count: tokenCount,
  };
}

module.exports = {
  prefix: '/sentiment/v1',
  name: 'Sentiment Engine',
  tagline: 'Lexicon-based sentiment with negation, intensifiers and emoji support.',
  description:
    'Sentiment Engine scores text polarity using a 170-word weighted lexicon, flips sentiment for negations within 3 tokens, boosts or dampens with intensifiers (very, really, slightly), and understands common emoji. Returns a clamped -1..1 score, positive/negative/neutral label, comparative score and matched tokens. Ideal for reviews, support tickets and social listening.',
  freeTier: 30,
  endpoints: [
    {
      path: '/analyze',
      method: 'POST',
      summary: 'Analyze sentiment of text',
      operationId: 'analyzeSentiment',
      params: [
        { name: 'text', type: 'string', required: true, description: 'Text to analyze', example: 'The product is great but shipping was slow.' },
      ],
      handler: analyze,
    },
  ],
};
