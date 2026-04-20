# Image Prompt Gateway — Design Spec (Strawman)

**Status:** STRAWMAN — every product decision flagged `ASSUMPTION`
**Date:** 2026-04-21
**Tracks:** Creative Gateway v1 (item #13 from MemoryCore audit follow-ups)
**Scope:** ~200 LOC, one slash command, one LLM call per invocation
**Non-goal:** full creative suite (see section 5)

---

## 1. Purpose

aman-agent today is a dev-tools product: slash commands for memory, rules,
skills, orchestration, delegation, GitHub. The MemoryCore ecosystem audit
flagged that **non-dev users are excluded** — competitors (Project-AI-MemoryCore,
etc.) ship creative features (Song Creation, Interactive Story, Image Prompt)
as *gateway* features that onboard broader audiences before revealing the dev
tooling underneath. This spec defines **v1 of the creative gateway**: a single
slash command, `/image <description>`, that takes a one-line idea and emits a
polished, composition-aware image-generation prompt for the user to paste into
Midjourney / NijiJourney / DALL-E 3 / Stable Diffusion SDXL. Image Prompt was
chosen over Song / Interactive Story because it has the smallest scope, the
highest crossover with the existing dev audience (devs use Midjourney for
docs/blog/slides art), and it requires zero new subsystems — no audio pipeline,
no game-state engine, no multi-turn loop.

---

## 2. Key Decisions (all `ASSUMPTION` unless noted)

| # | Decision | Flag |
|---|---|---|
| 2.1 | **Command surface:** `/image <description>` — a native slash command in aman-agent. Returns a polished prompt string the user copies into their image tool. | ASSUMPTION |
| 2.2 | **No image generation.** We do not call Midjourney / OpenAI Images / Stability / any image API. We only generate **prompt text**. Zero API cost, zero new provider dependency. | ASSUMPTION (but high-confidence) |
| 2.3 | **Template library keyed by style.** `realistic`, `anime`, `illustration`, `cinematic`, `concept-art`, `photo`, `3d-render`. Default style picked by keyword detection from the user's description. | ASSUMPTION |
| 2.4 | **LLM-driven expansion.** The agent's existing `ctx.llmClient` turns the one-liner + chosen template into a full composition-aware prompt (subject, lighting, lens/camera, mood, palette, style modifiers, negative prompt). **Actual LLM call — not mocked.** | ASSUMPTION |
| 2.5 | **Target tools:** Midjourney v7 (primary, default), NijiJourney v6, DALL-E 3, SDXL 1.0. Each gets tool-specific flags (e.g. `--ar 16:9 --v 7 --style raw` for MJ, natural-language prose for DALL-E, weighted tags + negatives for SDXL). User picks via `--tool mj\|niji\|dalle\|sdxl`. Default is `mj`. | ASSUMPTION |
| 2.6 | **Skill vs command:** native `/image` **command**, NOT a skill. Rationale: commands are always-available and appear in `/help`; skills trigger conditionally based on context. For a **gateway** feature, discoverability beats conditional triggering — new users should be able to type `/image` the second they install the agent. | ASSUMPTION |
| 2.7 | **One tool per invocation.** No multi-tool fanout in v1. Run the command 4× if you want all 4 formats. Rationale: simplicity, clear UX, no ambiguous combined output. | ASSUMPTION |
| 2.8 | **Aspect ratio flag:** `--ar 16:9 \| 1:1 \| 9:16 \| 3:2 \| 2:3`. Default inferred from style (cinematic → 21:9, portrait keywords → 2:3, else 16:9). | ASSUMPTION |
| 2.9 | **No memory persistence in v1.** Creative output is ephemeral. Prompt history can come in v2 (see open questions). | ASSUMPTION |

---

## 3. Architecture

### 3.1 File layout

```
src/
  commands/
    image.ts              NEW — slash-command handler
  image/
    templates.ts          NEW — style → prompt-scaffold library
    detector.ts           NEW — keyword-based style guess
    formatters.ts         NEW — tool-specific output (mj/niji/dalle/sdxl)
test/
  commands-image.test.ts  NEW
  image-templates.test.ts NEW
  image-detector.test.ts  NEW
```

### 3.2 Data flow

```
user types: /image a lonely astronaut on a pink moon --tool mj --ar 21:9

  ↓ commands/image.ts
    parse flags (--tool, --ar, --style override)
    description = "a lonely astronaut on a pink moon"

  ↓ image/detector.ts
    keyword scan → style = "cinematic" (matched "lonely", "moon")
    inferred ar   = "21:9"

  ↓ image/templates.ts
    template = CINEMATIC_TEMPLATE
    (defines: lighting hints, lens hints, mood slots, negative prompt seed)

  ↓ ctx.llmClient.complete({ system: TEMPLATE_SYSTEM, user: description })
    returns structured JSON:
      { subject, setting, lighting, lens, mood, palette, modifiers, negatives }

  ↓ image/formatters.ts → mjFormat(structured, { ar: "21:9" })
    returns a single string

  ↓ print to stdout + (future) clipboard
```

### 3.3 Component contracts

**`src/commands/image.ts`** — exports `imageCommand: Command`

```ts
export const imageCommand: Command = {
  name: "image",
  description: "Generate a composition-aware image prompt for MJ/Niji/DALL-E/SDXL",
  async run(ctx: CommandContext, args: string[]): Promise<void> {
    const { description, tool, ar, styleOverride } = parseArgs(args);
    const style = styleOverride ?? detectStyle(description);
    const template = getTemplate(style);
    const structured = await ctx.llmClient.completeJson({
      system: template.systemPrompt,
      user: description,
      schema: StructuredPromptSchema,
    });
    const output = format(structured, { tool, ar: ar ?? template.defaultAr });
    ctx.io.print(output);
  },
};
```

**`src/image/templates.ts`** — exports `getTemplate(style): Template`

```ts
export interface Template {
  style: Style;
  systemPrompt: string;  // instructs LLM how to expand the one-liner
  defaultAr: AspectRatio;
  modifiers: string[];   // e.g. ["octane render", "volumetric lighting"]
  negatives: string[];   // e.g. ["blurry", "low-res", "extra fingers"]
}
```

**`src/image/detector.ts`** — exports `detectStyle(description: string): Style`

Keyword table (seed — refine in impl):

| Keywords | Style |
|---|---|
| `anime`, `manga`, `chibi`, `waifu`, `2D` | `anime` |
| `photo`, `realistic`, `4k`, `portrait`, `street` | `realistic` |
| `cinematic`, `movie`, `film still`, `moody`, `lonely`, `epic` | `cinematic` |
| `concept`, `fantasy`, `sci-fi`, `creature`, `matte painting` | `concept-art` |
| `watercolor`, `illustration`, `storybook`, `children's book` | `illustration` |
| `3D`, `render`, `octane`, `blender`, `isometric` | `3d-render` |
| (fallback) | `realistic` |

**`src/image/formatters.ts`** — exports `format(structured, opts): string`

Formatters per tool:

- **mjFormat:** `{subject}, {setting}, {lighting}, {lens}, {mood}, {palette}, {modifiers} --ar {ar} --v 7 --style raw --no {negatives.join(", ")}`
- **nijiFormat:** same prose but `--niji 6 --style expressive` flags, negatives inline.
- **dalleFormat:** full natural-language sentence, no flags — DALL-E 3 rewrites prompts anyway, so we write fluent prose.
- **sdxlFormat:** weighted tags `(subject:1.2), (lighting:1.1), ...` + separate `Negative prompt: {negatives}` block.

### 3.4 LLM system prompt (sketch)

Each template's `systemPrompt` is roughly:

```
You are a prompt engineer for {tool_family} image generation in the {style}
style. Take the user's short description and return JSON with fields:
  - subject: primary focus (1 sentence)
  - setting: environment / background
  - lighting: specific lighting (e.g. "golden hour rim light")
  - lens: camera / lens hint ("85mm f/1.4, shallow DOF")
  - mood: emotional tone
  - palette: 2-4 dominant colors
  - modifiers: 3-6 style modifiers appropriate to {style}
  - negatives: 3-5 things to exclude

Be specific. Avoid clichés. Never invent celebrity names or copyrighted IP.
```

---

## 4. Example Interactions

### Example 1 — default path (no flags)

```
user> /image a lonely astronaut on a pink moon

detected style: cinematic
detected ar:    21:9
tool:           mj (default)

output ↓

A solitary astronaut in a weathered white suit stands on a dusty pink
lunar surface, Earth a pale blue crescent on the horizon, soft rim
lighting from a distant magenta sun, 35mm anamorphic lens, shallow
depth of field, melancholy solitude, palette of rose-quartz pink,
dust-grey, and deep indigo, cinematic color grade, Kodak Portra 800
film grain, volumetric haze --ar 21:9 --v 7 --style raw
--no cartoon, text, watermark, extra limbs, blurry
```

### Example 2 — anime override

```
user> /image a swordswoman on a rainy Tokyo rooftop --tool niji --style anime --ar 2:3

detected style: anime (override honored)
ar:             2:3
tool:           niji

output ↓

A determined young swordswoman with ink-black hair and a crimson
scarf, standing on a neon-lit Tokyo rooftop in heavy rain, puddles
reflecting magenta and cyan signs, katana held low, dynamic action
pose, cinematic anime key visual, soft cel shading with painterly
backgrounds, Makoto Shinkai atmosphere, palette of deep teal,
neon-magenta, rain-silver --ar 2:3 --niji 6 --style expressive
--no 3D, photo, extra fingers, malformed hands, watermark
```

### Example 3 — DALL-E (prose, no flags)

```
user> /image a cozy reading nook with a cat --tool dalle

detected style: illustration
ar:             1:1 (DALL-E 3 native)
tool:           dalle

output ↓

A warm, cozy reading nook nestled under a large window, soft afternoon
sunlight streaming in and pooling on a worn velvet armchair. A sleepy
orange tabby cat curls on a stack of leather-bound books, and a ceramic
mug of tea steams on a small wooden side table. The style is a gentle
storybook watercolor illustration with soft edges, muted autumn palette
of rust, cream, and forest green, and a feeling of quiet contentment.
Square aspect ratio.
```

---

## 5. Non-goals (v1)

- **No image generation.** We never call an image API. Just emit prompt text.
- **No multi-tool fanout.** One tool per invocation. User re-runs for each format.
- **No Song Creation.** Deferred to v2+.
- **No Interactive Story RPG.** Deferred to v2+.
- **No persistent prompt history.** Ephemeral stdout only (see open questions).
- **No style-library authoring** (user-defined styles). v2+.
- **No web UI / preview.** CLI text output only.
- **No rate limiting / caching.** One LLM call, no caching layer in v1.

---

## 6. Rollout plan

- Ship on `main` directly. Additive feature; zero impact if unused.
- No migration, no config flag, no opt-in.
- README gets a new "Creative" section; `/help` output lists `/image`.
- Announce in changelog + one sentence in next release notes.
- No feature flag — if it lands, it's on.

---

## 7. Interaction with existing features

- **LLM client:** reuses `ctx.llmClient` from the existing `CommandContext`.
  No new provider; whatever the user has configured (Anthropic, OpenAI,
  Copilot, etc.) is what generates the expanded prompt.
- **Memory:** no read or write for v1. Creative output is not persistent state.
- **Rules / Identity:** no interaction. The prompt engineer persona is
  self-contained in the template's `systemPrompt`; it does not read the
  user's identity doc or rules.
- **Skills:** `/image` is a native command, not a skill. It does not
  register with the skill engine.
- **Discoverability:** added to `/help`, README (new "Creative" section),
  and release notes.

---

## 8. Open questions

1. **Clipboard:** should output auto-copy to the user's clipboard?
   Requires platform detection (`pbcopy` on macOS, `xclip`/`wl-copy` on
   Linux, PowerShell `Set-Clipboard` on Windows). Nice UX but adds
   platform code — punt to v1.1? **ASSUMPTION:** print to stdout only in v1.
2. **Prompt history:** should emitted prompts be stored in memory so the
   user can `/image --history` or `/image --replay 3`? Crosses the
   "no persistent state" line from decision 2.9 — revisit in v2.
3. **User-defined styles:** should there be a style library the user
   builds up over time (`/image --style my-signature`, where
   `my-signature` is a user-saved template)? Natural v2 feature; out
   of scope for gateway.
4. **Copyright / safety:** the system prompt says "Never invent celebrity
   names or copyrighted IP" — is that sufficient? Should we also strip
   known IP strings from user input? **ASSUMPTION:** trust the LLM for v1,
   revisit if we see bad outputs.
5. **Negative-prompt defaults:** do we let users append their own negatives
   (`--no "green, text"`)? Easy to add, but scope creep for v1.
6. **Model / aspect-ratio version drift:** Midjourney flags change (`--v 6`
   → `--v 7` → …). Who owns keeping flags current? **ASSUMPTION:** hard-code
   in `formatters.ts` and bump in a point release when tools upgrade.
7. **Evaluation:** how do we know the generated prompts are *good*? No
   automated eval in v1 — manual spot-check on release. Golden-set eval
   is a v1.1 candidate.

---

## 9. Implementation size estimate

| File | LOC (est) |
|---|---|
| `src/commands/image.ts` | ~60 |
| `src/image/templates.ts` | ~70 (7 styles × ~10 LOC each) |
| `src/image/detector.ts` | ~25 |
| `src/image/formatters.ts` | ~50 (4 tools × ~12 LOC each) |
| `test/commands-image.test.ts` | ~40 |
| `test/image-templates.test.ts` | ~20 |
| `test/image-detector.test.ts` | ~20 |
| **total** | **~285 LOC** |

Within the ~200-300 LOC strawman budget.

---

## 10. Success criteria (v1)

- `/image <desc>` returns a usable Midjourney prompt in one shot for a
  majority of reasonable inputs (manual spot-check on 20 seed inputs).
- Style detection picks the "right" style for 80%+ of the seed set.
- Zero impact on existing commands, tests, or startup time.
- A non-dev user can install aman-agent, type `/image cyberpunk cat`,
  paste the output into Midjourney, and get something they like — within
  their first session.

That last bullet is the gateway hypothesis: **can one creative command pull
a non-dev user in, so they stick around to discover `/memory`, `/rules`,
`/skills`?** This spec ships the minimum needed to test that.
