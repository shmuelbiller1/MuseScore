/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Manually tagged singing segments; alignment and pitch, not a realism claim.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Studio = require('../choir.js');
const { evaluate } = require('../examples/evaluate-tagged.cjs');
const Project = require('../project.js');
const { decodeWav } = require('../examples/evaluate-real.cjs');
const { midi, rate } = require('../examples/fixtures.cjs');

function take() {
    const samples = new Float32Array(rate * 0.9);
    for (let i = 0; i < samples.length; ++i) {
        if (i < rate * 0.035 || (i >= rate * 0.4 && i < rate * 0.435)) {
            samples[i] = 0.13 * Math.sin(2 * Math.PI * 3500 * i / rate); // consonant-like attack
        } else if (i < rate * 0.33) {
            samples[i] = 0.22 * Math.sin(2 * Math.PI * 220 * i / rate);
        } else if (i >= rate * 0.435 && i < rate * 0.8) {
            samples[i] = 0.23 * Math.sin(2 * Math.PI * 330 * i / rate);
        }
    }
    return samples;
}
function rms(samples, start, end) {
    let energy = 0, count = 0;
    for (let i = Math.floor(start * rate); i < Math.floor(end * rate); ++i) { energy += samples[i] ** 2; count++; }
    return Math.sqrt(energy / count);
}
const score = Studio.parseMidi(midi([57, 64, 60, 45]));
const parts = [{ name: 'Soprano', track: 1, recording: 0, correction: 1, volume: 0.8,
    noteTags: [{ start: 0, end: 0.33, hz: 0 }, { start: 0.4, end: 0.65, hz: 0 }] }];

test('one recorded phrase is tagged to two independent written notes, fitted to note lengths and rests', () => {
    const source = take(), original = source.slice();
    const raw = Studio.taggedNote(source, rate, Studio.hz(57), Math.round(rate * 0.25), parts[0].noteTags[0]);
    for (let i = 0; i < 500; ++i) assert.ok(Math.abs(raw.samples[i] - source[i]) < 1e-7,
        `the original consonant-like attack changed at sample ${i}`);
    const mix = Studio.render(score, parts, [{ samples: source }], rate, 3);
    assert.ok(mix.peak > 0.01);
    assert.ok(rms(mix.left, 0.015, 0.04) > 0.002, 'source attack was discarded');
    assert.ok(rms(mix.left, 0.06, 0.16) > 0.01);
    assert.ok(rms(mix.left, 0.31, 0.55) < 0.001, 'score rest must remain silent');
    assert.ok(rms(mix.left, 0.68, 0.71) > 0.005, 'second tagged source is missing');
    assert.ok(Math.abs(Studio.estimatePitch(mix.left, rate, 0.065) - Studio.hz(57)) < 7);
    assert.ok(Math.abs(Studio.estimatePitch(mix.left, rate, 0.666) - Studio.hz(59)) < 9);
    assert.deepEqual(source, original, 'tagged render modified original recording');
    assert.ok(!mix.warnings.some(text => text.includes('extreme time stretch')));
});

test('missing, invalid, or extremely stretched tags fail visibly or warn', () => {
    const source = take(), recordings = [{ samples: source }];
    assert.throws(() => Studio.render(score, [{ ...parts[0], noteTags: [parts[0].noteTags[0]] }], recordings, rate, 3),
        /do not match written note count/);
    assert.throws(() => Studio.render(score, [{ ...parts[0], noteTags: [null, parts[0].noteTags[1]] }], recordings, rate, 3),
        /Soprano note 1: Tag a valid source range/);
    assert.throws(() => Studio.render(score, [{ ...parts[0], noteTags: [{ start: 0, end: 9, hz: 0 }, parts[0].noteTags[1]] }], recordings, rate, 3),
        /Soprano note 1: Tag a valid source range/);
    const extreme = Studio.render(score, [{ ...parts[0], noteTags: [{ start: 0.07, end: 0.15, hz: 220 }, parts[0].noteTags[1]] }], recordings, rate, 3);
    assert.ok(extreme.warnings.some(text => text.includes('extreme time stretch')));
});

test('real human vowel tagged twice produces repeatable before/after audio at written pitches and rests', () => {
    const base = path.join(__dirname, '../examples'), { mix, measurements, warnings } = evaluate();
    assert.deepEqual(fs.readFileSync(path.join(base, 'after-tagged-real-tenor.wav')),
        Buffer.from(Studio.wav([mix.left, mix.right], rate)));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, 'tagged-real-tenor-metrics.json'))).measurements,
        measurements);
    assert.equal(warnings.length, 0);
    for (const note of measurements) assert.ok(Math.abs(note.errorCents) < 5, `${note.note}: ${note.errorCents} cents`);
    assert.ok(rms(mix.left, 0, 0.22) < 0.001, 'early entrance');
    assert.ok(rms(mix.left, 0.55, 0.72) < 0.001, 'score rest not silent');
    assert.ok(rms(mix.left, 0.8, 0.84) > 0.005, 'second note missing');
});

test('the bundled offline tagged session reopens with exact original and recreates the demonstration', async () => {
    const base = path.join(__dirname, '../examples');
    const session = Project.decodeProject(fs.readFileSync(path.join(base, 'tagged-real-tenor.choir.json'), 'utf8'));
    assert.equal(session.controls.phraseMode, true);
    assert.equal(session.controls.soloVoice, 2);
    const original = fs.readFileSync(path.join(base, 'vocalset/tenor-m2-long-a.wav'));
    assert.deepEqual(Buffer.from(await session.recordings[0].blob.arrayBuffer()), original);
    const decoded = decodeWav(original);
    const arranged = Studio.arrangeParts('solo', Studio.parseMidi(session.midiBytes), session.parts,
        session.controls.commonSource, session.controls.melodyTrack, session.controls.soloVoice);
    arranged[0].noteTags = session.tags[0][1];
    const mix = Studio.render(Studio.parseMidi(session.midiBytes), arranged, [{ samples: decoded }], rate, 3);
    assert.deepEqual(Buffer.from(Studio.wav([mix.left, mix.right], rate)),
        fs.readFileSync(path.join(base, 'after-tagged-real-tenor.wav')));
});

test('initial sequential tags allocate source in written note order and skip MIDI rests', () => {
    const notes = score.tracks[1].notes, distributed = Studio.distributeTags(notes, 0.9);
    assert.equal(distributed.length, 2);
    assert.equal(distributed[0].start, 0);
    assert.equal(distributed[1].start, distributed[0].end);
    assert.equal(distributed[1].end, 0.9);
    assert.ok(notes[1].startSeconds > notes[0].endSeconds, 'fixture has a written rest');
    assert.throws(() => Studio.distributeTags(notes, 0), /Choose a written track/);
});
