# Modular portrait test (Pixel Lab)

A one-off experiment: can we build face portraits from reusable parts, so that
new faces cost code, not AI generations? Run on 2026-11-17.

## Method

1. Generate one bald **head** per layout (128x128, transparent background).
2. For each part (hair, eyes, mouth) and each style, ask Pixel Lab to redraw
   only a masked region of that head (`POST /v2/inpaint`).
3. Keep only the pixels that changed: that is the part's transparent **layer**.
4. Stack `head + mouth + eyes + hair` in code for every combination.

Three layouts were tried: front bust, 3/4 bust, front close-up. Each got 3 hair,
3 eyes and 3 mouth styles, giving 27 faces per layout from 9 parts.

## Results

| | |
|---|---|
| Combination sheets | `out/front-combos.png`, `out/threequarter-combos.png`, `out/closeup-combos.png` |
| Same layers on other heads | `out/front-other-heads.png` |
| Individual files | `out/<layout>/{head.png, layers/, combos/, raw/}` |
| Numbers | `out/report.json` |

- **Compositing works.** Parts from different styles join with no visible seam.
  Pixels outside each mask came back byte-identical, and no layer has
  semi-transparent pixels.
- **Cost: 1 generation per part.** The whole test used 38 generations.
- **Size: 0.6-6 KB per layer**, about 1.4-2.5 KB on average.
- **Parts are tied to the head they were drawn on.** Eye, mouth and hair layers
  carry the surrounding skin, so on a head with another skin tone they show as
  patches (`out/front-other-heads.png`). This is the main open problem.
- **Every face reads as the same person.** Head shape and nose were not varied,
  and those carry most of the identity.
- **Prompts are followed loosely.** "Thin lips, stern closed mouth" came back as
  red lipstick in all three layouts; "long black hair" came back short and
  brown on the front bust.
- **A layer can add pixels but not remove them**, so hair that is narrower than
  the bald scalp leaves scalp showing (48 pixels on the front bust, 31 on 3/4).
- **Hair is limited by its mask.** It cannot fall over the brows, and on the
  close-up it is cut off by the frame.

## Second run: anime style, 64x64, several genders and ages

Same method, in `out-anime64/` (settings in `_tools/layouts-anime64.json`).
Each layout has five heads: an androgynous adult, a woman, a child, an old man
and an old woman. The adult has 3 hair, 3 eyes and 3 mouths (27 faces); each
other head has 2 of each (8 faces). That is 177 faces from 15 heads and 99 parts.

| | |
|---|---|
| Adult combinations | `out-anime64/<layout>-combos.png` |
| Woman, child, old man, old woman | `out-anime64/<layout>-heads-combos.png` |
| Adult parts placed on the other heads | `out-anime64/<layout>-reuse.png` |
| All 15 bare heads | `out-anime64/_heads-all.png` |

- **Combining works as well as at 128x128**, and the flat anime shading leaves
  less room for lighting mismatches between parts.
- **Files are smaller:** layers are 0.15-1.5 KB, about 0.6 KB on average. Heads
  use 13-38 colours.
- **Other genders and ages come from editing the first head**
  (`POST /v2/edit-image-pixen`, 1 generation). The face changes clearly and the
  eyes and mouth stay in place, so the same masks work for every head. Starting
  a new text-to-image from the old head did not work: it returned the same face
  or lost the framing.
- **Parts drawn on one head do not fit another.** Eyes come out doubled, and
  young skin covers an old face's wrinkles (`*-reuse.png`). Hair transfers
  mostly intact. So every head type needs its own eyes and mouths.
- **Prompts are still followed loosely.** "Eyes squeezed shut" came back open;
  "long grey hair tied back" came back as a bouffant; on the close-up old woman
  one hairstyle came back skin-coloured.
- **Layout ranking is unchanged:** 3/4 bust looks best, front bust is fine, the
  close-up crops hair at the frame.
- Cost: 123 generations, 6 of them on the head approach that was discarded.

## Re-running

Scripts are in `_tools/` and need only Node. `gen.mjs` skips any image that
already exists, so re-running costs nothing unless a file is deleted. Set
`PT_RUN=anime64` to work on the second run; unset, the scripts use the first.
The second run also uses `mkheads.mjs`, `mkjobs-heads.mjs`, `compose-heads.mjs`
and `cross.mjs`.

```
node _tools/gen.mjs _tools/jobs/01-bases.json   # 6 base heads
node _tools/prep.mjs <base> <layout>/head.png <shiftDown>
node _tools/mask.mjs                            # masks from layouts.json
node _tools/mkjobs.mjs && node _tools/gen.mjs _tools/jobs/03-parts.json
node _tools/compose.mjs                         # layers + all combinations
```

`pixellab.mjs` reads the API token from `PIXELLAB_TOKEN`, or from the Pixel Lab
entry in `~/.claude.json`. The token is never written to this folder.
