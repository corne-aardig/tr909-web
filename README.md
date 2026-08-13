# TR-909 Web

A web tribute to the Roland TR-909 Rhythm Composer: an 11-voice drum machine with a
16-step hardware-style sequencer, 8 pattern slots, a sequenceable accent lane, and
working knobs (tune, decay, tone, snappy, attack, levels) driven by Web Audio DSP.

Live on the drumcomputer Webflow site; embedded via jsDelivr:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/corne-aardig/tr909-web@1.0.1/tr909.css">
<div id="tr909-root"></div>
<script src="https://cdn.jsdelivr.net/gh/corne-aardig/tr909-web@1.0.1/tr909.js" defer></script>
```

Local dev: serve this folder over HTTP (`python3 -m http.server`) and open `index.html`.

## Credits & license

- Drum samples: **"TR-909 Rhythm Composer Samples"** by Rob Roy / Rob Roy Recordings,
  Minneapolis (1995). Distributed free by its author; may not be sold. `samples/`
  contains an unmodified subset with original filenames.
- This project is not affiliated with or endorsed by Roland Corporation.
  TR-909 is a trademark of Roland Corporation.
- Code: MIT.
