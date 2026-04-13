# Self-Hosted Fonts

This directory holds locally-hosted web font files for the COHO Analytics
platform. The fonts are **not committed** to the repository because their
license (SIL Open Font License 1.1) allows redistribution but the binary
`.woff2` files would bloat the repository unnecessarily.

## Required fonts

| Family | Weights | Directory |
|--------|---------|-----------|
| [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) | 400, 500, 600, 700, 800, 400italic | `plus-jakarta-sans/` |
| [DM Mono](https://fonts.google.com/specimen/DM+Mono) | 400, 500 | `dm-mono/` |

## Downloading the fonts

Run the provided helper script from the repository root:

```bash
bash scripts/download-fonts.sh
```

The script fetches `.woff2` files from Google Fonts and places them in the
correct subdirectories under `assets/fonts/`.

## Fallback behaviour

`css/site-theme.css` declares `@font-face` blocks that load these files with
`font-display: swap`. If the files are absent the browser falls back to the
system font stack defined in `--font-sans` and `--font-mono` tokens:

```
system-ui, -apple-system, 'Segoe UI', sans-serif
'Cascadia Code', 'Fira Code', 'Consolas', monospace
```

Pages are therefore fully functional without the local font files; they simply
render with the OS default sans-serif and monospace typefaces.
