/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Explicit pitch edits, separate from voice-character filtering.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Studio = require('../choir.js');
const { evaluate } = require('../examples/evaluate-pitch-edit.cjs');
const { rate, source, midi } = require('../examples/fixtures.cjs');
const score = Studio.parseMidi(midi([69, 64, 60, 57]));
const recordings = [{ samples: source(440) }];

function firstNote(part, onset) {
    const mix = Studio.render(score, [part], recordings, rate, 3);
    return { mix, frequency: Studio.estimatePitch(mix.left, rate, onset + 0.055) };
}

test('A4 can explicitly become B4 while the score notes and timbre controls stay separate', () => {
    const part = { name: 'Soprano', track: 1, recording: 0, sourceHz: 440, correction: 1,
        pitchDeltas: [2, 0], ...Studio.defaults.Soprano };
    const { mix, frequency } = firstNote(part, 0);
    assert.equal(Studio.noteName(69), 'A4');
    assert.equal(Studio.noteName(71), 'B4');
    assert.ok(Math.abs(frequency - Studio.hz(71)) < 8, `B4 expected; measured ${frequency}`);
    assert.equal(score.tracks[1].notes[0].pitch, 69, 'the MIDI score must not be rewritten');
    assert.ok(mix.warnings.some(text => text.includes('explicit pitch edit A4 → B4')));
    const darker = firstNote({ ...part, formant: 0.75, brightness: 0.05 }, 0);
    assert.ok(Math.abs(darker.frequency - Studio.hz(71)) < 8, 'character control retuned edited pitch');
    assert.ok(Math.abs(darker.frequency - frequency) < 5);
});

test('A minor to G minor transposes every track by two semitones without copying soprano into bass', () => {
    const shift = Studio.keySemitones('9:minor', '7:minor');
    assert.equal(shift, -2);
    assert.equal(Studio.noteName(70, true), 'B♭4');
    assert.equal(Studio.inKey(70, '7:minor'), true);
    assert.equal(Studio.inKey(71, '7:minor'), false, 'B natural is chromatic in G natural minor');
    const soprano = { name: 'Soprano', track: 1, recording: 0, sourceHz: 440, correction: 1,
        transposeSemitones: shift, ...Studio.defaults.Soprano };
    const bass = { name: 'Bass', track: 4, recording: 0, sourceHz: 440, correction: 1,
        transposeSemitones: shift, ...Studio.defaults.Bass };
    const s = firstNote(soprano, 0), b = firstNote(bass, 0.375);
    assert.ok(Math.abs(s.frequency - Studio.hz(67)) < 8, `Soprano should be G4, got ${s.frequency}`);
    assert.ok(Math.abs(b.frequency - Studio.hz(55)) < 8, `Bass should be G3, got ${b.frequency}`);
    const edited = firstNote({ ...soprano, pitchDeltas: [2, 0] }, 0);
    assert.ok(Math.abs(edited.frequency - Studio.hz(69)) < 8, 'local note delta should follow the global key shift');
    assert.deepEqual(score.tracks.slice(1).map(t => t.notes[0].pitch), [69, 64, 60, 57]);
});

test('licensed real-singer A4→B4 and A-minor→G-minor WAVs and measurements are reproducible', () => {
    const results = evaluate(), base = path.join(__dirname, '../examples');
    const saved = JSON.parse(fs.readFileSync(path.join(base, 'pitch-edit-metrics.json'), 'utf8'));
    assert.deepEqual(results.map(({ id, description, measurements, warnings }) =>
        ({ id, description, measurements, warnings })), saved.versions);
    for (const result of results) {
        assert.deepEqual(fs.readFileSync(path.join(base, `after-tagged-${result.id}.wav`)),
            Buffer.from(Studio.wav([result.mix.left, result.mix.right], rate)));
        assert.ok(result.measurements.every(note => Math.abs(note.errorCents) < 6));
        assert.equal(result.mix.peak > 0.01, true);
    }
    assert.deepEqual(results[0].measurements.map(note => note.outputName), ['B4', 'B4']);
    assert.deepEqual(results[1].measurements.map(note => note.outputName), ['G4', 'A4']);
});

test('mode conversion and unsupported/out-of-range pitch edits fail rather than silently changing harmony', () => {
    assert.throws(() => Studio.keySemitones('9:major', '7:minor'), /Major-to-minor changes are not a transposition/);
    assert.throws(() => Studio.keySemitones('A:minor', '7:minor'), /valid source/);
    assert.throws(() => Studio.outputPitch(score.tracks[1].notes[0], { pitchDeltas: [25] }, 0), /Invalid pitch edit/);
    assert.throws(() => Studio.outputPitch({ pitch: 1 }, { transposeSemitones: -2 }, 0), /outside supported singing range/);
});
