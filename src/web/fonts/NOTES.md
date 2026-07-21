# Commissioner (subset) — self-hosted webfont for variant A

**Family:** Commissioner — a low-contrast humanist variable sans by Kostas
Bartsokas, chosen for variant A ("Airbnb-warm") because it is warm and modern
AND has first-class **Greek** coverage (the designer is Greek; the whole UI is
Greek). It was already named in the original `index.html` font stack.

**Licence:** SIL Open Font License 1.1 — see `OFL.txt`. Redistribution in a
webfont, including subsetting, is permitted; the licence file is retained here as
required.

**Not an npm dependency.** It is a committed static asset (like the PWA icons),
so the runtime dependency set stays `{react, react-dom, lucide-react}`. See ADR
in `DECISIONS.md`.

## How this file was produced (reproducible)

1. Fetched the upstream variable font from `google/fonts`:
   `ofl/commissioner/Commissioner[FLAR,VOLM,slnt,wght].ttf`
2. Pinned the decorative/slant axes to their defaults, keeping only `wght`
   (100–900) via `fontTools.varLib.instancer`.
3. Subset to the glyphs the Greek UI renders and compressed to woff2:
   `python3 -m fontTools.subset Commissioner-wght.ttf \
      --unicodes=U+0020-007E,U+00A0-00FF,U+0370-03FF,U+1F00-1FFF,U+2010-2027,U+20AC,U+2265 \
      --layout-features=kern,liga,calt,locl,mark,mkmk --flavor=woff2 \
      --output-file=Commissioner-subset.woff2`

Result: 40.5 KB, one file covering every weight, full monotonic Greek + Latin +
the punctuation the app and reports use (· « » – — • … € ≥).

## How it is consumed

Embedded as a `data:` URI `@font-face` in BOTH `src/web/index.html` (the app
shell, served verbatim — no CSP blocks it) and `src/report/html.ts` (the report
must be a self-contained email attachment). This committed file is the
source of truth from which those base64 blocks are regenerated; it is not served
over a route, so no server/behaviour change was needed.
