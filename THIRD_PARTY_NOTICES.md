# Third-Party Notices

This project uses third-party open-source packages through npm. The lockfile records package versions and license metadata.

## MuPDF.js

Lingadoo depends on `mupdf`, the JavaScript/WebAssembly package for MuPDF.js from Artifex Software, Inc.

- Package: `mupdf`
- License: `AGPL-3.0-or-later` or commercial license from Artifex
- Homepage: https://mupdf.com/
- Source/releases: https://mupdf.com/releases
- Licensing information: https://artifex.com/licensing

Because MuPDF.js is AGPL/commercial licensed, this repository is distributed under `AGPL-3.0-or-later`.

## Fonts

The app includes Noto Sans font files under `public/fonts/` for browser-side PDF export. Noto fonts are distributed by Google under the SIL Open Font License 1.1. The bundled `NotoSansMerged-*` files are derived font files used for PDF export coverage.

- License text: [licenses/SIL-OFL-1.1.txt](licenses/SIL-OFL-1.1.txt)
- Upstream project: https://fonts.google.com/noto
- License reference: https://openfontlicense.org/

The app does not load Google Fonts from the network at runtime.

The app also uses standard fonts bundled with `pdfjs-dist` during local preview rendering. See `node_modules/pdfjs-dist/standard_fonts/LICENSE_LIBERATION` after installing dependencies.
