# Classic layout (pre-"studio" arrangement)

A verbatim copy of the three files that defined the original layout, kept so the
change can be undone without archaeology.

**That layout was:** a single horizontal toolbar across the top holding both the
tools and their options; a vertical card browser down the left at 160px-wide
thumbnails; inspector on the right; status bar along the bottom.

**The current ("studio") layout is:** a vertical tool rail down the left, a
horizontal options bar along the top, and the card browser as a horizontal
filmstrip along the bottom at 107px-wide thumbnails.

## Reverting

```sh
./tools/revert-layout.sh
```

That copies these three files back over `src/`. Note that the pan and zoom
features added alongside the studio layout live in `src/canvas/surface.js` and
`src/editor/app.js`, which this does **not** touch — reverting the layout keeps
the hand tool, the magnifier, and middle-mouse pan/zoom working.

Restart is not needed; the dev server hot-reloads.
