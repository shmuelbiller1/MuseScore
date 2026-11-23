/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Reproducible pitch/onset evaluation with attributed CC BY 4.0 human
 * VocalSet clips. This is NOT a perceptual or realism evaluation.
 */
const fs = require('node:fs');
const path = require('node:path');
const Studio = require('../choir.js');
const { midi } = require('./fixtures.cjs');
const rate = 24000;
const files = ['soprano-f1-a.wav', 'alto-f5-a.wav', 'tenor-m2-a.wav', 'bass-m8-a.wav'];
const names = ['Soprano', 'Alto', 'Tenor', 'Bass'];

function decodeWav(buffer) {
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE'
        || buffer.toString('ascii', 12, 16) !== 'fmt ' || buffer.readUInt16LE(20) !== 1
        || buffer.readUInt16LE(22) !== 1 || buffer.readUInt16LE(34) !== 16
        || buffer.toString('ascii', 36, 40) !== 'data') throw Error('Expected a 16-bit mono PCM WAV');
    const originalRate = buffer.readUInt32LE(24), length = buffer.readUInt32LE(40) / 2;
    if (44 + length * 2 !== buffer.length) throw Error('Unexpected WAV size');
    const result = new Float32Array(Math.floor(length * rate / originalRate));
    for (let i = 0; i < result.length; ++i) {
        const at = i * originalRate / rate, a = Math.floor(at), fraction = at - a;
        const x = buffer.readInt16LE(44 + a * 2), y = buffer.readInt16LE(44 + Math.min(a + 1, length - 1) * 2);
        result[i] = ((1 - fraction) * x + fraction * y) / 32768;
    }
    return result;
}
function evaluate(write = false) {
    const recordings = files.map(file => ({ samples: decodeWav(fs.readFileSync(path.join(__dirname, 'vocalset', file))) }));
    const score = Studio.parseMidi(midi());
    const parts = names.map((name, i) => ({ name, track: i + 1, recording: i,
        cropStart: 0.003, cropEnd: 0.077, correction: 1, volume: 0.65, pan: i / 2 - 0.75, ...Studio.defaults[name] }));
    const measurements = [];
    for (let i = 0; i < 4; ++i) {
        const isolated = Studio.render(score, parts.map((part, n) => ({ ...part, solo: i === n })), recordings, rate, 3);
        const note = score.tracks[i + 1].notes[0], target = Studio.hz(note.pitch);
        const source = Studio.estimatePitch(recordings[i].samples, rate, 0.003, 0, 0.077);
        const observed = Studio.estimatePitch(isolated.left, rate, note.startSeconds + 0.06);
        measurements.push({ part: names[i], singer: files[i], sourceHz: +source.toFixed(2),
            midiPitch: note.pitch, targetHz: +target.toFixed(2), measuredHz: +observed.toFixed(2),
            errorCents: +((1200 * Math.log2(observed / target))).toFixed(1),
            noteStartSeconds: note.startSeconds, noteEndSeconds: note.endSeconds,
            peak: +isolated.peak.toFixed(3) });
    }
    const mix = Studio.render(score, parts, recordings, rate, 3);
    if (write) {
        const afterSoprano = Studio.shape(Studio.vowelNote(recordings[0].samples, rate,
            measurements[0].sourceHz, Studio.hz(69), Math.round(rate * 0.5), parts[0]), rate, parts[0]);
        fs.writeFileSync(path.join(__dirname, 'after-vocalset-soprano-A4.wav'),
            Buffer.from(Studio.wav([afterSoprano], rate)));
        fs.writeFileSync(path.join(__dirname, 'four-part-real-vowel-mix.wav'),
            Buffer.from(Studio.wav([mix.left, mix.right], rate)));
        fs.writeFileSync(path.join(__dirname, 'real-vowel-metrics.json'),
            JSON.stringify({ methodology: 'automated F0 measurement on a short isolated steady note; not perceived realism',
                source: 'VocalSet 1.2 / mblackman vowel voice banks, CC BY 4.0 (see vocalset/ATTRIBUTION.md)',
                sampleRate: rate, durationSeconds: mix.left.length / rate, warnings: mix.warnings, measurements }, null, 2) + '\n');
    }
    return { mix, measurements, warnings: mix.warnings };
}
if (require.main === module) {
    const result = evaluate(true);
    console.log('Real recorded singing vowels; F0 tests only, NOT a realism claim:');
    console.table(result.measurements);
    console.log('Warnings:', result.warnings.join(' '));
}
module.exports = { decodeWav, evaluate };
