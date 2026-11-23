/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Objective pitch measurements on four licensed human singing vowels.
 * F0 accuracy does not establish a realistic or youthful vocal timbre.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Studio = require('../choir.js');
const { decodeWav, evaluate } = require('../examples/evaluate-real.cjs');
const { evaluate: evaluateLong } = require('../examples/evaluate-long.cjs');
const { midi } = require('../examples/fixtures.cjs');
const root = path.join(__dirname, '../examples');
const singers = {
    'soprano-f1-a.wav': 'bae7ab0db7fbded865bda483ea618417b83b4138fcb382bd6499e5bb0fe2e3b3',
    'alto-f5-a.wav': '1437fdd9b67efddcb1d61a5613ebef49c35e328acb07729eccb9dd7a8f07bd79',
    'tenor-m2-a.wav': '046adf9e94e0a9e2e2e32878d6a37867f6a89bfef09cf666490bbc11e6c4c296',
    'bass-m8-a.wav': '37db645d4b2488e9b60e73436c1d6b8f279e75fd4a943b549c9cded78ff7f572'
};
test('human VocalSet input clips match attributed sources and contain audible signals', () => {
    for (const [file, expected] of Object.entries(singers)) {
        const input = fs.readFileSync(path.join(root, 'vocalset', file));
        assert.equal(createHash('sha256').update(input).digest('hex'), expected);
        const pcm = decodeWav(input);
        assert.equal(pcm.length, 1920);
        assert.ok(pcm.some(sample => Math.abs(sample) > 0.1), `${file} is silent`);
    }
});
test('longer real excerpts are attributed, audible and keep four natural-register notes', () => {
    const longHashes = {
        'soprano-f1-long-a.wav': '09a79f8190c445888ac2d4e8ca9fb652897c7a511b53b213e1444344ed21d213',
        'alto-f5-long-a.wav': '56a84a0c481bd98f03ae2af02d6824d8e8f708d2504b686ec95bbd10737d5861',
        'tenor-m2-long-a.wav': 'ee2323fe3c0840e8865273779318ef0808378f0c12386e8ee0d61a29feb949e4',
        'bass-m8-long-a.wav': 'e98d662407716cc4682fcf3e8d83103ec318dc0bf7a29ba7832c04b4caa76d0b'
    };
    for (const [name, expected] of Object.entries(longHashes)) {
        const input = fs.readFileSync(path.join(root, 'vocalset', name));
        assert.equal(createHash('sha256').update(input).digest('hex'), expected);
        assert.equal(decodeWav(input).length, 19200);
    }
    const { mix, measurements, warnings } = evaluateLong();
    assert.deepEqual(measurements.map(m => m.midiPitch), [69, 64, 60, 45]);
    assert.ok(measurements.every(m => Math.abs(m.errorCents) < 10 && m.peak > 0.1), JSON.stringify(measurements));
    assert.deepEqual(warnings, []);
    assert.deepEqual(fs.readFileSync(path.join(root, 'four-part-long-vowel-mix.wav')),
        Buffer.from(Studio.wav([mix.left, mix.right], 24000)));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'long-vowel-metrics.json'))).measurements, measurements);
});
test('longer real excerpts obey both notes and intervening rests in every score part', () => {
    const names = ['Soprano', 'Alto', 'Tenor', 'Bass'], pitches = [69, 64, 60, 45];
    const score = Studio.parseMidi(midi(pitches));
    const recordings = ['soprano-f1', 'alto-f5', 'tenor-m2', 'bass-m8'].map(name => ({
        samples: decodeWav(fs.readFileSync(path.join(root, 'vocalset', `${name}-long-a.wav`))) }));
    const parts = names.map((name, i) => ({ name, recording: i, track: i + 1,
        cropStart: 0.015, cropEnd: 0.75, ...Studio.defaults[name] }));
    for (let i = 0; i < 4; ++i) {
        const isolated = Studio.render(score, parts.map((part, index) => ({ ...part, solo: index === i })), recordings, 24000, 3);
        const notes = score.tracks[i + 1].notes;
        for (const note of notes) {
            const observed = Studio.estimatePitch(isolated.left, 24000, note.startSeconds + 0.022);
            assert.ok(Math.abs(1200 * Math.log2(observed / Studio.hz(note.pitch))) < 10,
                `${names[i]} note ${note.pitch}: heard ${observed}`);
        }
        const rest = isolated.left.subarray(Math.floor((notes[0].endSeconds + 0.025) * 24000),
            Math.floor((notes[1].startSeconds - 0.025) * 24000));
        assert.ok(rest.length > 0 && rest.every(sample => sample === 0), `${names[i]} rest must be silent`);
    }
});
test('extreme timbre/formant controls do not retune four real sung vowels', () => {
    const names = Object.keys(singers), pitches = [69, 64, 60, 57];
    for (let i = 0; i < names.length; ++i) {
        const input = decodeWav(fs.readFileSync(path.join(root, 'vocalset', names[i])));
        const sourceHz = Studio.estimatePitch(input, 24000, 0.003, 0, 0.077);
        const target = Studio.hz(pitches[i]);
        const raw = Studio.vowelNote(input, 24000, sourceHz, target, 8400, { cropStart: 0.003, cropEnd: 0.077 });
        for (const settings of [{ formant: 0.7, brightness: 0, warmth: 1 },
            { formant: 1.3, brightness: 1, warmth: 0 }]) {
            const signal = Studio.shape(raw, 24000, settings);
            const observed = Studio.estimatePitch(signal, 24000, 0.10);
            assert.ok(Math.abs(1200 * Math.log2(observed / target)) < 10,
                `${names[i]} changed notated F0 to ${observed} with ${JSON.stringify(settings)}`);
        }
    }
});
test('real vowel outputs follow independent written F0 and the demo mix is reproducible', () => {
    const { mix, measurements, warnings } = evaluate();
    assert.equal(measurements.length, 4);
    assert.deepEqual(measurements.map(m => m.midiPitch), [69, 64, 60, 57]);
    assert.ok(measurements.every(m => Math.abs(m.errorCents) < 15 && m.peak > 0.05),
        JSON.stringify(measurements));
    assert.ok(warnings.some(w => w.includes('Alto') && w.includes('extreme')),
        'do not hide the unnatural alto source-to-note shift');
    assert.deepEqual(fs.readFileSync(path.join(root, 'four-part-real-vowel-mix.wav')),
        Buffer.from(Studio.wav([mix.left, mix.right], 24000)));
    const committed = JSON.parse(fs.readFileSync(path.join(root, 'real-vowel-metrics.json'), 'utf8'));
    assert.deepEqual(committed.measurements, measurements);
    assert.deepEqual(committed.warnings, warnings);
});
