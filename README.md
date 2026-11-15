# Michael Yoto Maker — sticker sheet studio

A fast, Photoshop-ish designer for **Yoto card / CR80 stickers**, running entirely
in the browser. Lay out artwork for **9 cards on one US Letter or A4 sheet**, then
export a print-ready, exact-size PDF.

**▶ Live app: <https://michaeljdraper22-sketch.github.io/yoto-card-editor/>**

No build step, no npm, no accounts, no uploads. Everything — editing, autosave,
PDF writing — happens locally in the page. Photos you import never leave your
machine.

## What it does

- **Exact physical output.** Cards are ISO **CR80: 53.98 × 85.6 mm**, 3.18 mm
  corner radius — the size of a real Yoto card. Export a PDF at 300 DPI, print at
  100% / actual size, cut along the rounded shape.
- **9-up sheets.** US Letter or A4, 3 × 3 grid, 3 mm gutters, 8.3 mm from the
  paper edge (safe for normal non-printable margins). Nine is the physical
  maximum for this card size on Letter.
- **Real layer editing.** Text (font, size, weight, alignment, colour, outline,
  box, shadow, rotation), images (fill / fit / crop / pan / zoom), rectangles and
  ellipses. Reorder layers front-to-back like Photoshop.
- **Per-card clipping.** Artwork is clipped to its own card, so a wide photo or a
  rotated text box can never bleed into a neighbour's design. Selection handles
  still extend past the card while you're editing it.
- **Print-clean exports.** Editing outlines are screen-only; they are never drawn
  into the PDF or PNG. Optional light-grey cut guides can be turned on.
- **Fast to live in.** Undo/redo (80 steps), autosave, `.mym` project
  save/open, drag-and-drop, right-click menu, zoom/pan, single-card export.

## Printing

1. **Export…** → **PDF** → **300 DPI** (600 for very small text).
2. In the print dialog choose **100% / Actual size**, and turn **off** "Fit to
   page" / "Shrink to fit".
3. Print on sticker paper (glossy printable vinyl works well) and cut along the
   card shape.

## Keyboard

| Action | Key |
|---|---|
| Select / move | `V` |
| Add text | `T` |
| Add image | `I` |
| Rectangle / ellipse | `R` / `O` |
| Crop selected image | `C` |
| Duplicate layer | `Ctrl+D` |
| Copy / paste layer | `Ctrl+C` / `Ctrl+V` |
| Paste image from clipboard | `Ctrl+V`, or right-click → Paste |
| Save project | `Ctrl+S` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` |
| Fit sheet | `Ctrl+0` |
| Nudge layer | Arrow keys (`Shift` = 2 mm) |
| Pan | Space + drag, or middle-drag |
| Finish text / crop | `Esc` |
| Card outlines / numbers | `G` / `N` |

## Files

```
index.html        app shell
favicon.svg
css/styles.css    styling
js/util.js        helpers, geometry
js/model.js       page/card presets and layout maths
js/render.js      canvas drawing (clipping, text, images)
js/pdf.js         exact-size PDF writer + exports
js/storage.js     autosave (IndexedDB with localStorage fallback)
js/ui.js          sidebar, page setup, export dialog, help
js/library.js     "Find audio" panel (inactive in this build)
js/app.js         editing, tools, interactions, history
```

## About the audiobook pipeline

This repository publishes the **designer**. There is also a private companion
that turns audiobooks into finished cards (search, download, loudness-matched
encode, chapter splitting, tagging, card planning, Yoto upload). It is a local
Python service, runs on `127.0.0.1` only, and is not part of this build — which
is why the **Find audio** button does not appear when the app is loaded from
GitHub Pages.

## Licence

Personal project. Yoto is a trademark of its owner; this is an unofficial tool
and is not affiliated with Yoto.
