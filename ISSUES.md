# HyperMango — Issue Inbox

Add anything you notice under **Inbox**. Rough notes are fine — "pencil feels
laggy", "can't find the polygon tool", "crashes when I delete the last card".
No format required, one item per line starting with `- `.

Claude works the Inbox top-down, one issue at a time, moving each through
**In progress** to **Done** with a note on what changed. Anything that needs a
decision from you lands in **Needs input** with a question; answer it inline and
move the item back to the Inbox.

**Adding issues:**

```sh
./issues "the eraser leaves a white halo"   # append to the Inbox
./issues                                     # list the Inbox
```

Or just edit the Inbox list below by hand.

**Running the loop:** in Claude Code, `/issues-loop` keeps working the Inbox and
checks back periodically for new items. `/work-issues` does a single issue.

---

## Inbox

<!-- Add issues below this line. -->

---

## In progress

_Nothing yet._

---

## Needs input

_Nothing yet._

---

## Done

**New Filled Ellipse tool** — A solid-oval counterpart to Filled Rectangle, sitting just
below it in the tool rail with a solid oval icon. Its keyboard shortcut is **O** (for oval),
since C, the ellipse's first letter, is already the outline Ellipse. It works exactly like
Filled Rectangle: drag out the shape and it fills with the line colour. A see-through preview
shows while dragging, and a click without a drag draws nothing. It is the same shape code as
the other shape tools, with a `fillEllipse` case next to `fillRect` in `shapes.js`, so undo,
drawing onto canvas buttons and the cursor all come for free. Verified in headless Chrome
with real input: O selects it (status bar reads "Filled Ellipse"), a drag shows the preview
and commits a solid ellipse, and F still selects Filled Rectangle. `npm test` 64/64 and the
build pass; not tried in the Tauri app itself.

**Swatch rail: five more rows (42 colours per set)** — The rail's two columns are now 21
rows tall instead of 16, and every set was regenerated to fill them rather than padded.
Primaries and Pastels now step through 21 hues instead of 16, so neighbouring colours are
closer together. Each row still pairs a hue with its darker (or deeper pastel) partner.
Grays is now a 42-step ramp from black to white. The row count is one constant, `ROWS` in
`palette.js`, with the matching `grid-template-rows` in `app.css` commented to point at it.
Verified in headless Chrome: each set renders 42 swatches in 21 rows, and paging between sets
works. The rail's content ends at about y = 596, which fits inside the app's 700 px minimum
window height with no scrolling. `npm test` 64/64 and the build pass; not tried in the Tauri
app itself.

**Drag a new button out of the Button button** — Dragging from **Button** in the options
bar now carries a see-through copy of a new button under the cursor, drawn at the card's
current zoom. Letting go drops a real button centred where you released. If that would put
any of it off the card, it moves to the closest spot where it fits wholly on the card, so
dropping on the toolbar or past an edge lands it against that edge. A plain click still adds
a button at the usual top-left spot. Esc during the drag cancels it, and a drag that ends
back on the Button button doesn't also count as a click. The default button size now lives
in `NEW_BUTTON` in `stack.js`, so the ghost and the real button can't drift apart. Verified
in headless Chrome with real mouse drags: the ghost follows the cursor, a drop mid-card lands
centred (413, 313), drops past the bottom-right and top-left clamp to (923, 753) and (0, 0),
Esc cancels, and a click still adds at (74, 74). The new buttons' positions were read from
the Inspector: in a plain browser the app's Tauri start-up doesn't finish, so buttons aren't
drawn on the card there. Not tried in the Tauri app itself. `npm test` 64/64 and the build
pass.

**Polygon: clicks off the card land at the closest point on it** — Off-card clicks were
already accepted, but a vertex after the first slid back along the line from the previous
vertex (an earlier deliberate choice), so it landed somewhere other than where you'd expect.
`polygon.constrain()` now always snaps to the closest point on the card, for the first vertex
and every later one, and the rubber-band preview follows the same rule. Also: a double-click
off the card now finishes the shape (it only worked on the card before), the workspace around
the card shows the polygon cursor so it's clear you can click there, and clicks in the card
strip no longer count as polygon clicks. `Surface.clipIntoCard()` is now unused but left in
place with its tests. Verified in headless Chrome by driving real mouse events: started a
shape off the top-left (vertex at the corner), clicked off the left edge (vertex at the same
height on the edge), and double-clicked off the card to commit. `npm test` 64/64 and the build
pass; not tried in the Tauri app itself.

