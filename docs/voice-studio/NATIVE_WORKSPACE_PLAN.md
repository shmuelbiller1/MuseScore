# Native Voice Studio workspace — implementation contract

**Status: design and acceptance plan, not an implemented native instrument.** The existing `share/choir-studio` HTML/JavaScript page is an offline MIDI-driven experiment. It does not edit a MuseScore score or render a waveform beneath the native notation. Do not relabel that sidecar as this feature.

## What the user is asking for

- Add an optional **Voice Studio** score workspace *inside MuseScore*, without changing or removing the normal Score page, its toolbars, palettes, keyboard shortcuts, or playback behavior.
- Begin from a **separate editable copy of the current score**. A canceled copy operation changes nothing. Edits to written notes or attached recordings in Voice Studio must not change the original file. Show the active copy's name and path prominently.
- Reuse MuseScore's real notation view and notation-editing commands, not a screenshot, re-engraved MIDI approximation, browser clone, or a second untracked score model.
- Show an **audio waveform lane under/between the visible notation systems** and aligned in score time. When notation wraps onto another system/page, the corresponding waveform portion follows it. Do not confuse source-recording time with score time.
- Import or record an unchanged original voice; select a portion of its waveform, attach that source slice to a written note, move and stretch it in score time, and audition both the raw slice and the processed note. Keep note durations, rests, independent part rhythms and score pitches authoritative unless the user explicitly edits a note or transposes the arrangement.
- Offer independent Soprano/Alto/Tenor/Bass written parts: Bass-only requires only Bass's written line; allow any nonempty subset and all four. Keep solo and unison explicitly distinct from written harmony. A voice-character/timbre change cannot secretly change pitch.
- Support per-note output pitch and same-mode arrangement transposition (e.g. A minor to G minor); show written and output pitches. Allow self-contained save/reopen of the copied score and voice session, plus separate processed WAV export. Never silently substitute an unverified model or network service.

## Existing extension points and important boundaries

| Area | Existing code | Native workspace requirement |
| --- | --- | --- |
| Editable score view | `src/appshell/qml/MuseScore/AppShell/NotationPage/NotationPage.qml` hosts `MuseScore.NotationScene/NotationView.qml`, toolbars, panels and status bar. `WindowContent.qml` registers dock pages. | Reuse this native notation tree with distinct page/dock identity; do not duplicate toolbar/panel object names or turn the Score page into Voice Studio. `NotationReviewPage.qml` is view-only and cannot satisfy editable-copy behavior. |
| Page routing | `src/appshell/appshellmodule.cpp` registers notation URIs; `src/project/notationpageinfo.cpp` and `src/appshell/qml/MuseScore/AppShell/maintoolbarmodel.cpp` control Score tab selection. | Register a separate opt-in Voice Studio route/tab only after the view and copy transaction work. Verify switching views does not change score context, shortcuts or dock layout. |
| Safe score copy | `project::ISaveProjectScenario::saveProject(SaveMode::SaveAs)` and the existing Save As UI. `SaveMode::SaveCopy` exists but its effect on the active session must not be assumed. | Perform an explicit user-approved copy operation **before** entering editable Voice Studio; only open the workspace after successful save/open of a distinct path. Reject original-path overwrite, handle unsaved/cloud/dirty scores and cancellation, and test original bytes remain unchanged. Do not merely switch views on the same `IProjectSession`. |
| Browser prototype | `share/choir-studio/{choir.js,studio.js,project.js}` performs tagged note rendering, selections and `.choir.json` persistence. | Use its tested behavior as an algorithm/UX reference, not a claim of native score integration. A native Qt/QML page cannot call these browser globals directly. Port or bridge processing with a deliberately licensed offline boundary and test equivalent pitch/timing. |
| Timing | Browser prototype derives notes from exported MIDI. Native score data is exposed through notation/engraving/playback modules. | Use native tick/tempo/selection data and layout coordinates for the visible staff lane; resolve repeats, tempo changes, tuplets, tied notes and score-system/page wrapping explicitly. Never equate one rendered pixel with one fixed millisecond or invent Bass notes from Soprano. |

## Safe delivery sequence

1. **Copy transaction and isolated view:** implement a new native route and an explicit “Create Voice Studio copy…” action. Reuse the existing `NotationView` and score-editing commands with separately named dock panels. The original path/content must remain unchanged. Until the audio lane works, keep the route experimental and do not present it as a completed choir editor.
2. **Score-attached audio lane:** build native waveform loading and rendering from an unchanged local capture/WAV. Add per-system score-time layout, note selection, source-range selection and draggable left/right handles; provide keyboard/numeric alternatives. Persist source time, written target note identity, score-time offset and stretch separately so a layout change never corrupts the mapping.
3. **Audition and rendering:** add raw-slice preview and isolated pitched-note preview. Integrate offline DSP without changing the existing playback engine or original score. Gate full mix/export on complete tags when tagged mode is on; respect 1–4 included written parts, rests, explicit pitch edits and global key shift.
4. **Persistence and release gate:** embed or attach recordings and clip metadata to the **copied** score with migration/version checks; export WAV separately. Verify Windows offline first launch, save/reopen identity, timing and pitch tests, browser-prototype parity, source licence, and real listening tests before calling the output natural.

## Acceptance cases that must fail if the feature is only a visual mock

- With an original `.mscz` open, create a Voice Studio copy, change a written Bass note and a waveform tag, save, close and reopen both files: the original file hash and notes are unchanged; the copy contains both edits.
- On a multi-page score with tempo changes and a system break, a selected audio clip's waveform follows the corresponding written note before and after relayout; its original source time and original audio bytes stay unchanged.
- Bass-only works from one Bass line without inventing S/A/T. Alto+Bass, any other subset, all four, explicit solo and unison remain separate and produce the expected written pitches, onsets and rests.
- Dragging a source slice or its stretch handle changes only that slice's mapping; target pitch stays written unless an explicit per-note/key control is used. Both original and processed note previews are independently playable.
- Canceling the copy dialog, opening a missing/malformed recording, or exceeding resource limits leaves the original score unchanged and shows an actionable error.
- All native UI and audio operations remain offline from first Windows launch. A green Node sidecar suite alone is **not** a native view/build/portable validation result.
