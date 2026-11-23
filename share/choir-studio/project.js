/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Offline, self-contained sidecar project. Originals remain byte-for-byte intact.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ChoirProject = api;
})(globalThis, function () {
    'use strict';
    const MAX_SOURCE = 24 * 1024 * 1024, MAX_TOTAL = 96 * 1024 * 1024, MAX_MIDI = 5 * 1024 * 1024;
    const FIELDS = ['name', 'preset', 'track', 'recording', 'volume', 'pan', 'correction', 'formant',
        'brightness', 'warmth', 'breathiness', 'resonance', 'strength', 'cropStart', 'cropEnd', 'sourceHz',
        'variation', 'mute', 'solo'];
    function base64(bytes) {
        const chunks = [];
        for (let i = 0; i < bytes.length; i += 24576) {
            const part = bytes.subarray(i, i + 24576);
            let binary = '';
            for (let j = 0; j < part.length; ++j) binary += String.fromCharCode(part[j]);
            chunks.push(btoa(binary)); // 24576 is divisible by 3; padding only at the end
        }
        return chunks.join('');
    }
    function unbase64(value, max) {
        if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 + 4
            || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error('Invalid or oversized embedded audio/MIDI');
        const result = new Uint8Array(Math.floor(value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0));
        let at = 0;
        for (let i = 0; i < value.length; i += 32768) {
            const binary = atob(value.slice(i, i + 32768));
            for (let j = 0; j < binary.length; ++j) result[at++] = binary.charCodeAt(j);
        }
        if (at !== result.length) throw Error('Invalid embedded audio/MIDI length');
        return result;
    }
    function checkParts(parts, count) {
        if (!Array.isArray(parts) || parts.length !== 4) throw Error('Project needs four voice characters');
        return parts.map(part => {
            if (!part || typeof part !== 'object' || !Number.isInteger(part.recording)
                || part.recording < 0 || part.recording >= count || !Number.isInteger(part.track)) throw Error('Invalid part assignment');
            const output = {};
            for (const field of FIELDS) {
                const value = part[field];
                if (value === undefined) continue;
                if (['name', 'preset'].includes(field) ? typeof value !== 'string' || value.length > 80
                    : ['variation', 'mute', 'solo'].includes(field) ? typeof value !== 'boolean'
                        : !Number.isFinite(value) || Math.abs(value) > 1000000) throw Error('Invalid part setting: ' + field);
                output[field] = value;
            }
            return output;
        });
    }
    function checkTags(tags, count) {
        if (!Array.isArray(tags) || tags.length > 512) throw Error('Invalid note tags');
        const seen = new Set();
        return tags.map(entry => {
            if (!Array.isArray(entry) || entry.length !== 2 || !/^\d+:\d+$/.test(entry[0])
                || !Array.isArray(entry[1]) || entry[1].length > 10000 || seen.has(entry[0])) throw Error('Invalid note tag list');
            seen.add(entry[0]);
            const recording = Number(entry[0].split(':')[1]);
            if (recording >= count) throw Error('Tag references an absent recording');
            return [entry[0], entry[1].map(tag => {
                if (tag === null) return null;
                if (!tag || !Number.isFinite(tag.start) || !Number.isFinite(tag.end)
                    || !Number.isFinite(tag.hz) || tag.start < 0 || tag.end <= tag.start
                    || tag.end > 90 || tag.hz < 0 || tag.hz > 900) throw Error('Invalid tagged note range');
                return { start: tag.start, end: tag.end, hz: tag.hz };
            })];
        });
    }
    function checkControls(controls) {
        if (!controls || !['solo', 'unison', 'choir'].includes(controls.mode)
            || !Number.isInteger(controls.melodyTrack) || !Number.isInteger(controls.commonSource)
            || !Number.isInteger(controls.soloVoice) || !Number.isInteger(controls.tagVoice)
            || typeof controls.phraseMode !== 'boolean') throw Error('Invalid project controls');
        const sourceKey = controls.sourceKey ?? '0:major', targetKey = controls.targetKey ?? '0:major';
        const octaves = controls.octaves ?? 0;
        if (!/^(1[01]|[0-9]):(major|minor)$/.test(sourceKey) || !/^(1[01]|[0-9]):(major|minor)$/.test(targetKey)
            || sourceKey.split(':')[1] !== targetKey.split(':')[1]
            || !Number.isInteger(octaves) || octaves < -1 || octaves > 1) throw Error('Invalid saved key transposition');
        return { mode: controls.mode, melodyTrack: controls.melodyTrack, commonSource: controls.commonSource,
            soloVoice: controls.soloVoice, tagVoice: controls.tagVoice, phraseMode: controls.phraseMode,
            sourceKey, targetKey, octaves };
    }
    function checkPitchEdits(edits) {
        if (!Array.isArray(edits) || edits.length > 10000) throw Error('Invalid saved note pitches');
        const seen = new Set();
        return edits.map(item => {
            if (!Array.isArray(item) || item.length !== 2 || !/^\d+:\d+$/.test(item[0])
                || seen.has(item[0]) || !Number.isInteger(item[1]) || Math.abs(item[1]) > 24) throw Error('Invalid saved note pitch edit');
            seen.add(item[0]); return [item[0], item[1]];
        });
    }
    async function encodeProject({ midiBytes, recordings, parts, tags, controls, pitchEdits = [] }) {
        if (!ArrayBuffer.isView(midiBytes) || midiBytes.BYTES_PER_ELEMENT !== 1
            || !midiBytes.length || midiBytes.length > MAX_MIDI
            || !Array.isArray(recordings) || !recordings.length || recordings.length > 16) throw Error('Load a MIDI and 1–16 recordings before saving');
        const checkedParts = checkParts(parts, recordings.length), checkedTags = checkTags(tags, recordings.length);
        const checkedControls = checkControls(controls), checkedEdits = checkPitchEdits(pitchEdits);
        let total = midiBytes.length;
        const sources = [];
        for (const recording of recordings) {
            if (!(recording.blob instanceof Blob) || !recording.blob.size || recording.blob.size > MAX_SOURCE
                || typeof recording.name !== 'string' || !recording.name || recording.name.length > 255) throw Error('Invalid or oversized original recording');
            total += recording.blob.size;
            if (total > MAX_TOTAL) throw Error('Project audio exceeds 96 MB; save shorter source takes');
            sources.push({ name: recording.name, type: recording.blob.type || 'application/octet-stream',
                bytes: base64(new Uint8Array(await recording.blob.arrayBuffer())) });
        }
        return JSON.stringify({ version: 1, midi: base64(midiBytes), sources, parts: checkedParts,
            tags: checkedTags, controls: checkedControls, pitchEdits: checkedEdits });
    }
    function decodeProject(text) {
        if (typeof text !== 'string' || text.length > 135 * 1024 * 1024) throw Error('Oversized project');
        const project = JSON.parse(text);
        if (project?.version !== 1 || !Array.isArray(project.sources) || !project.sources.length
            || project.sources.length > 16) throw Error('Unsupported choir project format');
        let total = 0;
        const recordings = project.sources.map(source => {
            if (!source || typeof source.name !== 'string' || !source.name || source.name.length > 255
                || typeof source.type !== 'string' || source.type.length > 128
                || !/^(?:audio\/[\w.+-]+|application\/octet-stream)(?:\s*;\s*codecs=(?:"[\w.,+-]+"|[\w.,+-]+))?$/i.test(source.type)) throw Error('Invalid source metadata');
            const bytes = unbase64(source.bytes, MAX_SOURCE);
            if (!bytes.length) throw Error('Empty source recording');
            total += bytes.length;
            if (total > MAX_TOTAL) throw Error('Project audio exceeds 96 MB');
            return { name: source.name, blob: new Blob([bytes], { type: source.type }) };
        });
        const midiBytes = unbase64(project.midi, MAX_MIDI);
        if (!midiBytes.length) throw Error('Missing score MIDI');
        return { midiBytes, recordings, parts: checkParts(project.parts, recordings.length),
            tags: checkTags(project.tags, recordings.length), controls: checkControls(project.controls),
            pitchEdits: checkPitchEdits(project.pitchEdits ?? []) };
    }
    return { encodeProject, decodeProject };
});