**Play button is now a split button with Play / Play Fullscreen** — Chevron on
the right opens a menu with the two modes; picking one both plays immediately and becomes
the new default for the main button (that's what makes it a split button rather than a
button with a menu bolted on). The choice persists across restarts via `localStorage`, and
the ⌘R menu shortcut honours it too, so the keyboard shortcut and the button always agree
on what "just play" means.

Fullscreen calls the exact same `setFullscreen(true)` the window's own green traffic-light
button calls — it isn't a separate custom mode, it's invoking that button programmatically.
For a new window this waits on the documented `tauri://created` event rather than firing
right after construction, since the window doesn't exist yet at that point.

On whether there's something "more full" than that available: no — native fullscreen
already takes the dedicated macOS Space and hides the menu bar and Dock, which is the
maximum a normal window gets. A borderless window sized to the screen would be a step
*down*, not up: it would skip the Spaces integration (swipe-to-switch, Mission Control)
rather than add anything to it, so that wasn't built.

No capability changes needed — `set-fullscreen` was already granted to the calling window
(main) by the earlier fullscreen/Escape fix. Pure frontend, hot-reloaded into the running
app. Tests: 64/64 (no runtime logic touched, matching every other pure-UI fix in this
batch).

**Script editor is now a real macOS window** — Previously an in-app modal sheet
(a styled `<div>` overlay with a fake title bar, not a real window — could not be dragged
or moved off the app). It's now a genuine Tauri `WebviewWindow` (`script-editor.html`),
which gets native traffic lights and a draggable titlebar automatically — this app never
disabled window decorations anywhere, so a real `WebviewWindow` gets full native chrome
for free, the same as the already-working Reference and Play windows.

