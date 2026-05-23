# Gaps & friction log

Master list of what this MCP doesn't expose, exposes inconsistently, or makes harder than it should. Status of each gap is tracked here so this repo is self-contained — no external gaps file needed.

For per-iteration history of fixes, see [`CHANGES.md`](CHANGES.md). For the upstream-fork additions vs this fork's additions, see the README.

**Last reviewed: 2026-05-22**

## Legend

- ✅ **FIXED** in this fork — link to the implementing tool / commit
- 🔄 **OPEN** — still a gap
- ⚠️ **NEW** — gap discovered during this fork's work (not in original upstream gaps)
- 🚫 **REFERENCE ONLY** — Max behavior, not an MCP gap (kept here for context)

---

## 1. Missing reads

### 1.1 ✅ FIXED — `_parameter_*` attributes of `live.*` parameter objects

The M4L parameter metadata (`_parameter_shortname`, `_parameter_longname`, `_parameter_type`, `_parameter_range`, `_parameter_initial`, `_parameter_unitstyle`, etc.) determines how a `live.*` control appears in Ableton Live. These keys are hidden from `getattrnames()`.

**Surfaced by**: `get_parameter_info(varname)`, `list_parameters()`, and the new `parameter_info` sub-dict in `get_object_attributes`. Implementation in `max_mcp_v8_add_on.js` (`PARAM_INFO_KEYS`, `build_parameter_info`). Iteration 1 in CHANGES.md.

### 1.2 🔄 OPEN — Patcher-level `presentation_rect`

No way to read the patcher's own `presentation_rect` (the visible area of the device strip in Live). Knowing this would let layout planning respect Live's viewport bounds.

Memory `[feedback-m4l-resize]` says don't *write* to `thispatcher`'s `presentation_rect`, but *reading* should be safe via `patcher.getattr("presentation_rect")` per the audit findings. Low effort if undertaken.

### 1.3 🔄 OPEN — Current view mode (Patching vs Presentation)

No way to know whether the patcher is currently being viewed in Patching or Presentation mode in Max. Useful for diagnosing "I can't see my labels"-type issues — if user is in Patching mode, labels in Presentation only won't show.

### 1.4 🔄 OPEN — Box `text` field in `get_object_attributes`

`get_object_attributes` does not return the box's `text` content. `get_objects_in_patch` does (in the per-box dict, as `"text"`). For classes like `live.comment` where the displayed string lives in the box text (not in an attribute), this means `get_object_attributes` cannot report the label content. See §3.2.

**Note**: this fork's augmented `get_object_attributes` adds `parameter_info` but does NOT yet add `text`. Trivial extension via v8's `obj.boxtext`. Likely next quick-win.

### 1.5 🔄 OPEN — Patcher's loadbang / device state

No way to inspect whether the device is frozen, the device-type field of the containing project, the file's save state, etc. All would help diagnostics.

`patcher.dirty` is trivially accessible via `getattr` (per the audit) and would handle the save-state half cheaply.

### 1.7 ⚠️ OPEN — Subpatcher inlet/outlet indices re-map on reposition; parent cords silently shift

Inside a subpatcher (`p` or bpatcher), `inlet`/`outlet` objects are indexed by their **left-to-right x-position**, NOT creation order. When `move_object` is called on one of those objects, the indices recompute. The parent's existing cords attached to that wrapper box DO NOT follow the moved object — they stay attached to the same INDEX, which now means a different outlet object.

Net effect: reordering outlets via `move_object` silently rotates which parent cords carry which payload. Symptoms: "the bpatcher is wired but everything goes to the wrong destination." Bit us twice this session — once when the outlets got positioned right-to-left initially, and again after a `move_object` that thought it was un-rotating things but actually shifted them by one position because the cords didn't follow.

Fix candidates: (a) when `move_object` is called on an `inlet`/`outlet` inside a subpatcher with live parent cords, WARN that indices may shift; (b) on `move_object`, auto-rewrite the parent's cord src/dst indices so cords follow the moved object visually (hard — Max may not expose this); (c) document loudly in the skill.

### 1.8 ⚠️ OPEN — `set_object_attribute` silently no-ops for several patcher-level attributes

`set_object_attribute("<bpatcher_varname>", "openinpresentation", [1])` reports success but the inner patcher's attribute stays at 0. Same for `varname` rename (the §2.5 case).

