/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Generated examples use synthetic harmonics, NOT a human recording.
 */
const fs = require('node:fs');
const path = require('node:path');
const Studio = require('../choir.js');
const { source, midi } = require('./fixtures.cjs');
const root = __dirname, rate = 24000, original = source();
fs.writeFileSync(path.join(root, 'before-synthetic-vowel.wav'), Buffer.from(Studio.wav([original], rate)));
const bright = Studio.shape(Studio.vowelNote(original, rate, 220, Studio.hz(69), rate * 0.45), rate,
    { formant: 1.18, warmth: 0.18, brightness: 0.85, strength: 0.7 }, 9);
fs.writeFileSync(path.join(root, 'after-synthetic-vowel-A4.wav'), Buffer.from(Studio.wav([bright], rate)));
const score = Studio.parseMidi(midi());
const parts = ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name, i) => ({ name, recording: 0, track: i + 1,
    sourceHz: 220, correction: 1, volume: 0.65, pan: i / 2 - 0.75, ...Studio.defaults[name] }));
const mix = Studio.render(score, parts, [{ samples: original }], rate, 3);
fs.writeFileSync(path.join(root, 'four-part-synthetic-mix.wav'), Buffer.from(Studio.wav([mix.left, mix.right], rate)));
fs.writeFileSync(path.join(root, 'four-independent-parts.mid'), Buffer.from(midi()));
console.log('Generated synthetic before/after and independent four-part score examples; peak:', mix.peak.toFixed(3));