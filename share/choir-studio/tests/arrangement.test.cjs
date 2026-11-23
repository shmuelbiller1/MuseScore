/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Written-note routing tests; not perceptual singer-identity tests.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Studio = require('../choir.js');
const { evaluate } = require('../examples/evaluate-single-source.cjs');
const { rate, source, midi } = require('../examples/fixtures.cjs');
const score = Studio.parseMidi(midi());
const parts = ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name, i) => ({
    name, track: i + 1, recording: 0, sourceHz: 220, volume: 0.7,
    correction: 1, ...Studio.defaults[name],
}));
const recordings = [{ samples: source() }];
const rms = (samples, start, stop) => {
    let energy = 0, count = 0;
    for (let i = Math.floor(start * rate); i < Math.floor(stop * rate); i++) { energy += samples[i] ** 2; count++; }
    return Math.sqrt(energy / count);
};

test('one recorded voice can sing any chosen written part alone, including bass', () => {
    for (let i = 0; i < 4; i++) {
        const arranged = Studio.arrangeParts('solo', score, parts, 0, i + 1, i);
        assert.equal(arranged.length, 1);
        assert.equal(arranged[0].track, i + 1);
        assert.equal(arranged[0].recording, 0);
        const mix = Studio.render(score, arranged, recordings, rate, 3);
        const note = score.tracks[i + 1].notes[0];
        assert.ok(rms(mix.left, note.startSeconds + 0.035, note.endSeconds - 0.02) > 0.002);
        assert.ok(Math.abs(Studio.estimatePitch(mix.left, rate, note.startSeconds + 0.04)
            - Studio.hz(note.pitch)) < 8, `${parts[i].name} missed written pitch`);
        if (note.startSeconds > 0.02) assert.ok(rms(mix.left, 0, note.startSeconds - 0.01) < 0.001);
        const next = score.tracks[i + 1].notes[1];
        assert.ok(rms(mix.left, note.endSeconds + 0.02, next.startSeconds - 0.02) < 0.001,
            'written rest not silent');
    }
    assert.deepEqual(parts.map(p => p.track), [1, 2, 3, 4], 'render must not rewrite assignment');
});

test('unison layers copy the chosen melody timing only; SATB retains distinct bass notes', () => {
    const unison = Studio.arrangeParts('unison', score, parts, 0, 1);
    assert.deepEqual(unison.map(p => p.track), [1, 1, 1, 1]);
    const layers = unison.map((_, i) => Studio.render(score,
        unison.map((part, j) => ({ ...part, solo: j === i })), recordings, rate, 3));
    for (const layer of layers) {
        assert.ok(Math.abs(Studio.estimatePitch(layer.left, rate, 0.04) - Studio.hz(69)) < 8);
        assert.ok(rms(layer.left, 0.35, 0.45) < 0.001, 'unison copied a different part');
    }
    const harmony = Studio.arrangeParts('choir', score, parts, 0, 1);
    assert.deepEqual(harmony.map(p => p.track), [1, 2, 3, 4]);
    const bass = Studio.render(score, harmony.map((p, i) => ({ ...p, solo: i === 3 })), recordings, rate, 3);
    assert.ok(Math.abs(Studio.estimatePitch(bass.left, rate, 0.415) - Studio.hz(57)) < 8,
        'bass must follow its own written pitch, not soprano transposition');
});

test('real single human vowel renders repeatable solo bass, unison and SATB audio with warnings', () => {
    const { solo, unison, harmony, measurements } = evaluate();
    const base = path.join(__dirname, '../examples');
    for (const [name, mix] of [['solo-bass', solo], ['unison', unison],
        ['four-written-parts', harmony]]) {
        assert.ok(mix.peak > 0.01, `${name}: silence`);
        assert.deepEqual(fs.readFileSync(path.join(base, `single-source-${name}.wav`)),
            Buffer.from(Studio.wav([mix.left, mix.right], rate)), `${name}: changed output`);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, 'single-source-metrics.json'))).measurements,
        measurements);
    assert.deepEqual(measurements.map(m => m.writtenPitch), [69, 64, 60, 45]);
    for (const measure of measurements) assert.ok(Math.abs(measure.errorCents) < 5,
        `${measure.part}: ${measure.errorCents} cents`);
    assert.ok(measurements[3].warnings.some(w => w.includes('extreme')),
        'one tenor sample in bass register must warn');
    assert.ok(rms(solo.left, 0, 0.35) < 0.001, 'solo bass must wait for its written onset');
    assert.ok(rms(unison.left, 0.34, 0.45) < 0.001, 'unison must follow melody rest');
});

test('choir mode rejects missing or duplicate written parts instead of inventing harmony', () => {
    const duplicate = parts.map(p => ({ ...p })); duplicate[3].track = 1;
    assert.throws(() => Studio.arrangeParts('choir', score, duplicate, 0, 1), /four different written-note tracks/);
    const missing = parts.map(p => ({ ...p })); missing[3].track = 0;
    assert.throws(() => Studio.arrangeParts('choir', score, missing, 0, 1), /four different written-note tracks/);
    assert.throws(() => Studio.arrangeParts('solo', score, parts, 0, 0, 0), /written melody track/);
    assert.throws(() => Studio.arrangeParts('unknown', score, parts, 0, 1, 0), /Choose solo/);
});
