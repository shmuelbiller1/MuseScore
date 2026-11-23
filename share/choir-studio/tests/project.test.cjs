/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Project = require('../project.js');
const Studio = require('../choir.js');
const { midi, source, rate } = require('../examples/fixtures.cjs');
const controls = { mode: 'solo', melodyTrack: 1, commonSource: 0, soloVoice: 3, tagVoice: 3,
    phraseMode: true, sourceKey: '9:minor', targetKey: '7:minor', octaves: 0 };
const parts = ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name, i) => ({ name, preset: name, track: i + 1,
    recording: 0, volume: 0.7, pan: 0, correction: 1, ...Studio.defaults[name],
    sourceHz: 0, cropStart: 0, cropEnd: 0, variation: false, mute: false, solo: false }));

test('standalone session preserves exact original bytes, MIDI, settings and manual note tags', async () => {
    // Cross the 24576-byte base64 chunk boundary and retain non-ASCII names.
    const input = new Blob([Studio.wav([source(220, 0.7)], rate)], { type: 'audio/wav' });
    const tags = [['1:0', [{ start: 0.01, end: 0.32, hz: 220 }, { start: 0.33, end: 0.65, hz: 0 }]]];
    const pitchEdits = [['1:0', 2]];
    const text = await Project.encodeProject({ midiBytes: midi(), recordings: [{ name: 'אָ.wav', blob: input }],
        parts, tags, controls, pitchEdits });
    const restored = Project.decodeProject(text);
    assert.deepEqual(restored.midiBytes, midi());
    assert.deepEqual(Buffer.from(await restored.recordings[0].blob.arrayBuffer()), Buffer.from(await input.arrayBuffer()));
    assert.equal(restored.recordings[0].name, 'אָ.wav');
    assert.deepEqual(restored.tags, tags);
    assert.deepEqual(restored.parts, parts);
    assert.deepEqual(restored.controls, controls);
    assert.deepEqual(restored.pitchEdits, pitchEdits);
    const mp4Text = await Project.encodeProject({ midiBytes: midi(), recordings: [{ name: 'mic.m4a',
        blob: new Blob(['mp4 bytes'], { type: 'audio/mp4;codecs=mp4a.40.2' }) }], parts, tags: [], controls });
    assert.equal(Project.decodeProject(mp4Text).recordings[0].blob.type, 'audio/mp4;codecs=mp4a.40.2');
    const oldFormat = JSON.parse(text);
    delete oldFormat.pitchEdits; delete oldFormat.controls.sourceKey;
    delete oldFormat.controls.targetKey; delete oldFormat.controls.octaves;
    const legacy = Project.decodeProject(JSON.stringify(oldFormat));
    assert.deepEqual(legacy.pitchEdits, []);
    assert.equal(legacy.controls.sourceKey, '0:major');
    const score = Studio.parseMidi(restored.midiBytes);
    const mix = Studio.render(score, [{ ...restored.parts[0], noteTags: restored.tags[0][1] }],
        [{ samples: source(220, 0.7) }], rate, 3);
    assert.ok(mix.peak > 0.01);
});

test('malformed or oversized session data fails rather than silently changing the recording', async () => {
    const text = await Project.encodeProject({ midiBytes: midi(), recordings: [{ name: 'take.wav',
        blob: new Blob([Studio.wav([source()], rate)], { type: 'audio/wav' }) }], parts, tags: [], controls });
    const altered = JSON.parse(text);
    assert.throws(() => Project.decodeProject('{'), SyntaxError);
    altered.version = 42;
    assert.throws(() => Project.decodeProject(JSON.stringify(altered)), /Unsupported choir project/);
    altered.version = 1; altered.sources[0].bytes = '%%%%';
    assert.throws(() => Project.decodeProject(JSON.stringify(altered)), /Invalid or oversized embedded/);
    altered.sources[0].bytes = JSON.parse(text).sources[0].bytes;
    altered.tags = [['1:0', [{ start: 0.9, end: 0.2, hz: 220 }]]];
    assert.throws(() => Project.decodeProject(JSON.stringify(altered)), /Invalid tagged note range/);
    altered.tags = []; altered.pitchEdits = [['1:0', 25]];
    assert.throws(() => Project.decodeProject(JSON.stringify(altered)), /Invalid saved note pitch edit/);
    altered.pitchEdits = []; altered.controls.sourceKey = '9:major';
    assert.throws(() => Project.decodeProject(JSON.stringify(altered)), /Invalid saved key transposition/);
    await assert.rejects(() => Project.encodeProject({ midiBytes: midi(), recordings: [{ name: 'huge.wav',
        blob: new Blob([new Uint8Array(24 * 1024 * 1024 + 1)], { type: 'audio/wav' }) }],
    parts, tags: [], controls }), /oversized original recording/);
});
