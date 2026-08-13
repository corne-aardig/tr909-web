# TR-909 Web (drumcomputer)

A digital web recreation of the Roland TR-909 drum machine, embedded on the "drumcomputer" Webflow site. The sequencer workflow mimics the physical hardware.

## Language

**Voice**:
One of the drum instruments on the panel (Bass Drum, Snare Drum, Low/Mid/Hi Tom, Rim, Clap, Closed Hi-Hat, Open Hi-Hat, Crash, Ride).
_Avoid_: track, channel, sound, instrument

**Source Sample**:
The single WAV file a Voice plays, chosen once from the Rob Roy '95 set.
_Avoid_: variant, sound file

**Instrument Knob**:
A continuous panel knob (Tune, Attack, Decay, Tone, Snappy) that reshapes the Voice's Source Sample in real time via audio processing.
_Avoid_: parameter, setting

**Level Knob**:
A continuous knob that scales a Voice's playback gain.

**Step**:
One of the 16 positions in a Pattern, played as 16th notes.

**Step Key**:
One of the 16 physical-style buttons; it always toggles a Step of the Selected Voice, never anything else.
_Avoid_: pad, cell

**Pattern**:
The full 16-step rhythm across all Voices; edits always land in the active Pattern.
_Avoid_: preset, beat, loop

**Pattern Slot**:
One of the 8 containers (A–H) holding a Pattern within the current browser session; exactly one Slot is active at a time, and nothing persists across a page reload.
_Avoid_: bank, memory

**Selected Voice**:
The single Voice whose Steps the Step Keys currently show and edit, chosen by clicking a Voice label under a Step Key.
_Avoid_: active track, current channel

**Accent Lane**:
A sequenceable lane (selected via the ACCENT label, like a 12th Voice) whose marked Steps make every Voice on that Step hit harder; the Accent knob sets the boost amount.
_Avoid_: accent track, velocity

**Legend**:
The printed text under a Step Key; the 11 Voice names are clickable selectors, the remaining five (SHUFF, LED-ON, ACC-1, ACC-2, ENTER) are decoration.

## Relationships

- A **Voice** has exactly one **Source Sample**
- An **Instrument Knob** reshapes its **Voice**'s audio in real time (repitch, envelope, filter)
- A **Level Knob** affects gain only
- A **Pattern** holds 16 **Steps** per **Voice** (definition pending — see ambiguities)

## Example dialogue

> **Dev:** "When the user turns the Bass Drum **Decay** knob, do we load a different file?"
> **Domain expert:** "No — every **Voice** has one **Source Sample**; the knob shortens its tail with a gain envelope at play time."

## Flagged ambiguities

- OPTIONS SELECT row — resolved: HELP and ABOUT open modals (ABOUT carries the Rob Roy sample-set credit and a "not affiliated with Roland" disclaimer); PANEL and OPTION are decorative. The "Roland" wordmark is dropped from the header for trademark safety; branding is "TR-909 RHYTHM COMPOSER".
- Mobile — resolved: the chassis scales to fit the viewport (transform scale); no responsive re-layout.
- Persistence — resolved: session-only; a reload resets to the demo Pattern in Slot A.
- TEMPO knob's "SHUFFLE" sub-label — resolved: decoration. The knob sets BPM only (60–200, default 120), shown as a readout on the display. VOLUME knob is master gain, session default ~80%. No shuffle/swing in v1.

- "Variant" (knob-position recordings in the Rob Roy set) was considered as the knob mechanism — resolved: knobs use real-time processing on a single **Source Sample**; the variant files stay in the repo only as a future upgrade path. Attack/Tone/Snappy are approximations of the hardware circuit.
- Hi-Hat/Cymbal knob depth — resolved: design as drawn wins. One shared Level for closed+open hat, one shared Level for crash+ride; no hat decay or cymbal tune knobs in v1.
- A–H buttons — resolved: **Pattern Slots**. The Figma mockup lights both A and B, which wrongly suggests two active Patterns; the build lights exactly one. Display shows the active Slot; the "KIT: 909 Basic Kit" line is static text. Knob settings are global, not per-Pattern. Live Slot switching lands at the end of the current bar. Pattern chaining (songs) is out of scope for v1.
- Step-key secondary labels — resolved: they are the **Legend**; Voice names select, the five non-voice labels are decorative in v1.
