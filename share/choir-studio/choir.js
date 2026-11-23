/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Personal Voice Choir Studio: offline, experimental score-aligned vowel renderer.
 * No network, model downloads or third-party DSP libraries.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ChoirStudio = api;
})(globalThis, function () {
    'use strict';
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);
    const sharpNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
    const flatNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
    const noteName = (pitch, flats = false) => (flats ? flatNames : sharpNames)[pitch % 12] + (Math.floor(pitch / 12) - 1);
    function keySemitones(from, to, octaves = 0) {
        const key = value => {
            const match = /^(1[01]|[0-9]):(major|minor)$/.exec(value);
            if (!match) throw Error('Choose a valid source and target key');
            return { tonic: Number(match[1]), mode: match[2] };
        };
        const a = key(from), b = key(to);
        if (a.mode !== b.mode) throw Error('Major-to-minor changes are not a transposition; edit the written notes or choose keys of the same mode.');
        if (!Number.isInteger(octaves) || octaves < -1 || octaves > 1) throw Error('Choose a valid octave offset');
        return ((b.tonic - a.tonic + 18) % 12) - 6 + 12 * octaves;
    }
    function inKey(pitch, key) {
        const match = /^(1[01]|[0-9]):(major|minor)$/.exec(key);
        if (!match) throw Error('Choose a valid key guide');
        const degrees = match[2] === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
        return degrees.includes(((pitch - Number(match[1])) % 12 + 12) % 12);
    }
    function outputPitch(note, part, index) {
        const transpose = part.transposeSemitones ?? 0, delta = part.pitchDeltas?.[index] ?? 0;
        if (!Number.isInteger(transpose) || Math.abs(transpose) > 24 || !Number.isInteger(delta)
            || Math.abs(delta) > 24 || !Number.isInteger(note.pitch)) throw Error('Invalid pitch edit');
        const target = note.pitch + transpose + delta;
        if (target < 0 || target > 127 || hz(target) < 50 || hz(target) > 1400) throw Error('Output note outside supported singing range');
        return target;
    }
    const defaults = {
        Soprano: { brightness: 0.68, warmth: 0.27, breathiness: 0.12, resonance: 0.36, strength: 0.65, formant: 1.12 },
        Alto: { brightness: 0.45, warmth: 0.65, breathiness: 0.06, resonance: 0.46, strength: 0.64, formant: 0.98 },
        Tenor: { brightness: 0.55, warmth: 0.52, breathiness: 0.06, resonance: 0.49, strength: 0.69, formant: 0.95 },
        Bass: { brightness: 0.32, warmth: 0.76, breathiness: 0.03, resonance: 0.58, strength: 0.76, formant: 0.83 }
    };

    // Full-track MIDI export from the same score is the timing authority: it
    // carries repeat expansion, tempo changes, note gates and velocity. No
    // attempt is made to infer music from the recording or from a manuscript.
    function parseMidi(bytes) {
        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        let pos = 0;
        function check(n) { if (pos + n > data.length) throw Error('Truncated MIDI file'); }
        function u8() { check(1); return data[pos++]; }
        function u16() { check(2); const n = view.getUint16(pos); pos += 2; return n; }
        function u32() { check(4); const n = view.getUint32(pos); pos += 4; return n; }
        function str(n) { check(n); const s = String.fromCharCode(...data.subarray(pos, pos + n)); pos += n; return s; }
        function variable() { let n = 0, b; for (let i = 0; i < 4; ++i) { b = u8(); n = (n << 7) | (b & 127); if (!(b & 128)) return n; } throw Error('Invalid MIDI variable length'); }
        if (str(4) !== 'MThd' || u32() !== 6) throw Error('Expected a standard MIDI header');
        const format = u16(), count = u16(), division = u16();
        if (format > 1 || (division & 0x8000) || !division) throw Error('Only PPQ MIDI format 0 or 1 is supported');
        const tempos = [{ tick: 0, us: 500000, order: -1 }], tracks = [];
        let order = 0;
        for (let track = 0; track < count; ++track) {
            if (str(4) !== 'MTrk') throw Error('Missing MIDI track');
            const length = u32(), end = pos + length;
            if (end > data.length) throw Error('Truncated MIDI track');
            const names = [], notes = [], active = new Map();
            let tick = 0, running = 0;
            while (pos < end) {
                tick += variable();
                let status = u8();
                if (status < 128) { if (!running) throw Error('Invalid MIDI running status'); --pos; status = running; }
                else if (status < 240) running = status;
                else running = 0;
                if (status === 255) {
                    const type = u8(), len = variable(); check(len);
                    if (type === 81 && len === 3) tempos.push({ tick, us: (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2], order: order++ });
                    if (type === 3) names.push(new TextDecoder().decode(data.subarray(pos, pos + len)));
                    pos += len;
                } else if (status === 240 || status === 247) { const len = variable(); check(len); pos += len; }
                else {
                    const type = status & 240, channel = status & 15;
                    const a = u8(), b = (type === 192 || type === 208) ? 0 : u8();
                    if (type === 144 && b > 0) {
                        const key = channel + ':' + a;
                        if (!active.has(key)) active.set(key, []);
                        active.get(key).push({ tick, pitch: a, velocity: b, channel });
                    } else if (type === 128 || (type === 144 && b === 0)) {
                        const queue = active.get(channel + ':' + a);
                        if (queue && queue.length) { const note = queue.shift(); note.end = tick; if (tick > note.tick) notes.push(note); }
                    }
                }
                if (pos > end) throw Error('MIDI event exceeds track');
            }
            if (pos !== end) throw Error('Invalid MIDI track length');
            notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
            tracks.push({ name: names[0] || 'Track ' + (track + 1), notes });
        }
        tempos.sort((a, b) => a.tick - b.tick || a.order - b.order);
        const timeline = [];
        for (const tempo of tempos) {
            if (!tempo.us) throw Error('Invalid zero tempo');
            if (timeline.length && timeline.at(-1).tick === tempo.tick) timeline.pop();
            const prev = timeline.at(-1);
            timeline.push({ tick: tempo.tick, us: tempo.us,
                seconds: prev ? prev.seconds + (tempo.tick - prev.tick) * prev.us / (division * 1e6) : 0 });
        }
        function seconds(tick) {
            let lo = 0, hi = timeline.length - 1;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (timeline[mid].tick <= tick) lo = mid; else hi = mid - 1; }
            const t = timeline[lo]; return t.seconds + (tick - t.tick) * t.us / (division * 1e6);
        }
        tracks.forEach(track => track.notes.forEach(note => { note.startSeconds = seconds(note.tick); note.endSeconds = seconds(note.end); }));
        return { format, division, tracks, tempo: timeline, seconds };
    }

    function estimatePitch(samples, rate, startSeconds = 0, override = 0, endSeconds = 0) {
        if (override > 0) return override;
        const start = Math.floor(startSeconds * rate);
        const end = endSeconds > 0 ? Math.min(samples.length, Math.floor(endSeconds * rate)) : samples.length;
        const length = Math.min(Math.floor(rate * 0.09), end - start);
        if (start < 0 || length < rate * 0.03) throw Error('Choose a voiced vowel region of at least 30 ms');
        const min = Math.floor(rate / 900), max = Math.min(Math.floor(rate / 65), Math.floor(length / 2));
        let best = 0, bestScore = -Infinity, peakEnergy = 0;
        const correlation = new Float32Array(max + 2);
        for (let i = start; i < start + length; ++i) peakEnergy += samples[i] * samples[i];
        if (peakEnergy / length < 1e-6) throw Error('The source region is silent');
        for (let lag = min; lag <= max; ++lag) {
            let ab = 0, aa = 0, bb = 0;
            for (let i = start; i < start + length - lag; ++i) {
                const a = samples[i], b = samples[i + lag]; ab += a * b; aa += a * a; bb += b * b;
            }
            const score = ab / Math.sqrt(aa * bb + 1e-20);
            correlation[lag] = score;
            if (score > bestScore) { bestScore = score; best = lag; }
        }
        if (bestScore < 0.55) throw Error('No reliable steady pitch found; select a sustained vowel or enter its source Hz');
        // The global autocorrelation maximum can be at 2x/3x/4x the true
        // period. Prefer the first strong local peak to avoid octave errors.
        for (let lag = min + 1; lag < max; ++lag) {
            if (correlation[lag] >= 0.75 && correlation[lag] >= bestScore * 0.88
                && correlation[lag] >= correlation[lag - 1] && correlation[lag] >= correlation[lag + 1]) {
                best = lag; break;
            }
        }
        // Sub-sample parabolic interpolation reduces low-rate pitch-bin error.
        let offset = 0;
        if (best > min && best < max) {
            const left = correlation[best - 1], center = correlation[best], right = correlation[best + 1];
            const curvature = left - 2 * center + right;
            if (curvature < -1e-6) offset = clamp(0.5 * (left - right) / curvature, -0.5, 0.5);
        }
        return rate / (best + offset);
    }

    // Find a short, approximately steady vowel in a longer singing take.
    // This is NOT transcription or lyric alignment: notes still come from MIDI.
    // Limit the scan so long imports cannot stall the browser indefinitely.
    function suggestVowel(samples, rate) {
        if (!samples || !Number.isFinite(rate) || rate < 8000) throw Error('Invalid source recording');
        const duration = samples.length / rate;
        if (duration < 0.26) return null;
        const stop = Math.min(duration - 0.24, 8), step = 0.12;
        let best = null;
        for (let at = 0; at <= stop + 1e-9; at += step) {
            try {
                const first = estimatePitch(samples, rate, at + 0.01, 0, at + 0.105);
                const second = estimatePitch(samples, rate, at + 0.13, 0, at + 0.225);
                if (Math.abs(1200 * Math.log2(first / second)) > 55) continue;
                const start = Math.floor((at + 0.01) * rate), end = Math.floor((at + 0.225) * rate);
                let energy = 0;
                for (let i = start; i < end; ++i) energy += samples[i] ** 2;
                const rms = Math.sqrt(energy / (end - start));
                if (rms < 0.01) continue;
                // Strongly favor a stable sustained section over a louder
                // transient. An early tie is more predictable for the user.
                const quality = rms / (1 + Math.abs(1200 * Math.log2(first / second)) / 20);
                if (!best || quality > best.quality) best = { start: +at.toFixed(3), end: +(at + 0.24).toFixed(3),
                    hz: +(Math.sqrt(first * second)).toFixed(2), quality };
            } catch { /* skip silent, unvoiced or unreliable regions */ }
        }
        return best && { start: best.start, end: best.end, hz: best.hz };
    }

    // Track a consistent voiced-waveform phase across the selected vowel.
    // Using a fixed number of samples per input period drifts against real
    // vibrato; local normalized correlation follows the singer instead.
    function findEpochs(source, rate, sourceHz, options = {}) {
        if (!(sourceHz >= 65 && sourceHz <= 900)) throw Error('Pitch outside supported voiced range');
        const start = Math.floor((options.cropStart || 0) * rate);
        const end = Math.min(source.length, Math.floor((options.cropEnd || source.length / rate) * rate));
        const period = rate / sourceHz;
        if (end - start < 5 * period) throw Error('Select at least five source pitch periods');
        const margin = Math.ceil(period * 1.5), radius = Math.max(2, Math.floor(period * 0.4));
        const search = Math.max(2, Math.floor(period * 0.2));
        let first = start + margin;
        for (let at = first + 1; at < Math.min(end - margin, first + Math.floor(period)); ++at) {
            if (Math.abs(source[at]) > Math.abs(source[first])) first = at;
        }
        const epochs = [first];
        let last = first;
        while (last + period + search < end - margin) {
            const predicted = Math.round(last + period);
            let best = predicted, bestScore = -Infinity;
            for (let candidate = predicted - search; candidate <= predicted + search; ++candidate) {
                let dot = 0, left = 0, right = 0;
                for (let j = -radius; j <= radius; ++j) {
                    const a = source[last + j], b = source[candidate + j];
                    dot += a * b; left += a * a; right += b * b;
                }
                const score = dot / Math.sqrt(left * right + 1e-20) - 0.0002 * Math.abs(candidate - predicted);
                if (score > bestScore) { bestScore = score; best = candidate; }
            }
            if (bestScore < 0.2 || best <= last) break; // noise or no forward progress
            epochs.push(best); last = best;
        }
        return epochs;
    }

    // Period-synchronous overlap-add. Output grain spacing sets the note's F0;
    // source grains stay at their original sampling rate, approximately
    // retaining their spectral envelope. This is NOT a trained voice model.
    function vowelNote(source, rate, sourceHz, noteHz, frames, options = {}) {
        if (!(sourceHz >= 65 && sourceHz <= 900 && noteHz >= 50 && noteHz <= 1400)) throw Error('Pitch outside supported voiced range');
        const start = Math.floor((options.cropStart || 0) * rate);
        const end = Math.min(source.length, Math.floor((options.cropEnd || source.length / rate) * rate));
        const period = rate / sourceHz;
        if (end - start < period * 5) throw Error('Select at least five source pitch periods');
        const strength = clamp(options.correction === undefined ? 1 : options.correction, 0, 1);
        const target = sourceHz * Math.pow(noteHz / sourceHz, strength);
        const output = new Float32Array(frames), weights = new Float32Array(frames);
        const spacing = rate / target;
        // Keep neighbouring grains from cancelling at octave-up shifts. A
        // half-period window at the *target* F0 trades some vowel detail for
        // the requested score pitch; extreme shifts still sound synthetic.
        const grain = Math.max(2, Math.ceil(Math.min(period, spacing * 0.52)));
        // Input epochs follow the singer's changing waveform phase rather
        // than a fixed period. Cache them across notes in renderSteps().
        const epochs = options.epochs || findEpochs(source, rate, sourceHz, options);
        const grainCount = Math.ceil((frames + grain) / spacing);
        for (let outCenter = 0, n = 0; outCenter < frames + grain; outCenter += spacing, ++n) {
            const epochIndex = options.followSource
                ? Math.min(epochs.length - 1, Math.floor(n * epochs.length / Math.max(1, grainCount)))
                : n % epochs.length;
            const inCenter = epochs[epochIndex];
            for (let j = -grain; j <= grain; ++j) {
                const index = Math.round(outCenter + j);
                if (index < 0 || index >= frames) continue;
                const origin = Math.floor(inCenter + j);
                const window = 0.5 + 0.5 * Math.cos(Math.PI * j / grain);
                output[index] += (source[origin] || 0) * window;
                weights[index] += window;
            }
        }
        for (let i = 0; i < frames; ++i) output[i] = weights[i] ? output[i] / weights[i] : 0;
        return output;
    }

    function taggedNote(source, rate, noteHz, frames, tag, settings = {}) {
        const start = tag?.start, end = tag?.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > source.length / rate
            || end - start < 0.075) throw Error('Tag a valid source range of at least 75 ms for every written note');
        const begin = Math.round(start * rate), finish = Math.round(end * rate);
        // Keep short unpitched syllable boundaries from the actual recording.
        // Only the center is pitch-shifted. This is not phoneme alignment.
        const attack = Math.min(Math.round(rate * 0.035), Math.floor((finish - begin) * 0.14));
        const release = Math.min(Math.round(rate * 0.025), Math.floor((finish - begin) * 0.10));
        const coreStart = begin + attack, coreEnd = finish - release;
        const sourceHz = estimatePitch(source, rate, coreStart / rate, tag.hz || 0, coreEnd / rate);
        if (!(sourceHz >= 65 && sourceHz <= 900)) throw Error('Tagged source pitch outside supported voiced range');
        const attackFrames = Math.min(attack, Math.floor(frames * 0.16));
        const releaseFrames = Math.min(release, Math.floor(frames * 0.12));
        const overlap = Math.min(Math.round(rate * 0.006), Math.floor(attackFrames / 2), Math.floor(releaseFrames / 2));
        const coreOffset = attackFrames - overlap, coreEndOut = frames - releaseFrames + overlap;
        const raw = vowelNote(source, rate, sourceHz, noteHz, coreEndOut - coreOffset,
            { ...settings, cropStart: coreStart / rate, cropEnd: coreEnd / rate, followSource: true });
        const out = new Float32Array(frames);
        out.set(raw, coreOffset);
        const interpolate = x => {
            const at = Math.min(finish - 1, Math.max(begin, x)), i = Math.floor(at);
            return (source[i] || 0) * (1 - (at - i)) + (source[Math.min(finish - 1, i + 1)] || 0) * (at - i);
        };
        for (let i = 0; i < attackFrames; ++i) {
            const sample = interpolate(begin + i * attack / Math.max(1, attackFrames));
            const blend = i < coreOffset ? 0 : (i - coreOffset + 1) / (overlap + 1);
            out[i] = sample * (1 - blend) + out[i] * blend;
        }
        for (let i = frames - releaseFrames; i < frames; ++i) {
            const sample = interpolate(coreEnd + (i - (frames - releaseFrames)) * release / Math.max(1, releaseFrames));
            const blend = i < frames - releaseFrames + overlap
                ? (i - (frames - releaseFrames) + 1) / (overlap + 1) : 1;
            out[i] = out[i] * (1 - blend) + sample * blend;
        }
        return { samples: out, sourceHz };
    }

    // Fill source windows in score-note order. This is only an editable first
    // guess; rests in MIDI never consume source audio. No audio transcription.
    function distributeTags(notes, duration) {
        if (!Array.isArray(notes) || !notes.length || !Number.isFinite(duration) || duration <= 0) throw Error('Choose a written track and a source');
        const lengths = notes.map(n => n.endSeconds - n.startSeconds);
        if (lengths.some(x => !Number.isFinite(x) || x <= 0)) throw Error('Invalid written note length');
        const total = lengths.reduce((a, b) => a + b, 0);
        let at = 0;
        return lengths.map((length, i) => {
            const start = at; at += duration * length / total;
            return { start, end: i === lengths.length - 1 ? duration : Math.min(duration, at), hz: 0 };
        });
    }

    function shape(samples, rate, settings = {}, seed = 1) {
        const brightness = clamp(settings.brightness ?? 0.5, 0, 1), warmth = clamp(settings.warmth ?? 0.5, 0, 1);
        const breath = clamp(settings.breathiness ?? 0, 0, 1), resonance = clamp(settings.resonance ?? 0, 0, 1);
        const formant = clamp(settings.formant ?? 1, 0.7, 1.3), strength = clamp(settings.strength ?? 0.7, 0, 1);
        const output = new Float32Array(samples.length);
        // Filter poles move spectral peaks, NOT note timestamps or note F0.
        const cutoff = 240 + 1700 * formant, a = 1 - Math.exp(-2 * Math.PI * cutoff / rate);
        const warmA = 1 - Math.exp(-2 * Math.PI * 380 / rate);
        let low = 0, warm = 0, previousNoise = 0, random = seed >>> 0;
        for (let i = 0; i < samples.length; ++i) {
            const x = samples[i]; low += a * (x - low); warm += warmA * (x - warm);
            random = (Math.imul(1664525, random) + 1013904223) >>> 0;
            const noise = random / 2147483648 - 1, airy = noise - previousNoise; previousNoise = noise;
            output[i] = strength * ((0.72 + warmth * 0.25) * x + warmth * 0.42 * warm
                + brightness * 0.45 * (x - warm) + resonance * 0.32 * (low - warm)
                + breath * 0.022 * airy * Math.min(1, Math.abs(x) * 5));
        }
        return output;
    }

    function noteTrackIndices(score) {
        return score.tracks.flatMap((track, index) => track.notes.length ? [index] : []);
    }

    // Arrangement is explicit: unison repeats a *written melody* with different
    // timbres; it never invents SATB harmony or silently transposes bass notes.
    function arrangeParts(mode, score, parts, recording, melodyTrack, soloVoice = 0) {
        if (!score || !Array.isArray(parts) || parts.length !== 4) throw Error('Set up four voice characters');
        if (mode === 'choir') {
            const tracks = parts.map(part => part.track);
            if (tracks.some(track => !score.tracks[track]?.notes.length) || new Set(tracks).size !== 4) {
                throw Error('Four-part harmony requires four different written-note tracks; arrange the other parts in the score first.');
            }
            return parts.map(part => ({ ...part }));
        }
        if (!score.tracks[melodyTrack]?.notes.length) throw Error('Choose a written melody track for solo or unison');
        // Analysis settings belong to a particular recording. A manual F0 or
        // crop from an earlier take must never silently retarget a new take.
        const retarget = part => part.recording === recording
            ? { ...part, track: melodyTrack }
            : { ...part, track: melodyTrack, recording, sourceHz: 0, cropStart: 0, cropEnd: 0 };
        if (mode === 'solo') {
            if (!Number.isInteger(soloVoice) || soloVoice < 0 || soloVoice >= 4) throw Error('Choose a solo voice character');
            return [{ ...retarget(parts[soloVoice]), mute: false, solo: false }];
        }
        if (mode === 'unison') return parts.map(retarget);
        throw Error('Choose solo, four-part choir, or unison layers');
    }

    function* renderSteps(score, parts, recordings, rate, maxSeconds = 240) {
        if (!score || !Array.isArray(parts) || parts.length < 1 || parts.length > 4) throw Error('Map one to four voice layers');
        if (!Number.isFinite(rate) || rate < 8000 || rate > 96000) throw Error('Unsupported output sample rate');
        if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) throw Error('Invalid render length limit');
        const selected = parts.filter(p => p && !p.mute && (!parts.some(x => x && x.solo) || p.solo));
        if (selected.some(p => !recordings[p.recording])) throw Error('Each active part needs a recording');
        let duration = 0.1;
        for (const part of selected) {
            const notes = score.tracks[part.track]?.notes;
            if (!notes) throw Error('Missing MIDI track for ' + part.name);
            for (const note of notes) {
                if (!Number.isFinite(note.startSeconds) || !Number.isFinite(note.endSeconds)
                    || note.endSeconds < note.startSeconds) throw Error('Invalid note timing');
                duration = Math.max(duration, note.endSeconds + 0.05);
            }
        }
        if (duration > maxSeconds) throw Error(`Score exceeds ${maxSeconds} seconds; no audio was silently truncated. Export a shorter score section.`);
        const frames = Math.ceil(duration * rate);
        const left = new Float32Array(frames), right = new Float32Array(frames), warnings = [];
        const totalNotes = selected.reduce((sum, part) => sum + score.tracks[part.track].notes.length, 0);
        let completedNotes = 0;
        for (let partIndex = 0; partIndex < parts.length; ++partIndex) {
            const part = parts[partIndex]; if (!selected.includes(part)) continue;
            const source = recordings[part.recording], notes = score.tracks[part.track]?.notes;
            if (!notes) throw Error('Missing MIDI track for ' + part.name);
            const automatic = !part.cropStart && !part.cropEnd && source.suggestion;
            const region = automatic ? { ...part, cropStart: source.suggestion.start, cropEnd: source.suggestion.end } : part;
            const sourceHz = part.noteTags ? 0 : estimatePitch(source.samples, rate, region.cropStart || 0, part.sourceHz || 0, region.cropEnd || 0);
            const noteOptions = part.noteTags ? null : { ...region, epochs: findEpochs(source.samples, rate, sourceHz, region) };
            if (part.noteTags && part.noteTags.length !== notes.length) throw Error(part.name + ': source tags do not match written note count');
            const pan = clamp(part.pan ?? 0, -1, 1), volume = clamp(part.volume ?? 0.7, 0, 1);
            const gainL = Math.cos((pan + 1) * Math.PI / 4) * volume, gainR = Math.sin((pan + 1) * Math.PI / 4) * volume;
            for (let noteIndex = 0; noteIndex < notes.length; ++noteIndex) {
                const note = notes[noteIndex];
                let targetPitch;
                try { targetPitch = outputPitch(note, part, noteIndex); }
                catch (err) { throw Error(part.name + ' note ' + (noteIndex + 1) + ': ' + err.message); }
                const noteHz = hz(targetPitch);
                if (targetPitch !== note.pitch) warnings.push(part.name + ' note ' + (noteIndex + 1)
                    + ': explicit pitch edit ' + noteName(note.pitch) + ' → ' + noteName(targetPitch) + ' (original MIDI unchanged).');
                if ((part.correction ?? 1) < 1) warnings.push(part.name + ': correction below 100% does not preserve the written pitch.');
                const start = Math.round(note.startSeconds * rate), stop = Math.min(frames, Math.round(note.endSeconds * rate));
                if (start >= frames || stop <= start) continue;
                let tagged = null;
                if (part.noteTags) {
                    try { tagged = taggedNote(source.samples, rate, noteHz, stop - start, part.noteTags[noteIndex], part); }
                    catch (err) { throw Error(part.name + ' note ' + (noteIndex + 1) + ': ' + err.message); }
                }
                const detectedHz = tagged ? tagged.sourceHz : sourceHz, ratio = noteHz / detectedHz;
                if (ratio > 1.7 || ratio < 0.59) warnings.push(part.name + ' note ' + targetPitch + ': extreme source-to-score pitch shift; use another recording in this register.');
                if (tagged) {
                    const sourceDuration = part.noteTags[noteIndex].end - part.noteTags[noteIndex].start;
                    const stretch = (note.endSeconds - note.startSeconds) / sourceDuration;
                    if (stretch > 2.5 || stretch < 0.4) warnings.push(part.name + ' note ' + (noteIndex + 1)
                        + ': extreme time stretch (' + stretch.toFixed(1) + '×); adjust this source tag.');
                }
                const raw = tagged ? tagged.samples : vowelNote(source.samples, rate, sourceHz, noteHz, stop - start, noteOptions);
                const voiced = shape(raw, rate, part, (partIndex + 1) * 941 + (part.variation ? note.tick : 0));
                const fade = Math.max(1, Math.round(rate * 0.012));
                for (let i = 0; i < voiced.length; ++i) {
                    const envelope = Math.min(1, (i + 1) / fade, (voiced.length - i) / fade);
                    const sample = voiced[i] * envelope * note.velocity / 100;
                    left[start + i] += sample * gainL; right[start + i] += sample * gainR;
                }
                yield { completed: ++completedNotes, total: totalNotes };
            }
        }
        let peak = 0; for (let i = 0; i < frames; ++i) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        const scale = peak > 0.97 ? 0.97 / peak : 1;
        if (scale !== 1) for (let i = 0; i < frames; ++i) { left[i] *= scale; right[i] *= scale; }
        return { left, right, rate, warnings: [...new Set(warnings)], peak: peak * scale };
    }

    function render(score, parts, recordings, rate, maxSeconds = 240) {
        const steps = renderSteps(score, parts, recordings, rate, maxSeconds);
        let step = steps.next();
        while (!step.done) step = steps.next();
        return step.value;
    }

    async function renderAsync(score, parts, recordings, rate, maxSeconds = 240, onProgress = () => {}) {
        const steps = renderSteps(score, parts, recordings, rate, maxSeconds);
        let step = steps.next(), sinceYield = Date.now(), latest;
        while (!step.done) {
            latest = step.value;
            if (Date.now() - sinceYield > 40) {
                onProgress(latest);
                await new Promise(resolve => setTimeout(resolve, 0));
                sinceYield = Date.now();
            }
            step = steps.next();
        }
        if (latest) onProgress(latest);
        return step.value;
    }

    function wav(channels, rate) {
        const frames = channels[0].length, count = channels.length, output = new ArrayBuffer(44 + frames * count * 2), view = new DataView(output);
        const label = (at, str) => { for (let i = 0; i < str.length; ++i) view.setUint8(at + i, str.charCodeAt(i)); };
        label(0, 'RIFF'); view.setUint32(4, output.byteLength - 8, true); label(8, 'WAVE'); label(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate * count * 2, true); view.setUint16(32, count * 2, true);
        view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, frames * count * 2, true);
        let at = 44;
        for (let i = 0; i < frames; ++i) for (const ch of channels) { view.setInt16(at, Math.round(clamp(ch[i] || 0, -1, 1) * 32767), true); at += 2; }
        return output;
    }
    return { parseMidi, noteTrackIndices, arrangeParts, estimatePitch, suggestVowel, vowelNote, taggedNote, distributeTags,
        shape, render, renderAsync, wav, defaults, hz, noteName, keySemitones, inKey, outputPitch };
});