Empirically, the working workaround for `openinpresentation` is to:
1. `enter_subpatcher(<bpatcher_varname>)`
2. `add_max_object("thispatcher", varname="...")`
3. `send_messages_to_object("...", ["openinpresentation", 1])`
4. `exit_subpatcher()`

This persists. So the underlying Max mechanism works fine via messages-to-thispatcher; the gap is that `set_object_attribute` doesn't route to it.

Fix candidate: in `set_object_attribute`, when the target is a bpatcher and the attr is one of the inner-patcher-level keys (`openinpresentation`, `gridsize`, `bgcolor`, etc.), route via a temporary thispatcher message rather than a direct `obj.setattr`.

Related: §1.6 (read side of the same problem), §2.5 (varname rename specifically).

### 1.6 ⚠️ OPEN — Bpatcher outer-box attributes not exposed

`get_object_attributes(<bpatcher_varname>)` returns the **inner patcher's** attributes (gridsize, openrect, oscprefix, syntax colors, etc.) — NOT the outer box's attributes that live in the parent patcher (`presentation`, `presentation_rect`, `presentation_position`, `patching_rect`, `hidden`, etc.).

This makes it impossible to read a bpatcher's positioning or visibility state via the MCP. Bit us 2026-05-22 when trying to mirror an existing bpatcher's presentation rect onto a replacement bpatcher — had to ask the user to read the values from the Inspector.

Verified empirically: two bpatchers (one created via `jpatcher`, one via `bpatcher @embed 1`) returned **byte-identical** inner-patcher attribute dumps. Neither dump included `presentation_*` or `patching_rect`. The outer-box attrs only appear in `get_objects_in_patch` (which gives `patching_rect` per box), and even there `presentation_rect` / `presentation` / `hidden` are not returned.

Related Max behavior (NOT an MCP gap): `jpatcher` and `bpatcher`, typed as class names, resolve to the **same underlying class**. What actually distinguishes a usable bpatcher from a useless empty box is the `@embed 1` argument, not the typed name. See user memory `[max-jpatcher-bpatcher-alias]`. `obj.maxclass` returns `"patcher"` (generic), `obj.getattr("maxclass")` returns `"jpatcher"` (inner patcher); neither returns `"bpatcher"`. After the §4.3 fix, `collect_objects` prefers `obj.maxclass` so bpatchers now report as `"patcher"` instead of `"jpatcher"` — marginally better but still not distinguishable from `p` subpatchers without checking other attrs.

Fix candidate: in v8's `get_object_attributes`, detect bpatcher class and ALSO emit the outer box's attribute set (via `obj.box` or whatever the v8 path is to the box wrapper). Or expose them via a dedicated `get_box_attributes` tool. Pairs with §1.2 (patcher-level presentation_rect).

---

## 2. Missing writes

### 2.1 🔄 OPEN — Save the patcher

No save tool. User must Cmd+S manually for Live to pick up changes. Most common end-of-edit operation in M4L workflows.

Memory `[feedback-m4l-resize]` warns against `thispatcher` messages that touch geometry in M4L (resize hazard) — but `thispatcher save` itself doesn't touch geometry, just persists state. Worth verifying in a throwaway device first. Frequency: 5/5 (every iteration).

### 2.2 🔄 OPEN — Set box `text` content directly

The MCP can pass `args` to `add_max_object`, but for objects where args aren't interpreted as text (`live.comment`, see §3.1), there's no way to set the displayed text at creation time. Workaround is `send_messages_to_object(..., ["set", "..."])` *after* creation. Often paired with the §3.1 fix.

### 2.3 ✅ FIXED — Set parameter properties

Previously: `set_object_attribute("_parameter_*", ...)` silently failed per the upstream memory. Iteration-2 work in this fork found that `obj.setattr("_parameter_<key>", value)` (underscore-prefixed) actually works and persists to the saved `.amxd` — the previous "fails" observations were on the non-underscore form on `function`/`live.tab`.

**Surfaced by**: `set_parameter_property(varname, key, value)`. Whitelisted to the `_parameter_*` family. Implementation: `max_mcp_v8_add_on.js` `set_parameter_property_v8` + `SETTABLE_PARAM_KEYS`. Iteration 2 in CHANGES.md.

### 2.4 🔄 OPEN — Toggle Presentation mode view

No tool to put Max into Presentation mode (or out of it) for the current patcher. User must use View menu. Likely `thispatcher presentation 0/1` works but the resize-hazard memory makes us cautious — verify in a throwaway device first.

