# Historical notation terminology: working catalog

A working musician-facing search/interpretation backlog for European concert and choral scores (roughly 1850–1950), **not** a claim that every row is implemented. Meanings vary by composer, date, instrument and surrounding words. Retain every source spelling on the score. `T` = existing typed playback in Studio source; `N` = new typed template in this fork (runtime not yet verified); `P` = partial playback only; `V` = visual/instruction needs explicit interpretation. Searchable software aliases are a **strict subset** of this catalog; similar terms are not necessarily synonyms. Numerical defaults for N are illustrative and editable, never an interpretation of the manuscript without the musician.

### Tempo, change and restoration

| Wording / attested variants (language) | Meaning; distinctness | Current interpretation |
| --- | --- | --- |
| Grave (It.) | Solemn, very slow; weight and pace | T named preset; tune BPM |
| Larghissimo, Largo, Larghetto (It.) | Very broad / broad / somewhat broad; differing degrees | T Largo/Larghetto; other V |
| Lento, Lentissimo (It.) | Slow / very slow | T Lento; other V |
| Adagio, Adagietto (It.) | At ease / less slow than adagio, historical usages vary | T Adagio; other V |
| Andante, Andantino (It.) | Walking / debated diminutive, may not always mean faster | T both editable presets |
| Moderato (It.) | Moderate, or a qualifier of a named pace | T named preset; compound V |
| Allegretto, Allegro, Allegrissimo (It.) | Lightly quick / lively / very quick | T first two; other V |
| Vivace, Vivacissimo, Vivo (It.) | Lively / very lively / animated | T Vivace; other V |
| Presto, Prestissimo (It.) | Fast / extremely fast | T named presets |
| Tempo giusto (It.) | Strict/appropriate prevailing tempo, not a metronome number | V |
| Tempo comodo (It.) | Comfortable pace | V |
| Tempo di marcia, alla marcia (It.) | March character; rhythm and accent as well as pace | V; do not infer BPM |
| Tempo di valzer, alla breve (It.) | Waltz character / cut-time feel; meter-dependent | Meter T, expression V |
| Langsam, sehr langsam (De.) | Slow / very slow; not Lento at a fixed BPM | N Langsam editable 60 BPM example; sehr langsam V |
| Mäßig / Maessig, gemächlich / gemaechlich (De.) | Moderate / leisurely | V; choose BPM |
| Bewegt, lebhaft, schnell, sehr schnell (De.) | In motion / lively / fast / very fast | V; choose BPM |
| Nicht zu schnell, nicht sehr langsam (De.) | Not too fast / not very slow; negative qualifiers | Nicht sehr langsam N neutral 100% ratio until configured; nicht zu schnell V |
| Con moto, con movimento (It.) | With motion, a character/pace qualifier | Con moto N neutral 100% ratio until configured; con movimento V; do not auto-speed up |
| Meno mosso, meno moto (It.) | Less motion, an **immediate** new pace | N 90% starting point for meno mosso only |
| Più mosso / piu mosso (It.) | More motion, an **immediate** new pace | N 110% starting point |
| Langsamer, schneller (De.) | Slower / faster **now** | N 90%/110% starting points |
| Etwas langsamer, etwas schneller (De.) | Somewhat slower/faster; degree qualified | V; don't alias unqualified cell as exact |
| Più lento, meno vivo; doppio movimento (It.) | More slow / less lively / doubled movement (could refer to meter) | V, context needed |
| L'istesso tempo / lo stesso tempo (It.) | Same underlying pace across change of meter | V; not a tempo primo |
| A tempo / a t. (It.) | Return after local deviation | T existing restore; depends on ramp context |
| Tempo primo / tempo I (It.) | First tempo of movement, not merely prior steady tempo | T existing restore |
| Come prima (It.), wie zuvor (De.) | As before; can refer to manner, not solely BPM | V; resolve antecedent |
| Ritardando / rit. / ritard. (It.) | Gradually slowing | T tempo curve, P for broader expression |
| Rallentando / rall. / rallent. (It.) | Slowing and broadening; not exact ritardando synonym | T tempo curve, P for breadth |
| Ritenuto / riten. / rit. (It.) | Held back, often more sudden than ritardando; `rit.` ambiguous | V until clarified; do NOT alias `rit.` to both |
| Lentando / lent. (It.) | Becoming slower | T master palette curve |
| Allargando / allarg. (It.) | Broadening, commonly slower and fuller | T tempo curve, P for fullness |
| Calando (It.) | Dying away, softer/slower | T tempo curve, P dynamic |
| Morendo, smorzando / smorz. (It.) | Dying away / extinguishing, often quieter/slower | T tempo curve, P dynamic |
| Sostenuto / sost. (It.) | Sustained/held back; phrasing as well as pace | T tempo curve, P phrasing |
| Slentando (It.) | Becoming slower | V; inspect manuscript |
| Accelerando / accel. / acc. (It.) | Gradually speeding up | T tempo curve |
| Affrettando (It.) | Hurrying, sometimes faster gradually | V; not always accelerando |
| Stringendo / string. (It.) | Pressing ahead; urgency as well as speed | T tempo curve, P urgency |
| Precipitando (It.) | Rushing precipitously | T tempo curve, P urgency |
| Allmählich schneller / allmaehlich schneller (De.) | Gradually faster, not `Schneller` immediately | T alias for accelerando |
| Allmählich langsamer / allmaehlich langsamer (De.) | Gradually slower, not `Langsamer` immediately | T alias for ritardando |
| Nach und nach schneller, langsamer werdend (De.) | Little by little faster / becoming slower | V; qualifier must be confirmed |
| Subito / subito più mosso (It.) | Suddenly / suddenly more movement | V as compound; use immediate change if specified |
| Rubato / tempo rubato (It.) | Flexible timing, not a constant tempo ratio | V; hand-authored automation needed |
| Ad libitum / ad lib. (Lat.) | At discretion, may refer to timing/part/orchestration | V; scope needed |

