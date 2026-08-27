# Vacant: the walk icon, and where "less is more" stops

Research note, 2026-08-27. Answers the owner's "replace walk with a walk icon" ask
and everything downstream of it: the glyph itself, whether an emoji will do, what
the row's accessible name becomes once a word has been turned into a picture, which
other controls should and should not follow, and how all of it behaves at AX5 text
size and in forced-colors mode.

Everything here was measured in Chrome 151 through the DevTools protocol and in the
font binaries on this machine. Commands are in
[What I measured](#what-i-measured). Mockups use the 46-character interior grid from
[`ux-states.md`](ux-states.md), which is roughly 390px at body size.

---

## The one thing to read

**The problem:** the row does not currently print the word "walk" at all, it prints
a bare `2 min`, so an icon here is not decoration replacing a word, it is the only
thing on the line that says what the number measures, and it has to say it in three
places at once: on screen, in the accessibility tree, and in Windows High Contrast
where a browser overrides colours the page chose.

**The fix:** one 163-byte inline SVG walking figure, defined once as a `<symbol>`,
painted by a CSS class with `stroke: currentColor`, sized in `em`, and marked
`aria-hidden`, with the words "2 minute walk" kept in the row's `aria-label` where
[`ux-states.md`](ux-states.md) already required them.

```
  WHAT CARRIES THE MEANING            WHO SEES IT
  --------------------------------------------------------------
  the walking figure, 20.8 CSS px  -> sighted user. Says the
    stroke: currentColor              number is a walk, and
    ~19:1 contrast, tracks theme      nothing else on the line
                                      does

  aria-label on the row button     -> VoiceOver. Says "2 minute
    "...2 minute walk..."             walk", plus the tier, the
    icon is aria-hidden               seats and the locked-door
                                      caveat. Unchanged by the
                                      icon: the label was
                                      already words

  currentColor, not a hex, not     -> forced-colors user. The
    a CSS mask                        glyph follows CanvasText.
                                      A mask icon MEASURES ZERO
                                      INK in the same test
```

The three failures this note exists to prevent, all reproduced:

1. A CSS `mask-image` icon **completely disappears** in forced-colors mode. Measured
   0 ink pixels where the same shape as inline SVG measures 633.
2. An icon-only button with no `aria-label` computes an **empty accessible name**.
   Measured `name=""` straight out of Chrome's accessibility tree.
3. A `<button>` does not inherit `font-size`, so an `em`-sized icon inside one
   **stops scaling with Dynamic Type**. Measured: the back arrow frozen at 44x44 at
   every text size until `font: inherit` was added, after which it tracked
   44 / 66 / 103 px.

---

## What I measured

Chrome 151.0.7922.174 headless, driven over CDP, `Emulation.setEmulatedMedia` for
forced-colors and `Emulation.setDeviceMetricsOverride` for viewport and DPR. Font
metrics read with fontTools 4.59.2 straight out of `C:\Windows\Fonts`. Three HTTP
HEAD requests to jsdelivr for icon-font sizes, nothing else went out.

```bash
# icon font weights, 3 HEAD requests, sequential
curl -sS -I -m 60 https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/webfonts/fa-solid-900.woff2
curl -sS -I -m 60 https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2
curl -sS -I -m 60 https://cdn.jsdelivr.net/npm/@material-symbols/font-400@0.28.0/material-symbols-outlined.woff2

# which fonts on this box even contain the pedestrian, and how wide is it
python -X utf8 fontscan.py     # cmap scan of 350 font files
python -X utf8 metrics.py      # hmtx advance + glyph bbox

# forced-colors, dark, and normal, computed styles + pixel counts
node cdp.mjs                   # Emulation.setEmulatedMedia forced-colors=active
node shot.mjs                  # screenshot each icon variant, count ink pixels

# the reduced row at five viewport / text-size combinations
node rowtest3.mjs row4.html    # 390x17, 320x17, 320x34, 390x53, 320x53

# what the screen reader actually gets
node ax.mjs                    # Accessibility.getFullAXTree
```

| Measurement | Value | Why it decides something |
| --- | --- | --- |
| walk symbol, inline SVG | **163 bytes** | the whole ask, in bytes |
| all three glyphs plus their CSS rule | **529 B raw, 297 B gzipped** | 0.86% of the 60 KB shell |
| Font Awesome 6 solid `woff2` | 158,220 B | **5.2x the entire room index** |
| Bootstrap Icons `woff2` | 130,396 B | 4.2x |
| Material Symbols Outlined `woff2` | 411,104 B | **13.4x** |
| the word `walk`, UTF-8 | 4 bytes | |
| the emoji `U+1F6B6`, UTF-8 | **4 bytes** | the emoji saves nothing |
| fonts on this box containing `U+1F6B6` | **2** | Segoe UI Emoji, Segoe UI Symbol |
| its advance in Segoe UI Emoji | **1.373 em** | |
| its advance in Segoe UI Symbol | **0.582 em** | the same character, 58% narrower |
| emoji rendered width, normal | 23.34 px at 17px | |
| emoji rendered width, forced-colors | **9.89 px** | Chrome swaps to the mono font and the column reflows |
| emoji bbox below baseline | **-0.180 em** | grows the line box; `walk` reaches -0.012 em |
| mask-image icon, forced-colors | **0 ink pixels** | it vanishes |
| inline SVG icon, forced-colors | 633 ink pixels, identical to normal | shape preserved, colour follows |
| hardcoded `#1a73e8` SVG, forced-colors | **still rgb(55,133,234)** | Chrome does not force `stroke` |
| icon contrast, darkest pixel, any DPR | **18.9:1** | clears the 7:1 the row targets |
| icon contrast, mean ink, 1x DPR | 6.3:1 | worst case, still over the 3:1 floor |
| icon contrast, mean ink, 2x / 3x DPR | 14.4:1 / 17.0:1 | every target phone |
| two-line row height, 390px, 17px | **72 px** | 1.6x the 44px target floor |
| icon at 390px, 17px | 20.77 CSS px | |
| icon at AX5 (53px root) | **64.75 CSS px** | it scales, because it is sized in `em` |

---

## 1. The glyph

### Ruled out: any external request

[`pwa-ios.md`](pwa-ios.md) makes the shell a fixed list of files a service worker
holds, and the app has to answer in a stairwell. A CDN request for an icon font or an
SVG sprite is a network dependency on the critical path of a screen whose entire
premise is that it has none. That is not a preference, it is
[#22](https://github.com/EnesYilmazcode/Vacant/issues/22)'s cache manifest: anything
not in `SHELL_ASSETS` does not exist offline.

### Ruled out: an icon font, even self-hosted

Three measured weights, against a room index the README puts at about 30 KB gzipped:

```
  Bootstrap Icons            130,396 B     4.2x the room index
  Font Awesome 6 solid       158,220 B     5.2x
  Material Symbols Outlined  411,104 B    13.4x
  --------------------------------------------------------
  Vacant's three glyphs          529 B     0.017x
```

`woff2` is already Brotli-compressed internally, so gzip does not help those numbers.
Shipping 158 KB of font to draw one 20-pixel figure is 300 times the payload for the
same result, and it buys three problems on top of the bytes:

- It is a fourth shell asset, so it has to be in `SHELL_ASSETS`, versioned with the
  shell, and evicted with it.
- Icon fonts render from Private Use Area codepoints, which screen readers announce
  as whatever their symbol dictionary happens to hold, and braille displays render as
  an unknown-character cell.
- A user font override, which people with low vision genuinely use, replaces the
  family and every icon becomes a missing-glyph box. The failure lands on exactly the
  population the icon was supposed to help.

### Ruled out: a CSS mask, and this one is not obvious

The tidiest-looking option is a `background: currentColor` span with a
`mask-image: url("data:image/svg+xml,...")`. Zero extra DOM nodes per row, no
`aria-hidden` needed because a background is invisible to the accessibility tree by
construction, and it themes with `color`.

It is invisible in Windows High Contrast. Forced-colors mode forces
`background-color`, and the forced value on a plain element is the page backdrop, so
the icon is painted in exactly the colour it sits on:

```
  forced-colors: active, screenshot, ink pixels counted per 64x64 cell

  A  inline <svg> + stroke: currentColor        633 px   visible
  B  span + background: currentColor + mask       0 px   *** GONE ***
  C  inline <svg> + stroke: #1a73e8             617 px   still blue
  D  emoji U+1F6B6                              572 px   mono, wrong size
```

Cell C is the other half of the lesson. Chrome does **not** force `stroke` on SVG
content, so an icon with a hardcoded brand colour keeps that colour on a forced black
or white background and nothing rescues it. `currentColor` is not a style preference
here, it is the only construction that tracks the forced palette, because `color`
*is* forced and `currentColor` resolves against it. Measured: `color` goes to
`rgb(255,255,255)` under forced-colors and the icon goes with it.

### The path data

A walking figure, drawn for this project so there is no third-party licence to add to
the three-way split already open in
[#25](https://github.com/EnesYilmazcode/Vacant/issues/25). Head, spine, two legs in
stride, one arm. Five strokes was too many: a five-stroke figure rasterised to mud at
16px, so the second arm was cut.

Rasterised from the actual geometry at four sizes, supersampled 4x4 per pixel:

```
   14 px            16 px             20 px             24 px
  ------          --------          ----------        ------------
   *@-             *@-                 +#-               :+:
   *@-             @@*                .@@@              :@@@:
   *+              *%.                .@@@              +@@@+
   %-              %+                  *%.              :@@@:
   @%              @-                  @#                %@:
  -@*@.           :@@-                .@+               .@@
  *@-=.           +%*@-               =@%               -@*
 .@+@-            %@:=-               *@@%.             *@*
 ** -%           -@*@-                %%-@@.            %@@*
 @. .@           %* +@               :@@.:#.            @@@@#
+#   @:         :@. .@:              #@@@-             -@#.@@%
+:   +.         ##   @=             :@*.@@-            *@%..%%
               .@:   #+             #@.  @*           .@@@@:
               .*    --            .@*   %#           *@**@@-
                                   *@:   #@          .@@. +@@
                                   @#    +@.         *@*   %@:
                                                     @@.   *@-
                                                    +@*    +@+
```

The markup. Geometry only, paint comes from CSS:

```html
<!-- once, at the top of index.html, before the list -->
<svg width="0" height="0" aria-hidden="true" style="position:absolute">
  <symbol id="i-walk" viewBox="0 0 24 24">
    <circle cx="12.5" cy="3.5" r="1"/>
    <path d="M12 6 10.5 12.5 14 15.5 15 21M10.5 12.5 8.5 16.5 6.5 21M11.5 9 15 12"/>
  </symbol>
  <symbol id="i-back" viewBox="0 0 24 24"><path d="M15 4 7 12 15 20"/></symbol>
  <symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6 18 18M18 6 6 18"/></symbol>
</svg>
```

```css
.ico {
  width: 1.15em; height: 1.15em; flex: none;
  fill: none; stroke: currentColor; stroke-width: 2;
  stroke-linecap: round; stroke-linejoin: round;
}
```

```html
<!-- per use site -->
<svg class="ico" aria-hidden="true"><use href="#i-walk"/></svg>
```

The head is `r="1"` with a 2-unit stroke, which covers radius 0 to 2 and therefore
paints a solid disc. That keeps the whole icon a single paint source, so `fill: none`
and one `stroke` colour is the complete description and there is nothing for
forced-colors to catch out.

### The trap that would have shipped broken

Putting the paint attributes on the sprite's root `<svg>` looks like the obvious way
to write them once. It does not work. A `<use>` clone inherits from the **use site**,
not from where the symbol was authored, so `fill` falls back to its initial `black`
and `stroke` to its initial `none`, and the legs render as filled wedges:

```
  attrs on the root <svg>      175 ink px, filled wedges, broken
  attrs on each <symbol>       621 ink px, correct
  bare symbol + CSS class      621 ink px, correct   <-- recommended
```

Screenshot at 64px, ink pixels counted. The CSS-class version is recommended because
the paint declaration lives once in `app.css`, which is already a cached shell asset,
and each symbol stays pure geometry.

### Sizing, theme, and Dynamic Type

`width: 1.15em; height: 1.15em` on the consuming `<svg>`. Not a pixel box. Measured:
20.77 CSS px at the default 17px body, 41.53 px at 200% text, **64.75 px at iOS
AX5**. It scales because `em` resolves against the row's own font size, and the row's
font size is in `rem`.

1.15em rather than 1em because the figure is tall and narrow, so a 1em box makes it
read smaller than the digits beside it. `flex: none` stops the flex row from
squeezing it.

Theme awareness is free and is the reason for `currentColor`. The icon cannot fall
below the row's text contrast, because it is painted in the row's text colour.
`prefers-color-scheme: dark` needs nothing added: change `--ink` and the icon follows.
Measured contrast of the rendered strokes on the light theme:

```
  DPR   darkest pixel   contrast    mean ink   contrast
  1x     17,17,17        18.9:1     96,96,96     6.3:1
  2x     16,16,16        19.0:1     42,42,42    14.4:1
  3x     16,16,16        19.0:1     28,28,28    17.0:1
```

There is a fully solid core stroke at every DPR, so the icon clears WCAG 1.4.11's
3:1 floor for a graphical object with room to spare, and clears the 7:1 that
[`ux-states.md`](ux-states.md) sets for the row's primary line. 1x is included only
for completeness; every phone this ships to is 2x or 3x.

### Direction, and the one glyph that has to mirror

The walking figure faces right. That is convention rather than something I measured,
and it is the near-universal pedestrian pictogram from crossing signals, so it needs
no legend. If Vacant is ever localised to a right-to-left language, the walking
figure should mirror and, more importantly, **the back chevron must mirror**, because
its direction is its whole meaning. One rule covers it:

```css
[dir="rtl"] .ico-mirror { transform: scaleX(-1); }
```

Not worth building now. Worth writing down so it is not rediscovered as a bug.

---

## 2. Emoji: no, and not for taste reasons

`🚶 2 min` is one character and no build step, which is exactly why it needs a real
answer rather than a shrug. Five measurements kill it.

**It saves nothing.** `U+1F6B6` is 4 bytes in UTF-8. The word `walk` is 4 bytes in
UTF-8. There is no payload argument for the emoji at all.

**It lands in the accessible name as a raw codepoint.** Straight out of Chrome's
accessibility tree, no `aria-hidden`:

```
  <button>Hagerty Hall 050 <span>&#x1F6B6; 2 min</span></button>
    ->  name = "Hagerty Hall 050 🚶 2 min"
```

The browser passes the character through. What gets spoken is then the screen
reader's own emoji dictionary, which differs between VoiceOver, TalkBack, NVDA and
JAWS, and which the app cannot see or control. On a braille display it is an unknown
character cell. Wrapping it in `aria-hidden` fixes the leak but then the emoji is
purely decorative and you have paid the remaining four costs for nothing.

**It cannot be themed.** A colour emoji is a `COLR`, `CBDT` or `sbix` glyph and
ignores `color` entirely. It cannot take the row's ink colour, cannot meet the 7:1
target the primary line is held to, cannot invert for dark mode, and cannot carry the
single functional accent [`ux-states.md`](ux-states.md) reserves for walk time. The
one thing the row's accent colour is supposed to mean is the thing the emoji refuses
to do.

**Its width is font-dependent, and forced-colors changes the font.** Two fonts on
this Windows box contain `U+1F6B6`, and they disagree by 2.36x:

```
  Segoe UI Emoji     advance 2812/2048 = 1.373 em    COLRv1, colour
  Segoe UI Symbol    advance 1191/2048 = 0.582 em    monochrome outline
```

Measured twice, independently. fontTools reads those advances out of `hmtx`. Chrome
renders the same character at **23.34 px** normally and **9.89 px** in forced-colors,
at a 17px font, which is 1.373 em and 0.582 em exactly. So enabling High Contrast on
Windows silently shrinks the glyph by 58% and reflows the right-aligned walk column,
and it swaps a colour figure for a different artist's monochrome one. Compare the two
renders and it is not the same icon:

```
  normal         a colour pedestrian, yellow shirt, purple trousers
  forced-colors  a smaller, thinner, monochrome outline in another style
```

An inline SVG measured 633 ink pixels in both modes, identical shape, only the colour
changed.

**Its box does not fit the line.** The Segoe UI Emoji glyph's bounding box runs from
-0.180 em to +0.881 em. Text on that line reaches -0.012 em. So the emoji descends
2.9 px below the text descender at 17px and grows the line box, which either makes
the row taller than the rest or clips the glyph if `line-height` is tight.

**And it forces a decision with no right answer.** Bare `U+1F6B6` is 1 codepoint.
The gendered forms are 4 codepoints and 13 bytes each. Adding a skin tone makes it 5
codepoints and 17 bytes. Picking the bare pedestrian is the least-bad choice, but on
platforms that render the bare form with a default appearance it is still making a
statement about a person on a screen that is supposed to be about a room.

**Verdict: no emoji anywhere in Vacant's UI.** Not for walk, not for the caveat, not
for offline, not for capacity. The inline SVG costs 163 bytes and has none of these
properties.

`U+1F6B6 U+FE0E`, the text-presentation variation selector, is worth one line: it
asks for a monochrome glyph and is 7 bytes, but iOS and Android both ignore
`VS15` for this character in practice and it does nothing about the advance-width
instability. It is not a rescue.

---

## 3. The accessibility contract for the reduced row

The good news first. **Removing the word "walk" from the screen changes the
accessible name by nothing at all**, because
[`ux-states.md`](ux-states.md) already specified that the label expands `2 min` into
`2 minute walk`. The icon is a purely visual substitution and the spoken row is
byte-for-byte what it was.

### The names, verbatim

One `aria-label` per row button, generated by the same function that produces the
visible fields so the two cannot drift. Order is identity, distance, window, size,
caveat, exactly as
[#18](https://github.com/EnesYilmazcode/Vacant/issues/18) requires.

```
STRONG tier
  "Hagerty Hall 050, 2 minute walk, free until 1:55 pm, 40 seats.
   Class schedule only, the door may be locked."

MEDIUM tier
  "Derby Hall 049, 2 minute walk, no class for the rest of today,
   28 seats. Class schedule only, the door may be locked."

capacity absent (facilityCapacity === 0)
  "Sullivant Hall 220, 1 minute walk, no class for the rest of today,
   seat count unknown. Class schedule only, the door may be locked."

coarse fix, state A5 (accuracy > 75 m)
  "Hagerty Hall 050, about 2 minutes walk, free until 1:55 pm, 40 seats.
   Class schedule only, the door may be locked."

near miss, state D1, second shape
  "Derby Hall 049, 2 minute walk, free at 1:10 pm then 2 hours 5 minutes,
   28 seats. Class schedule only, the door may be locked."

not on the Registrar's general-assignment list (the ga:false parked decision)
  "Journalism 251, 4 minute walk, free until 2:20 pm, 24 seats,
   departmental room. Class schedule only, the door may be locked."
```

Every one of them still ends in the locked-door caveat. That is the single
non-negotiable: a sighted user meets the caveat once per screen, a VoiceOver user
swiping row to row never reaches the footer, so it lives in every name.

The confidence tier rides in the phrase, not in a separate field. "free until 1:55
pm" is STRONG and "no class for the rest of today" is MEDIUM, and the difference is
audible without any colour, badge or icon. That is the same rule
[`ux-states.md`](ux-states.md) states as "never encode the confidence tier in colour
alone", extended one step: never encode it in a picture either.

### How to build the name, with the measurements behind the choice

Six constructions were run through Chrome's accessibility tree. Names as computed:

| construction | computed accessible name |
| --- | --- |
| raw emoji, no aria | `"Hagerty Hall 050 🚶 2 min"` |
| emoji in `aria-hidden` | `"Hagerty Hall 050 2 min"` |
| `<svg role="img" aria-label="walk">` | `"Hagerty Hall 050 walk 2 min"` |
| `<svg aria-hidden="true">`, name from contents | `"Hagerty Hall 050 2 min"` |
| icon-only button, no label | **`""`** |
| `aria-hidden` icon plus a visually hidden span | `"Hagerty Hall 050 2 minute walk"` |
| `aria-label` on the button (recommended) | the full string above, exactly |

Three of those are traps.

`role="img" aria-label="walk"` reads as "walk 2 min", which is the wrong word order,
and it adds a nested `role=image` node inside the button, which is precisely the
"three disconnected fragments" problem
[`ux-states.md`](ux-states.md) rules out.

Leaving the icon `aria-hidden` and letting the name compute from contents produces
`"Hagerty Hall 050 2 min"`: no unit, no caveat, no tier. That is the row a screen
reader gets if nobody writes the label, and it is worse than the row before the icon
was added, because at least a sighted user could infer the unit from context.

The icon-only button with no label computes **`""`**. A button with no accessible
name is a WCAG 4.1.2 failure and it is one forgotten attribute away at all times.
This is the specific way the back arrow can ship broken.

Two constructions are correct. The visually hidden span works and is verified.
`aria-label` on the button is recommended because it is a single string with a single
source of truth, and the caveat plus the tier plus the seats are 60-plus characters
that would otherwise be four duplicated spans per row.

### Rules, written so a test can check them

```js
// the SVG is never named, never titled, never given a role
<svg class="ico" aria-hidden="true"><use href="#i-walk"/></svg>

// the label starts with the room name EXACTLY as displayed
console.assert(label.startsWith(visibleName));
// the label always ends with the caveat
console.assert(/the door may be locked\.$/.test(label));
// nothing in the tree is named "walk"
console.assert(!axTree.some(n => n.role === 'image'));
```

The `startsWith` assertion is not cosmetic. WCAG 2.5.3 Label in Name exists so that
someone driving the phone by voice can say what they see. The visible row reads
"Hagerty Hall 050" and the label expands "min" to "minute" and "till" to "until"
further along, which is right for pronunciation, so the guarantee that survives is
that the leading identity string is verbatim and first. That is the string a voice
user will speak.

Everything else in [`ux-states.md`](ux-states.md) section 5 still holds unchanged:
one focusable button per row, `aria-live="polite"` on the count element only, focus
moved to the message heading on every state change.

---

## 4. The icon audit, and the floor under "less is more"

The owner asked for one icon. The temptation once one word has become a picture is to
do it to the rest, and the row would be measurably worse for it.

**The rule.** An icon may replace a **unit** or a **navigation affordance**. An icon
may never replace a **claim about the world**. Every string in the row that asserts
something Vacant could be wrong about stays a word, because a word can be hedged,
qualified, and read aloud, and a picture cannot.

That rule is not abstract here. [`ux-states.md`](ux-states.md) measured that 36 of 38
classroom buildings sit within a 12 minute walk of the campus centroid and that at
peak, 98 rooms qualify with the nearest at 1 minute. The distances barely
discriminate between rows. **The words are the only thing that tells one row from
another.** Stripping words out of a list whose numbers are nearly identical does not
make it cleaner, it makes it undifferentiated.

| Candidate | Verdict | Why |
| --- | --- | --- |
| walk time unit | **icon** | The row prints a bare `2 min` today. The icon adds meaning rather than removing it, and it is the one field where the pictogram is universal. |
| back / close | **icon**, but exactly one of them | Universal, and the label is already outside the glyph. Must carry `aria-label`; measured `name=""` without one. See below on picking one. |
| bearing arrow in the detail sheet | **icon** | Already an icon, and the only case where the picture is the data rather than a label for it. |
| capacity, `40 seats` | **word** | `facilityCapacity === 0` must render `seats unknown` ([#18](https://github.com/EnesYilmazcode/Vacant/issues/18)) and no chair glyph says "unknown". A seat icon plus `40` is also genuinely ambiguous: 40 seats, 40 people in there now, floor 40. |
| the confidence phrase | **word** | It *is* the tier. `free till 1:55p` versus `no class rest of today` is the honesty the whole project is built on, and it has no pictorial form that is not a lie by compression. |
| the locked-door caveat | **word** | A warning triangle names no hazard. The caveat's specific content, that this is a class schedule and not a reservation calendar, is the entire disclosure. |
| `(offline)` in the header | **word** | A crossed-out cloud reads as an error. [`ux-states.md`](ux-states.md) is explicit that offline is the normal case, and a word can be neutral where a glyph cannot. |
| `94 more` | **word** | It is a count. |
| the `ga: false` departmental label | **word** | One word is the parked decision's whole point. A badge glyph would need a legend the user will never find. |
| duration values (`30m`, `1h`) | **word** | They are values, not units. A clock glyph on all four says nothing that distinguishes them. |
| the accuracy warning in A5 | **word** | It carries a number and a consequence. |
| `Open in Maps` | **word**, optionally plus an icon | It leaves the app, which is worth saying out loud. |
| the term label `Autumn 2026` | **delete**, per the owner | Not an icon question. It is chrome that no decision depends on. |

### Back arrow or close cross, not both

The owner asked for a back arrow top left, and separately for the result to open
"another sheet thing that brings you to another screen". Those are two different
presentations and they take different glyphs:

- If the detail **slides up from the bottom** as a sheet over the list, the glyph is
  a close cross, top right, and the accessible name is "Close".
- If the detail **pushes in from the side** as a screen, the glyph is a back chevron,
  top left, and the accessible name is "Back to the room list".

Shipping both, a chevron in the header and a cross in the sheet, teaches two dismiss
gestures for one concept. The existing Room detail mockup in
[`ux-states.md`](ux-states.md) shows `[ x ]` top right. The owner asked for a chevron
top left. **Pick the pushed screen and the chevron**, because it matches the ask, it
puts the control in the thumb-reachable corner for a right-handed one-handed grip,
and it gives the sheet a real URL-less history entry that the iOS 16.4-and-later
standalone edge-swipe can also drive. Do not rely on that gesture alone: it is not
guaranteed in standalone mode and it is invisible.

Both glyphs are in the sprite above either way, at 77 and 82 bytes.

### The accessible name of every icon-only control

```
  back chevron    aria-label="Back to the room list"
  close cross     aria-label="Close"
  bearing arrow   aria-hidden="true", the sheet says "head north-west" in text
```

The bearing arrow is `aria-hidden` on purpose. A rotating arrow has no useful spoken
form, and the compass direction is already a sentence next to it.

---

## 5. AX5, 320px, 200% zoom, and forced-colors

Issue [#18](https://github.com/EnesYilmazcode/Vacant/issues/18) requires the row to
render at 320px, at 200% zoom, at AX5 with the room name never truncated, and with a
`forced-colors` block present. Here is what the reduced row actually does. iOS
Dynamic Type body runs 17pt at Large and 53pt at AX5, so AX5 is a 3.12x scale and is
a harder test than WCAG's 200%.

Row markup is a two-by-two grid that collapses to one column, driven by a container
query, with `min-width: 0` and `overflow-wrap: anywhere` on the two text cells.

| Viewport | Root font | Columns | Row 1 height | Name lines | Icon | Horizontal overflow |
| --- | --- | --- | --- | --- | --- | --- |
| 390px | 17px | 2 | 72 px | 1 | 20.77 px | none |
| 320px | 17px | 2 | 72 px | 1 | 20.77 px | none |
| 320px | 34px (200%) | 1 | 295 px | 2 | 41.53 px | none |
| 390px | 53px (AX5) | 1 | 527 px | 2 | 64.75 px | none |
| 320px | 53px (AX5) | 1 | 527 px | 2 | 64.75 px | none |

The icon at AX5 is a 64.75 px walking figure, still one stroke, still `currentColor`,
still crisp because it is vector. Nothing about it needs a second asset, a second
size, or a media query. That is the whole argument for `em` sizing in one line.

The reflow is exactly what [`ux-states.md`](ux-states.md) asked for: the name wraps
freely, the walk time drops **below** the name rather than truncating, window and
seats stack under it. Verbatim from the AX5 render at 320px:

```
+----------------------------------------------+
| Hagerty                                      |
| Hall 050                                     |
|                                              |
| %  2 min                                     |
|                                              |
| free till                                    |
| 1:55p                                        |
|                                              |
| 40 seats                                     |
+----------------------------------------------+
       ( % is the walk icon, at 64.75 CSS px )
```

The room name is never truncated and never ellipsised, only wrapped, which is the
requirement. Note that at AX5 the icon on its own line beside a bare number is
carrying more weight than it does at default size, because there is no neighbouring
context left on that line at all. That is an argument for the icon, not against it.

### Three things that break, and what fixes them

**A `<button>` does not inherit `font-size`.** This is the one that would have
shipped. Form controls take a UA default font, so an `em`-sized icon inside an icon
button silently stops responding to Dynamic Type:

```
  .iconbtn without font: inherit    44 x 44 px at 17px, 34px AND 53px root
  .iconbtn with    font: inherit    44 x 44,  66 x 66,  103 x 103
```

The back arrow would have stayed a 15px glyph while every other thing on the screen
tripled in size. `font: inherit` on every button is mandatory, not tidiness.

**`rem` inside a media query does not track the root font size.** The obvious
implementation of "reflow when the text gets big" is `@media (max-width: 22rem)`. It
does not work. In a media query, font-relative units resolve against the *initial*
font size, which is 16px, permanently. Measured: at a 390px viewport the query gave
two columns at 17px root and still two columns at 53px root, which is the AX5
catastrophe of a 126px-wide name column wrapping "Agricultural Administration 219"
to 14 lines and a 2018px row.

The mechanism that does work is a **container query in `em`**, because there
font-relative units resolve against the container's own font:

```css
.list { container-type: inline-size; container-name: list; }
@container list (max-width: 18em) {
  .row { grid-template-columns: minmax(0,1fr);
         grid-template-areas: "name" "walk" "win" "cap"; }
  .row .r-walk, .row .r-cap { justify-self: start; }
}
```

Measured: 390px at 17px is 22.9em so it stays two-column, 390px at 53px is 7.4em so
it collapses. Container queries are Baseline since Safari 16, and
[`pwa-ios.md`](pwa-ios.md) sets the floor at iOS 16, so this is in budget.

**Every `white-space: nowrap` is a future horizontal-overflow bug.** At 320px and
AX5, `seats unknown` with `nowrap` pushed the document to 379px wide, which breaks
WCAG 1.4.10 Reflow. Keep `nowrap` on exactly one thing, the icon-plus-number pair,
because splitting the figure from its number destroys the meaning. Measured, that
pair is 220 px at AX5 on a 320px screen with 68 px to spare, and walk times are gated
at 1500 m by state F1 so they never exceed two digits.

A content-driven flex row was tried as the alternative to the container query. It
still overflowed at 320px and AX5, because a flex item's automatic minimum size is
its own longest word. The grid version was clean at all five combinations. Use grid.

### Forced-colors

```css
@media (forced-colors: active) {
  /* nothing to do for the icons: currentColor already tracks CanvasText */
  .row:focus-visible { outline: 2px solid CanvasText; outline-offset: 2px; }
  .chip[aria-checked="true"] { forced-color-adjust: none; }  /* only if a chip bar survives */
}
```

The icons need no rule at all, which is the point of the construction. Verified by
screenshot: 633 ink pixels in both modes, identical shape, colour following
`CanvasText`. What does need attention in that block is anything whose selected or
active state is currently carried by a background colour, because forced-colors
flattens backgrounds and the state disappears. That is the duration chips' problem,
not the icon's, and it belongs to whoever lands the chip-bar change.

**iOS does not implement `forced-colors`.** There is no Windows High Contrast
equivalent in Safari, so the block above protects Android and desktop Chrome users of
the installed PWA. The iOS analogues are Smart Invert, Increase Contrast and Button
Shapes, and I could not test any of them from here. An inline SVG stroked in
`currentColor` should invert alongside the text under Smart Invert, which is correct,
while a colour emoji would invert its own colours into nonsense. That is reasoning,
not a measurement, and it is on the open-questions list below for the
[#5](https://github.com/EnesYilmazcode/Vacant/issues/5) device spike.

---

## 6. Touch targets

**Floor: 44 by 44 CSS pixels, written in `px`.**

WCAG 2.2 SC 2.5.8 Target Size (Minimum) is 24 by 24 and is Level AA. SC 2.5.5 is 44
by 44 and is AAA. Apple's HIG is 44 by 44. Take 44: this is an app used one-handed,
outdoors, in gloves, in winter, which is the environment
[`ux-states.md`](ux-states.md) already designs for, and the difference between 24 and
44 is the difference between a control you can hit while walking and one you cannot.

**`px` is the right unit here and it does not contradict
[#18](https://github.com/EnesYilmazcode/Vacant/issues/18)'s rule.** That rule forbids
`px` for `font-size`, `line-height` and spacing. A touch target floor is none of
those: it maps to a fingertip, and a fingertip does not get bigger when someone turns
up their text size. Writing `min-height: 2.75rem` instead produces a **145.8 px** back
button at AX5, which is a fifth of the screen for a chevron. Measured. Use
`min-width: 44px; min-height: 44px`, let the padding be in `em` so the button grows
with its glyph, and the floor only ever binds at small text sizes.

**The reduced row still clears it comfortably.** Measured 72 px at 390px and the
default 17px body, which is 1.6x the floor and matches the "about 64px" that
[`ux-states.md`](ux-states.md) estimated. Nothing the owner asked for touches this:
removing the term label, the duration text and the word "walk" changes the row's
content, not its `padding` or its two-line structure. The row is one button, so the
whole 390 by 72 rectangle is the target.

```
+----------------------------------------------+
| Hagerty Hall 050                    %  2 min |   <-- 72 px tall,
| free till 1:55p        40 seats              |       one button,
+----------------------------------------------+       390 x 72 target
```

Three things to hold the line on:

- The back arrow gets `min-width: 44px; min-height: 44px; padding: .4em; font: inherit`.
  Measured 44 / 66 / 103 px across the three text sizes with `font: inherit`, and a
  frozen 44 without it.
- 8 px of clear space between adjacent targets. The rows are separated by a hairline
  rule and there is only one control per row, so nothing in the list needs it, but
  the header does if anything ever joins the back arrow there.
- `env(safe-area-inset-bottom)` still has to be honoured on whatever ends up at the
  bottom of the screen after the chip bar changes, or the home indicator eats the
  last 34 px of the target.

---

## Corrections and additions to the existing research

| What exists | What I measured |
| --- | --- |
| [`ux-states.md`](ux-states.md) section 5: "the row must survive 200% zoom and iOS Dynamic Type at AX5" | Achievable, but not with the obvious implementation. A `rem` media query does not respond to Dynamic Type at all, a flex row overflows horizontally at AX5 because a flex item's minimum size is its longest word, and a `<button>` does not inherit `font-size` so an `em`-sized glyph inside one stops scaling entirely. The working construction is grid plus a container query in `em`, `min-width: 0`, `overflow-wrap: anywhere`, and `font: inherit`. |
| [`ux-states.md`](ux-states.md): "the accessible name is ordered identity, distance, window, size, caveat" | Unchanged by the icon, and that is the finding. The label already said "2 minute walk", so substituting a picture for the word costs nothing in the accessibility tree. But it only holds if the name is written explicitly: measured, name-from-contents gives `"Hagerty Hall 050 2 min"` with no unit, no tier and no caveat. |
| [`ux-states.md`](ux-states.md): "Minimum target 44x44 CSS px" | Right, and it has to be written in `px`. `2.75rem` produces a 145.8 px control at AX5. |
| [`ux-states.md`](ux-states.md): "a `forced-colors` block, which Finder already implements and can be lifted" | Lift the focus-visible half. The icons need no rule if they use `currentColor`, and a `mask-image` icon cannot be rescued by a block at all: it measures zero ink. Also worth knowing before lifting: Chrome does not force `stroke`, so a hardcoded hex in a lifted Finder icon would keep its colour on a forced background. |
| [`ux-states.md`](ux-states.md): "Never encode the confidence tier in colour alone" | Extend it: never encode it in a picture either. The tier lives in the phrase, and the phrase stays a word. |
| [`pwa-ios.md`](pwa-ios.md): "Do not use SVG icons" | That is about the **home screen icon**, where iOS reads a 180x180 PNG, and it stands. It does not apply to in-page UI glyphs, where inline SVG is the correct and cheapest answer. Worth stating so the two do not get conflated. |
| [#18](https://github.com/EnesYilmazcode/Vacant/issues/18): `grep -E '[0-9]+px' css/app.css` returns no `font-size`, `line-height` or spacing hit | Add an exception, written into the issue rather than left to judgement: `min-width` and `min-height` on touch targets are `px` on purpose. The grep as written already allows them; the risk is someone "fixing" them to `rem` later. |
| README rows: `Dreese 357  4 min walk  yours for 2h06  46 seats` | The word "walk" appears in the README's marquee example and in the detail sheet's first line, but **not in the row mockups in `ux-states.md`**, which print a bare `2 min`. So the owner's ask lands on the detail sheet and on the README, and on the row it is an addition rather than a substitution. That is the strongest argument for doing it: `2 min` alone is ambiguous, and it gets more ambiguous once the duration chips stop sitting under it. |

---

## Open questions

1. **Does `font: -apple-system-body` actually deliver Dynamic Type inside an
   installed standalone PWA?** It is the only web hook for the AX text sizes, and an
   installed PWA has no Safari AA menu, so it may be the only text-size lever a user
   has once the icon is on the home screen. Everything in section 5 was measured by
   forcing the root font size directly, which proves the layout reflows correctly but
   not that iOS will ever ask it to. Fold the check into
   [#5](https://github.com/EnesYilmazcode/Vacant/issues/5): set Dynamic Type to AX5 in
   Settings, open the installed icon, and read the room name's computed font size off
   a diagnostics line.
2. **What do Smart Invert and Increase Contrast do to a `currentColor` inline SVG on
   iOS?** No `forced-colors` on that platform, so the section 5 block does not cover
   iOS at all. Same device spike, one screenshot each.
3. **Does the walking figure read as "walk time" to a first-year who has never seen
   the app?** The pedestrian pictogram is near-universal, but that is convention and
   not something I measured. This is one question in the
   [#26](https://github.com/EnesYilmazcode/Vacant/issues/26) ground-truth walk, which
   already puts the app in front of real people: point at the row and ask what the
   number means.
4. **Sheet or pushed screen?** Section 4 recommends the pushed screen and the back
   chevron because it matches the ask, but the existing Room detail mockup in
   [`ux-states.md`](ux-states.md) shows a close cross top right. Whoever lands
   [#18](https://github.com/EnesYilmazcode/Vacant/issues/18) has to settle it once, and
   the glyph follows the decision rather than the other way round.
5. **Does `<use href>` plus `currentColor` behave in Safari the way it does in
   Chrome?** The mechanism is old and well supported, and stroking via a CSS class on
   the consuming `<svg>` avoids the known shadow-tree cascade edge cases, but every
   measurement in this note is Chrome. Cheap to confirm on the same device pass.

---

## Risks

- **The label gets forgotten and the row goes silent.** Measured, the failure is not
  loud: an unlabelled row still computes a name from its contents, so a screen reader
  reads `"Hagerty Hall 050 2 min"` and nothing looks broken. The unit, the tier and
  the locked-door caveat are simply gone. The `startsWith` and `door may be locked`
  assertions in section 3 are the only thing that catches it.
- **An icon-only button ships with no name at all.** Chrome computes `""`. The back
  arrow is the exposed one, because it is the only control on the screen with no text
  beside it.
- **Somebody uses a CSS mask because it is tidier.** It is genuinely the cleaner
  markup and it is invisible in Windows High Contrast. Zero ink pixels, no error, no
  console warning, nothing to notice until a user says the button is missing.
- **Somebody converts the 44px target floor to `rem` to satisfy the no-px grep.** It
  produces a 145.8 px chevron at AX5 and a target that shrinks below 44 px if the user
  turns text *down*. The exception belongs in the issue text.
- **"Less is more" keeps going.** The row has five fields and four of them are load
  bearing. The measurement that argues against further stripping is already in
  [`ux-states.md`](ux-states.md): 98 rooms qualify at peak, the nearest is 1 minute
  away, and 36 of 38 buildings are inside a 12 minute walk. When the numbers barely
  differ, the words are the differentiator, and a row of pictograms is a row that
  cannot be told apart.