### 2.5 🔄 OPEN — Rename varnames (scripting names)

No tool to change an existing object's varname. When two objects collide on auto-generated names (see §4.3), the user must rename via Inspector by hand. Trivially `obj.varname = new_name` in Max JS; just needs a tool wrapper with collision detection.

---

## 3. Inconsistencies

### 3.1 🔄 OPEN — `live.comment` text args silently dropped

`add_max_object(obj_type="live.comment", args=["My label"])` runs without error but produces a box with **empty** `text` field. Args are silently discarded because `live.comment` defines no arg-consuming text contract.

Side effects:
- The `patching_rect` width is wider than expected (args briefly affect layout even though they don't stick as displayed text).
- Contrasts with plain `comment`, which DOES consume args as text — user reasonably expects `live.comment` to behave the same.

Fix candidates: (a) detect `live.comment` in `add_max_object` and auto-emit `obj.message("set", args)` after creation; (b) error out at validation time; (c) document loudly.

### 3.2 🔄 OPEN — `get_object_attributes` vs `get_objects_in_patch` content divergence

`get_objects_in_patch` returns the per-box `text` field; `get_object_attributes` doesn't. They show different snapshots of the same object. Pairs with §1.4 — fixing 1.4 closes this.

### 3.3 🔄 OPEN — `get_object_connections` vs `get_objects_in_patch` lines list

After making connections, `get_object_connections` reflects them immediately, but the `lines` array in `get_objects_in_patch` sometimes doesn't include the same patchlines. Observed during the slew investigation (upstream session): `live.text → obj-53` was returned by `get_object_connections` but missing from the `lines` listing. Possibly a serialization timing issue, possibly the auto-naming asymmetry in `collect_objects` (line 1044 skips lines without a destination varname; `get_object_connections` doesn't).

### 3.4 ✅ MOSTLY FIXED — Varname-keyed lookups when varnames collide

`get_object_connections("obj-0")` returns *one* object's connections when two objects share the varname (e.g., a `panel` auto-named `obj-0` colliding with the original `pictslider obj-0`). No warning is raised.

Root of the collision was `collect_objects` in `max_mcp.js` auto-naming unnamed boxes `obj-N` with a counter that resets each invocation. **Fixed (2026-05-23):** collision detection added — `collect_objects` now checks `current_patcher.getnamed("obj-N")` before assigning, skipping names that are already taken. Combined with the §4.3 bpatcher fix, the two main collision vectors are closed.

Remaining edge: `getnamed` returns only the *first* match, so if two objects already share a name (from prior sessions or manual Inspector edits), the MCP still can't distinguish them. Ambiguity warning not yet implemented.

---

## 4. Friction / UX

### 4.1 ✅ NOT A GAP — `add_max_object` preflight requirement is intentional

`add_max_object` requires `get_avoid_rect_position()` to be called first or the call errors with "PREFLIGHT REQUIRED". This was previously flagged as a "drop the preflight" quick win.

**Resolved (2026-05-22):** the `/maxmsp` skill is the reference for placement behavior, and it mandates calling `get_avoid_rect_position()` before every placement ("NEVER skip this step. NEVER guess positions."). The Python-side preflight gate enforces that the skill's rule was actually followed; removing it would create a silent divergence between skill and runtime. Kept as-is.

If the avoid rect's "whole occupied area" output is awkward in dense layouts, the answer is to read `get_objects_in_patch()` and place explicitly — not to drop the preflight.

### 4.2 🔄 OPEN — `[console]` object requirement for `get_max_console`

`get_max_console` doesn't work unless a custom `[console]` JS abstraction is present in the patcher, and the error tells the user to paste a max5 patcher snippet from base64. Significant friction for a tool that should be passively available.

Fix candidate: bundle the listener with the MCP itself (programmatically inject the `[console]` object via `current_patcher.newdefault(..., "console")` on first call). M4L hazard concern: modifies the patcher; trade-off needs care.

### 4.3 ✅ FIXED — Auto-generated varnames collide / bpatcher varnames clobbered

Two bugs in `collect_objects` (`max_mcp.js`):

**Bug 1 — bpatcher scripting name destruction (DESTRUCTIVE).** `collect_objects` used `obj.getattr("varname")` to read scripting names. For bpatcher/jpatcher boxes, `getattr` routes through the **inner patcher's** attribute space (same root cause as §1.6) and returns null — even when the outer box has a scripting name. The code then wrote `obj.varname = "obj-N"`, **overwriting the real scripting name** on every `get_objects_in_patch` call. Symptoms: varname changes between reads (counter resets, apply order shifts), user-set names don't stick, `enter_subpatcher` fails because `getnamed` can't find the clobbered name.

