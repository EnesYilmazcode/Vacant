# fonts

`geist-latin-wght.woff2` is **Geist**, the variable-weight (100–900) latin
subset, served from this repository so the app never asks another company for
a font (privacy.html says so).

- Typeface: Geist, by Vercel and the Geist Project Authors.
- Licence: SIL Open Font License 1.1, <https://openfontlicense.org>.
- Source: Fontsource's build of the Google Fonts release,
  `https://cdn.jsdelivr.net/fontsource/fonts/geist:vf@5/latin-wght-normal.woff2`,
  fetched 2026-11-10, 29,400 bytes.

To update it, fetch the same URL, replace the file, and re-measure the shell
figure in the `sw.js` header (the file is in `SHELL_ASSETS`).