### Degrees, compound phrases and expression

| Wording / variants | Meaning and classification | Current interpretation |
| --- | --- | --- |
| Poco, un poco, pochissimo (It.) | Little / a little / very little; modifies another instruction | V alone; `Poco rit.` N editable 90% arrival |
| Molto, di molto, assai (It.) | Much / by much / very; different grammatical scope | `Di molto` and `Con molto` expression cells V alone; `Molto rit.` N editable 60% arrival |
| Non troppo, ma non troppo (It.) | Not too much; caps another instruction | V; never multiply BPM blindly |
| Sempre (It.) | Continue same instruction until changed | V; needs scope |
| Più, meno (It.) | More / less; what property? | V alone |
| Con brio (It.) | With vivacity/energy, often not a literal acceleration | V or explicit accent/dynamics |
| Con forza, con tutta forza (It.) | With force; emphasis, not equivalent to forte or sfz | N custom dynamic `Con forza` visual until user sets velocity (native automation + legacy MIDI); con tutta forza V |
| Con fuoco (It.) | With fire/ardor; character | V; not a tempo number |
| Con spirito, spiritoso (It.) | With spirit / spirited | V |
| Con anima, animato (It.) | With soul / animated | V, context |
| Con espressione / espressivo / espr. (It.) | Expressively; phrasing/dynamics/timing | V; no single quantitative parameter |
| Cantabile (It.) | Singing style, connected phrasing | V; slur/legato may be added independently |
| Dolce / dolcissimo (It.) | Sweetly / very sweetly | V, sound-source dependent |
| Grazioso (It.) | Gracefully | V |
| Maestoso (It.) | Majestically | V; may imply broadness, not fixed BPM |
| Energico, marcato (It.) | Energetically / marked | V if words; T accent/marcato articulation when explicitly chosen |
| Appassionato (It.) | Passionately | V |
| Tranquillo, placido (It.) | Calmly, peacefully | V |
| Misterioso, lugubre (It.) | Mysteriously / mournfully | V |
| Pesante, leggiero / leggero (It.) | Heavy / light; attack and phrase | V; not universally loud/soft |
| Quasi, come (It.) | As if / like; governs following phrase | V |
| Nicht, sehr, etwas, immer (De.) | Not / very / somewhat / always; grammatical modifiers | V without operand |
| Mit Ausdruck, ausdrucksvoll (De.) | With expression / expressively | V |
| Mit Kraft, kräftig / kraeftig (De.) | With strength / forcefully | V; explicit dynamics as chosen |
| Ruhig, innig, zart (De.) | Calmly / inwardly / tenderly | V |
| Feierlich, ernst, leidenschaftlich (De.) | Solemnly / seriously / passionately | V |
| Con mosso (unusual), con molto (incomplete) | Preserve unusual exact wording; determine whether transcription or idiom | N neutral 100% tempo template for Con mosso until manually configured; Con molto V expression only |

### Dynamics, articulation, duration and breath