**Fix (2026-05-23):** Changed `obj.getattr("varname")` → `obj.varname` (direct property access). This reads the outer box's scripting name correctly for all object types. Same change applied to `out.dstobject.varname` for patchline destination lookup. The rest of the codebase (`get_object_connections`, `recreate_with_args`, v8 add-on) already used `obj.varname`.

**Bug 2 — counter-based collisions.** The `obj_count` counter reset to 0 on every call. When `apply()` visits a new unnamed object before existing auto-named ones, it assigns `obj-0` which another object already has.

**Fix (2026-05-23):** Added `while (current_patcher.getnamed("obj-" + obj_count))` loop before assigning, skipping names that are already taken. Pairs with §3.4.

### 4.4 🔄 OPEN — `set_object_attribute` for `text` on `live.comment`

Even though `text` doesn't appear in `get_object_attributes`'s output for `live.comment`, an attempt to `set_object_attribute(varname, "text", [...])` silently fails (currently posts "Attribute not found" but returns success-ish). Confusing because there's no listed attribute to set.

Fix: add `live.comment` to the special-case list in `set_object_attribute` (alongside `message` and `comment`) so `text` routes to `obj.message("set", value)`. Pairs with §3.1.

### 4.5 🔄 OPEN — Position no-op on existing `function` / `bpatcher`

Memory `[feedback-maxmcp-position-quirk]` flags that `set_object_attribute` for `presentation_rect` / `patching_rect` / `presentation_position` / `patching_position` on existing `function` or `bpatcher` objects silently no-ops. The call reports success but the value doesn't update in Max.

Note: this is a Max behavior, not an MCP bug. The MCP could detect by reading back and warning. Workaround already documented: use `move_object` (which writes via `obj.rect`) or `recreate_with_args` instead of `set_object_attribute`.

---

## ⚠️ NEW — Discovered during this fork's work

These were not in the upstream gaps file but bit us during iterations 1 and 2.

### N1 ⚠️ OPEN — v8 `nav_switch_to_patcher` silently fails when Max isn't foreground

`v8_find_any_wind()` returns null when Max isn't the active app (`max.frontpatcher` is null), so `v8_find_patcher_by_name` returns null, and v8's `current_patcher` doesn't switch. No error is raised; subsequent lookups in v8 look up varnames in the wrong patcher.

**Workaround during development**: bring the target patcher window to front in Max before calling `switch_to_patcher(...)`.

**Fix candidates**: send the patcher's filepath in addition to its name and have v8 cross-check via `parentpatcher` walks; or force a `bringtofront` of any window with `wind` available before reading `max.frontpatcher`.

### N2 ⚠️ DOCUMENTED — Max outlet symbol length limit silently drops large payloads

Any v8 `outlet()` emit with a string atom exceeding ~16KB gets dropped without throwing. The receiver waits forever, the MCP times out.

**Workaround in current code**: `split_long_string(JSON.stringify(result), 2500)` for any response that could exceed the limit. Documented in CHANGES.md "Engineering notes" → "When adding a new MCP tool — the four-file template". `add_boxtext`, `complete_signal_safety`, `get_object_attributes_v8`, `get_parameter_info_v8`, `list_parameters_v8` all follow this pattern.

### N3 ⚠️ DOCUMENTED — v8 `current_patcher` resets on every reload

Every time `max_mcp_v8_add_on.js` is reloaded, its module-scope `var current_patcher = this.patcher;` re-runs, dropping any previous nav state. The next call must re-sync via `switch_to_patcher(...)`.

**Documented in**: CHANGES.md "Engineering notes" → "v8 `current_patcher` resets on every reload".

---

## 5. 🚫 Max quirks (not MCP-fault, reference only)

These are kept here so the gaps file is self-contained. NOT items to fix in the MCP — they're Max behaviors useful to know when patching.

### 5.1 `pictslider` `set` vs `int`

`set <X> <Y>` updates the visual without retriggering output, while a bare `<X> <Y>` list both updates and outputs. Easy infinite-loop trap if you wire `pictslider` → some processing → back to `pictslider` without the `set` prefix.

### 5.2 OSC bundles and `udpreceive`