One window per object being edited, labelled `script_<kind>_<id>`, so editing several
scripts side by side works naturally, and reopening one that's already open brings it
forward instead of creating a duplicate — same pattern as the Reference window. Since the
editor window is a separate webview with no access to the main window's JS state, the
starting script text is handed over via `localStorage` (keyed by the new window's own
label so simultaneous editors don't clobber each other), and a save is reported back over
a Tauri event (`script-editor:save`) that the main window listens for and applies to the
model by searching the whole stack for the matching id — not just the currently-displayed
card, since the editor window can outlive the user navigating away from that card in the
main window.

Save no longer force-closes the window (a real window doesn't need to disappear just
because you saved, the same way a text editor doesn't quit on ⌘S) — there's a dedicated
Close button instead, and ⌘S is also wired to save directly, matching how the native Save
menu item dispatches to whichever window is focused. `capabilities/default.json` grants the
new window pattern via a `script_*` glob, since each editor's label is generated per object
rather than fixed. Rust rebuild required for the capability; the app has been restarted and
the compiled capability set was verified to include the new pattern rather than assumed.

**Button script-name badge hard to see** — Was mostly floating above the button
(`top: -9px, left: -1px`, 9px font) rather than sitting in its corner. Nudged to
`top: -7px, left: 3px` so it overlaps the button's frame, and bumped the font from
9px to 10px with slightly more padding to match. Pure CSS, no logic touched.

**New scripting keyword: `speaker`** — Sets the voice and/or speaking rate for
`speak` commands that follow. `speaker Zarvox` sets the voice; `speaker 200` sets the
rate to 200 words per minute on its own; `speaker Alex 300` sets both together. Voice
names are case-insensitive and matched against whatever `speechSynthesis.getVoices()`
exposes — on macOS that's backed by the same system voice registry the Terminal `say`
command uses, novelty voices included.

Reused the same raw-line lexer mechanism `speak` already needed (generalized from a
single hardcoded keyword into a small `RAW_LINE_COMMAND` table), because several macOS
voices are two words — "Bad News", "Pipe Organ" — and tokenizing the argument normally
would split those apart before anything got a chance to treat them as one name. The
interpreter is what decides what the raw captured text means: a trailing numeric token
is the rate, and everything before it (rejoined with spaces) is the voice name, so a
multi-word voice with a rate — `speaker Bad News 220` — still parses as one voice name
plus one number rather than three fragments.

Words-per-minute is necessarily an approximation: the Web Speech API has no WPM control,
only a unitless `rate` multiplier around 1.0. ~175 wpm (the traditional default for
`say`) is used as the baseline that maps to rate 1.0, so numbers scale in the right
direction even though they won't be bit-identical to `say -r <n>`. Documented in the
reference under Speech, alongside `speak`. Covered by 8 new tests for the argument
splitting (voice-only, rate-only, both, multi-word voices, and the parse error for a
bare `speaker`) — the actual browser-side voice lookup and rate conversion aren't
unit-tested, consistent with how `speak`'s own TTS call isn't either: this suite has no
browser/DOM harness, so Web Speech API integration is host-implementation code, not
runtime logic.

**Right-click flyout with stroke/fill pickers** — Right-clicking anywhere in the
canvas workspace (the card or the surrounding area) opens a flyout beside the cursor with
stroke and fill colour pickers stacked vertically, and dismisses on the next left-click
outside it. Flips to the cursor's left when it would otherwise run off the right edge of
the window. Unlike the toolbar's colour wells — which close as soon as you pick a colour,
since each edits exactly one swatch — this flyout stays open after a pick, since setting
both stroke and fill in one right-click is the point; it only closes on an outside click,
matching what was asked for.

Refactored the palette-grid/custom-picker/clear-button markup that the toolbar wells
already built inline into one shared `buildColorSection()`, so there is now exactly one
place that builds a colour picker rather than two independent copies drifting apart.
Pure frontend/CSS, no capability changes, hot-reloads into the running app.

**Play mode: native fullscreen + Esc quit the whole app** — Escape was calling
`window.close()` unconditionally. Closing an NSWindow mid-transition out of native macOS
fullscreen is what was taking the whole process down rather than just the play window —
WKWebView/AppKit can abort on a close during that animation. Escape now checks
`isFullscreen()` first, exits fullscreen, waits for the transition to settle, *then*
closes — with a guard against the keydown auto-repeating a second close mid-flight — and
explicitly focuses the editor window afterward so "return to authoring mode" is unambiguous
rather than relying on whichever window macOS happens to raise next.

**Script reference now opens in its own window** — Previously it was another `openSheet()`
call, and the sheet is a single shared set of DOM nodes reused by every dialog in the app —
opening the reference from inside the script editor silently replaced the script-editing
sheet underneath it rather than layering above it. Reference is now a real Tauri window
(`reference.html`); opening it while already open calls `setFocus()` on the existing one
instead of creating a second, exactly as asked. Closes on Escape like every other floating
surface. Added to `capabilities/default.json`.

**New scripting keyword: `speak`** — `speak "hello there"` or `speak hello there` (quotes
optional) speaks the text aloud via the Web Speech API. That's a deliberate departure from
literally shelling out to the platform `say` binary: it runs in the webview with no native
code or new capability grants, works identically in Play mode *and* in the standalone HTML
export, and needs no Windows-specific fallback since `speechSynthesis` isn't macOS-only.
The one real implementation wrinkle: free-form spoken text needs punctuation (commas,
apostrophes, question marks) that the script lexer has no token for anywhere else, so
`speak` is recognized only at the start of a line and captures everything up to the line
break *raw*, bypassing normal tokenization rather than widening what a bare word may
contain everywhere else in the grammar. The text is spoken literally — unlike `say`, it is
not evaluated as an expression, so `&` and variable names inside it are spoken as typed, not
resolved. `stop()` now cancels in-flight speech alongside audio. Documented in the script
reference under a new "Speech" section. Covered by 6 new tests, including that a comment on
the following line still parses normally and that punctuation the tokenizer would otherwise
reject is captured correctly.

**Card stack view → horizontal filmstrip along the bottom** — Thumbnails are now
107px wide (two-thirds of the previous 160px) in a horizontally scrolling strip. The
previous layout is preserved verbatim in `docs/layout-classic/` with a one-command
revert: `./tools/revert-layout.sh`. That script restores only the three layout files,
so reverting keeps the new pan/zoom tools working.

**Tools → vertical rail down the left** — The single top toolbar split in two: a 48px
tool rail on the left holding just the tools, and a top options bar keeping colours,
size, font, undo/redo and Play. Rail order follows illustration-app convention —
selection and navigation, divider, drawing tools, divider, text and button. The app grid
now uses named areas, so panes collapse by zeroing a track rather than leaving a gap.

**New tool: hand** — Drag to slide the card around the workspace. Handled at the pane
level rather than on the card, so it works over the empty area too. `Surface.clampPan()`
keeps at least 56px of card on screen in each axis — you can shove it almost entirely
out of view, but never so far there is nothing left to grab. Shortcut `H`.

**New tool: magnifier** — Click zooms in by 1.35×, ⌥click zooms out. Zooms about the
cursor via `Surface.zoomAt()`, so the thing under the pointer stays put instead of
sliding toward the pane centre. Shortcut `Z`.

**Middle-drag pans with any tool** — Bound on the pane, so it works regardless of the
active tool and anywhere in the workspace. Middle-click auto-scroll is suppressed.

**Wheel zooms incrementally** — Plain wheel now zooms about the cursor; no modifier
needed, since the pane no longer scrolls. The factor is exponential in the delta
(`1.0015^-deltaY`) so trackpads and notched wheels both feel proportional, and it is
exactly reversible for equal opposite deltas.

Covered by 7 new tests for pan clamping and zoom-about-a-point, including that the point
under the cursor stays fixed and that zoom in/out round-trips exactly.

**Buttons too small on creation** — Default size raised from 100×32 to 140×44.

**Resize handles too small** — Handles enlarged 9px → 13px, with the four corners at
15px since those are the ones people aim for, plus a shadow so they read against dark
artwork.

**Dragging a button teleported instead of following the cursor** — The pointerdown
handler called `select()` before starting the drag, and `select()` re-renders the object
layer with `innerHTML = ''`. That detached the very element being dragged, so the drag
moved an orphaned node and the "jump" was simply the layer rebuilding at pointerup.
Drags now re-acquire the live element after the re-render.

**Shape previews drew in the wrong place on canvas buttons** — Tools work in the
coordinate space of whatever they draw into, but the preview overlay always spans the
card; when the target was a canvas button those spaces differed by the button's origin,
offsetting the preview by exactly that much. The pencil was unaffected because it draws
straight to the target with no preview. Added `ToolContext.beginPreview()`, which
translates and clips the overlay to the target, and moved the rectangle, ellipse, blob,
and polygon previews onto it. Also made a part-built polygon keep its target across
clicks, so it can no longer defect to the card halfway through.

**Type landed underneath canvas buttons** — The object layer painted text first and
buttons second, so buttons always covered text. Order reversed. In play mode text
objects are `pointer-events: none`, so clicks still reach the button beneath.

**Play did nothing** — Two causes. (1) Tauri v2 denies every core/plugin command unless a
capability grants it, and `src-tauri/capabilities/default.json` did not exist, so the
`listen('menu')` subscription and the create-window call were both silently refused —
this also killed every other menu item. (2) The editor handed the stack to the play
window through `sessionStorage`, which is scoped per webview, so the play window would
have found nothing even once it opened; now uses `localStorage`, which is shared.

**Save / Save As did nothing** — Same missing capabilities file: `dialog:allow-save` and
`dialog:allow-open` were not granted, so the file dialogs never opened. Fixed by the same
`capabilities/default.json`.

**Type tool didn't work** — The `pointerdown` that places the text was not prevented, so
the browser's own focus handling ran *after* the new field was focused and blurred it.
An empty text object is discarded on blur, so it vanished instantly and all you saw was
the tool switch. Now calls `preventDefault()` and defers focus one frame.

**Polygon ignored clicks outside the card** — Clicks outside the card element never
reached the handler at all, and the clamp in use was per-axis, which moves a vertex off
the line it arrived on. Added `Surface.clipIntoCard()` (Liang–Barsky segment clipping)
plus window-level listeners for multi-click tools, so an outside click now lands where
the segment from the previous vertex crosses the card edge. Covered by 7 new tests.