| Wording / variants | Meaning | Current interpretation |
| --- | --- | --- |
| ppp, pp, p, mp, mf, f, ff, fff | Notated dynamic levels | T dynamics; sound-profile response varies |
| Sforzando / sfz / sf (It.) | Sudden strong emphasis | T existing dynamic, profile-dependent |
| Sforzato / sffz / rfz / rinforzando (It.) | Reinforced accent variants; not always identical | T variants where listed in `palettecreator.cpp`; verify each |
| Forte-piano / fp; sforzando-piano / sfp | Strong attack immediately softer | T some dynamic transitions; check automation timing |
| Crescendo / cresc. (It.) | Gradually louder | T hairpin/line; configure length/end level |
| Decrescendo / decresc.; diminuendo / dim. (It.) | Gradually softer; differing connotations | T hairpin/line, P for expressive shading |
| Subito piano / subito forte / sub. p / sub. f | Immediate softer/louder | Explicit T dynamic; `subito` itself not a sound event |
| Staccato, staccatissimo (It.) | Detached / very detached, not necessarily accented | T articulations; note-duration profiles vary |
| Tenuto (It.) | Hold full duration / gentle emphasis depending context | T articulation, instrument-dependent |
| Legato / molto legato (It.) | Connected / very connected | T slur/articulation where supported; separate from written tie |
| Portato / mezzo staccato (It.) | Carried/detached-within-slur; not plain staccato | P if appropriate articulation/slur combination tested |
| Marcato, martellato (It.) | Marked / hammered | T marcato symbol, P attack profiles |
| Accent / >, marcato / ^ | Accented / more strongly marked | T specific symbols; not interchangeable |
| Slur, phrase mark, tie | Connected notes / phrase / sustain *same pitch* | T different score types; do not substitute |
| Fermata / corona / hold (It.) | Hold beyond written value; contextual duration | T stretch property; verify shared timing |
| Caesura / //, general pause / G.P., lunga pausa | Cut or collective pause; variable length | P existing breath/pause path; musician sets duration |
| Breath mark / comma, Atempause (De.) | Breath/pause, usually shorter than caesura | P existing breath mark |
| Senza misura, senza tempo | Without strict meter/tempo; flexible time | V; requires manual automation |

### Ornaments, repeats, techniques and timbre

| Wording / variants | Meaning | Current interpretation |
| --- | --- | --- |
| Trillo / tr. (It.), Triller (De.) | Trill, variable historical execution | T trill/ornament renderer; intervals/starts must be checked |
| Mordente, upper/lower mordent (It.) | Brief neighbor-note alternation, direction convention varies | P ornament renderer; confirm historical direction |
| Gruppetto / turn, inverted turn | Neighbor-note turn | P ornament renderer; timing/accidentals contextual |
| Appoggiatura / Vorschlag (De.) | Leaning grace note, can take time from principal | P grace renderer; context matters |
| Acciaccatura (It.) | Crushed grace note, often before beat | P grace renderer |
| Arpeggio / arpegg. (It.) | Broken chord | P symbol playback dependent on profile/instrument |
| Tremolo / trem. (It.) | Rapid reiteration, measured vs unmeasured distinct | P existing tremolo renderer, inspect pattern |
| Glissando, portamento (It.) | Continuous slide vs expressive pitch glide, not identical | P glissando variants; instrument dependent |
| Pizzicato / pizz.; arco (It.) | Plucked strings / return to bow | T playing-technique/resource mapping, sound dependent |
| Con sordino / sord.; senza sordino (It.) | With mute / without mute; which instrument? | P sound presets if supplied; never use generic volume only |
| Sul ponticello, sul tasto (It.) | Bow near bridge / fingerboard | P only with appropriate instrument samples |
| Flautando (It.) | Flute-like bowed tone | V/P depending library |
| Divisi / div., unisono, a 2 | Split players / unison / two players | Engraving T, ensemble routing/voicing unverified |
| Solo, tutti | One player / all players | V/P sound assignment; not simply velocity |
| D.C. / da capo; D.S. / dal segno | Go to beginning / sign | T Repeats & jumps with correct sign/target |
| Fine, al Fine; Coda, al Coda, to Coda | End / transition point / go to coda | T repeat mapping; test multi-pass |
| 1., 2. volta / prima, seconda volta | First/second ending | T volta/repeat list |
| Simile, segue, attacca | Continue similarly / follow / continue immediately | V unless structural playback timing explicitly configured |

## Search policy / next implementation gate

* The catalog is **not** wired wholesale to search. Exact printed compound words with unknown meaning do not inherit unqualified playback behavior. Bind aliases to typed score-element identities, not simply string-substring matching; distinguish `rit.` (ambiguous ritardando/ritenuto), `langsamer` (immediate) and `langsamer werdend` (gradual). Normalize Unicode accents and accept conventional ASCII transliteration separately.
* Before promoting any entry to `T/N`, measure automation curve values, emitted note durations/velocities and rendered audio across 18 parts in a built offline app. A part with a symbol but no sound-profile support is still partial.
* Phrase-specific choices should be reviewable as explicit text + factor/BPM + scope + user provenance. Do not infer numerical values for `con forza`, `rubato`, `nicht sehr langsam`, `di molto` or `con moto` without context.