Max's `udpreceive` auto-decodes OSC bundles into individual list messages when not given a `full-packet` symbol argument. Single messages also come out as lists. So a Python sender using OSC bundles "just works" with a default `udpreceive` — no CNMAT `OSC-route` needed for the basic case.

### 5.3 `unpack` outputs right-to-left

The float value comes out *before* the symbol in `unpack s 0.`. This is why the standard "address-gated value latch" pattern works without explicit ordering — float gets stored downstream, then `sel` fires.

### 5.4 `live.thisdevice` vs `loadbang`

Use `live.thisdevice` (not `loadbang`) for any init that touches the Live API. The first outlet bangs when the Live API is ready, which isn't necessarily at `loadbang` time.

### 5.5 `---` prefix for per-instance unique symbols

Max for Live mangles symbols starting with `---` to be unique per device instance. Use this prefix on `send`/`buffer~`/`coll` names to avoid namespace collisions between multiple instances of the same device.

### 5.6 `pattr @bindto` does NOT fire pattr's outlet on bound-value change

`pattr /x @bindto someTextedit` keeps the pattr's value in sync with the textedit's content, but pattr's outlet only fires on direct input or `bang`. When the user edits the bound textedit at runtime, pattr's internal value updates but its outlet stays silent. Downstream cords (e.g., `pattr → outlet`) won't propagate the change.

**Workaround**: wire the bound object DIRECTLY to the destination in parallel with the pattr cord. pattr handles init (on `bang`); the direct cord handles runtime edits.

Bit us this session: address-textedit edits weren't retargeting `sel` until we added the parallel `textedit → outlet` cord.

### 5.7 `textedit` `lines = 0` default eats Enter as newline

`textedit` defaults to multi-line mode (`lines = 0`). Enter inserts a newline; the textedit doesn't fire its outlet. For a single-line input that submits on Enter, set `lines = 1`.

Bit us this session: users couldn't submit OSC address changes because Enter just added a return line.

### 5.8 `jpatcher` and `bpatcher` are class aliases

In Max's New Object box, typing `jpatcher` or `bpatcher` instantiates **the same underlying class**. Their attribute dumps via `get_object_attributes` are byte-identical (except an internal UID). What actually distinguishes a usable bpatcher from an empty no-op box is the `@embed 1` argument, NOT the typed class name.

Bit us across two sessions: a `jpatcher` created without `@embed` looked indistinguishable from a working bpatcher but had no inner patcher to enter/edit.

### 5.9 `set_parameter_property("_parameter_initial", x)` may silently clamp to range floor

Observed 2026-05-22: set `_parameter_range = [1024, 65535]`, then `_parameter_initial = 9000` (both reported success). On subsequent read, `_parameter_initial = 1024` (the range floor), not 9000.

Hypothesis: Max applies a clamp pass when the param store is finalized that resets `_parameter_initial` to the range minimum if it doesn't match a re-evaluated default. Possibly only triggered when both range and initial are set in the same MCP burst without a settle between them.

Workaround: read back after setting `_parameter_initial`. If clamped, set it again after a `send_messages_to_object(varname, ["init"])` cycle, or set the param's current value to match (`send_messages_to_object(varname, ["set", X])`).

---

## How to use this file

When the MCP itself gets touched:

1. Pick an item, decide if it's still real (verify empirically — Max version drift can fix or introduce gaps).
2. Implement, then change the status to ✅ and link to the tool/commit.
3. New gaps discovered while working → append to §1-§4 (or as `⚠️ NEW` if discovered in this fork).
4. New Max quirks → §5.

When adding code for a fix, also update `CHANGES.md` per-iteration if it's a meaningful unit of work.

## Prioritization (informal, as of 2026-05-22)

Highest impact-per-effort, next quick wins:
1. **§3.1 + §4.4** `live.comment` text plumbing — two-line fix in the class-dispatch list of `add_max_object` + `set_object_attribute`.
2. **§1.4 + §3.2** add box `text` to `get_object_attributes` — small additive change via v8.

Higher-impact, more involved:
- **§2.1** save tool — frequency 5/5, but needs M4L safety verification first.
- **§N1** v8 nav silent failure — costs ~30 sec/session to work around. Real fix would help every session.
- **§4.3 + §3.4** varname collision cluster — annoying when it bites.

Defer:
- **§4.2** `[console]` auto-install — has trade-offs (modifies patcher state).
- **§2.4** Presentation mode toggle — thispatcher hazard concerns.
- **§4.5** position no-op detection — workaround already documented.
