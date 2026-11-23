/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Deterministic signal and score-onset regression, not an audition claim.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Studio = require('../choir.js');
const { rate, source, midi } = require('../examples/fixtures.cjs');
function amplitude(samples, begin, end) {
    let sum = 0; for (let i = Math.floor(begin * rate); i < Math.min(samples.length, Math.floor(end * rate)); ++i) sum += samples[i] ** 2;
    return Math.sqrt(sum / Math.max(1, Math.floor((end - begin) * rate)));
}
test('MIDI score drives independent part onsets, rests, durations and tempo changes', () => {
    const parsed = Studio.parseMidi(midi());
    assert.equal(parsed.tracks.filter(t => t.notes.length).length, 4);
    assert.deepEqual(Studio.noteTrackIndices(parsed), [1, 2, 3, 4]); // skip tempo-only conductor
    assert.deepEqual(parsed.tracks.slice(1).map(t => t.notes[0].pitch), [69, 64, 60, 57]);
    assert.deepEqual(parsed.tracks.slice(1).map(t => t.notes[0].startSeconds), [0, 0.125, 0.25, 0.375]);
    assert.equal(parsed.seconds(480), 0.5);
    assert.equal(parsed.seconds(960), 0.75); // tempo doubled after tick 480
    assert.equal(parsed.tracks[1].notes[0].endSeconds, 0.25);
    assert.equal(parsed.tracks[1].notes[1].startSeconds, 0.625); // rest after first note
});
test('pitch remains score-controlled while formant and timbre change', () => {
    const original = source();
    const estimated = Studio.estimatePitch(original, rate);
    assert.ok(Math.abs(estimated - 220) < 4, `source ${estimated}`);
    const target = Studio.hz(64); // E4, NOT the soprano source melody
    const raw = Studio.vowelNote(original, rate, estimated, target, rate * 0.45);
    const dark = Studio.shape(raw, rate, { formant: 0.78, brightness: 0.1, warmth: 0.8 });
    const bright = Studio.shape(raw, rate, { formant: 1.20, brightness: 0.9, warmth: 0.1 });
    const a = Studio.estimatePitch(dark, rate, 0.10);
    const b = Studio.estimatePitch(bright, rate, 0.10);
    assert.ok(Math.abs(a - target) < 6, `dark pitch ${a} vs ${target}`);
    assert.ok(Math.abs(b - target) < 6, `bright pitch ${b} vs ${target}`);
    assert.ok(Math.abs(a - b) < 4, `timbre changed F0: ${a} vs ${b}`);
    assert.ok(dark.some((x, i) => Math.abs(x - bright[i]) > 0.02), 'timbre did not change');
    assert.deepEqual(original, source(), 'source was modified');
});
test('four-part rendering follows separate notes, mute and solo; WAV is non-silent', () => {
    const parsed = Studio.parseMidi(midi());
    const recordings = [{ samples: source() }];
    const parts = ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name, i) => ({ name, recording: 0, track: i + 1,
        sourceHz: 220, correction: 1, volume: 0.65, pan: i / 2 - 0.75, ...Studio.defaults[name] }));
    const mix = Studio.render(parsed, parts, recordings, rate, 3);
    assert.ok(mix.peak > 0.01, `silent mix ${mix.peak}`);
    const solo = Studio.render(parsed, parts.map((p, i) => ({ ...p, solo: i === 0 })), recordings, rate, 3);
    assert.ok(amplitude(solo.left, 0.03, 0.20) > 0.01);
    assert.ok(amplitude(solo.left, 0.34, 0.45) < 0.001, 'soprano rest not silent');
    // Inspect every independent MIDI track through the same rendering path.
    for (let p = 0; p < 4; ++p) {
        const isolated = Studio.render(parsed, parts.map((part, i) => ({ ...part, solo: i === p })), recordings, rate, 3);
        const written = parsed.tracks[p + 1].notes[0];
        const onset = written.startSeconds;
        assert.ok(amplitude(isolated.left, onset + 0.025, onset + 0.10) > 0.004, `${parts[p].name} absent`);
        if (onset > 0.025) assert.ok(amplitude(isolated.left, 0, onset - 0.01) < 0.001, `${parts[p].name} early`);
        const measured = Studio.estimatePitch(isolated.left, rate, onset + 0.04);
        assert.ok(Math.abs(measured - Studio.hz(written.pitch)) < 8, `${parts[p].name}: ${measured} != ${Studio.hz(written.pitch)}`);
    }
    const muted = Studio.render(parsed, parts.map(p => ({ ...p, mute: true })), recordings, rate, 3);
    assert.equal(muted.peak, 0);
    const wav = new DataView(Studio.wav([mix.left, mix.right], rate));
    assert.equal(wav.getUint32(24, true), rate);
    assert.equal(wav.getUint16(22, true), 2);
    assert.equal(wav.getUint32(40, true), mix.left.length * 4);
});
test('chunked async renderer is deterministic and yields progress', async () => {
    const score = Studio.parseMidi(midi()), recordings = [{ samples: source() }];
    const parts = ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name, i) => ({ name, recording: 0,
        track: i + 1, sourceHz: 220, ...Studio.defaults[name] }));
    const synchronous = Studio.render(score, parts, recordings, rate, 3);
    const progress = [];
    const asynchronous = await Studio.renderAsync(score, parts, recordings, rate, 3, state => progress.push(state));
    assert.deepEqual(asynchronous.left, synchronous.left);
    assert.deepEqual(asynchronous.right, synchronous.right);
    assert.equal(progress.at(-1).completed, 8);
    assert.equal(progress.at(-1).total, 8);
    assert.ok(asynchronous.peak > 0.01);
});
test('pitch detection never reads beyond the selected vowel crop', () => {
    const recording = new Float32Array(rate * 0.3);
    recording.set(source(220, 0.04));
    for (let i = Math.floor(rate * 0.04); i < recording.length; ++i) recording[i] = 0.3 * Math.sin(2 * Math.PI * 310 * i / rate);
    const crop = Studio.estimatePitch(recording, rate, 0, 0, 0.04);
    assert.ok(Math.abs(crop - 220) < 5, `crop F0: ${crop}`);
    const unbounded = Studio.estimatePitch(recording, rate);
    assert.ok(Math.abs(unbounded - crop) > 30, `the test needs two different regions (${crop}, ${unbounded})`);
    const score = Studio.parseMidi(midi());
    const parts = ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name, i) => ({ name, recording: 0,
        track: i + 1, cropStart: 0, cropEnd: 0.04, sourceHz: 0 }));
    assert.ok(Studio.render(score, parts, [{ samples: recording }], rate, 2).peak > 0.01);
});
test('invalid inputs and unnatural register shifts fail visibly or warn', () => {
    assert.throws(() => Studio.parseMidi(Uint8Array.from([1, 2, 3])), /Truncated|header/);
    assert.throws(() => Studio.estimatePitch(new Float32Array(rate), rate), /silent/);
    assert.throws(() => Studio.vowelNote(source(), rate, 220, 1800, 1000), /outside supported/);
    const score = Studio.parseMidi(midi());
    const invalid = ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name, i) => ({ name, recording: 0,
        track: i + 1, sourceHz: 24000 }));
    assert.throws(() => Studio.render(score, invalid, [{ samples: source() }], rate, 2),
        /outside supported voiced range/);
    const parts = ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name, i) => ({ name, recording: 0,
        track: i + 1, sourceHz: 130, correction: 1, volume: 0.5 }));
    const mix = Studio.render(score, parts, [{ samples: source(130) }], rate, 2);
    assert.ok(mix.warnings.some(text => text.includes('another recording in this register')));
    assert.throws(() => Studio.render(score, parts, [{ samples: source(130) }], rate, 0.5),
        /no audio was silently truncated/);
});
test('checked-in before/after examples match this deterministic renderer', () => {
    const base = path.join(__dirname, '../examples');
    const raw = Buffer.from(Studio.wav([source()], rate));
    assert.deepEqual(fs.readFileSync(path.join(base, 'before-synthetic-vowel.wav')), raw);
    const shaped = Studio.shape(Studio.vowelNote(source(), rate, 220, Studio.hz(69), rate * 0.45), rate,
        { formant: 1.18, warmth: 0.18, brightness: 0.85, strength: 0.7 }, 9);
    const after = Buffer.from(Studio.wav([shaped], rate));
    assert.deepEqual(fs.readFileSync(path.join(base, 'after-synthetic-vowel-A4.wav')), after);
});