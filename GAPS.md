# Gaps & friction log

Master list of what this MCP doesn't expose, exposes inconsistently, or makes harder than it should. Status of each gap is tracked here so this repo is self-contained — no external gaps file needed.

For per-iteration history of fixes, see [`CHANGES.md`](CHANGES.md). For the upstream-fork additions vs this fork's additions, see the README.

**Last reviewed: 2026-05-24**

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

`presentation_rect` is a per-BOX attribute, not patcher-level. The patcher's own viewport bounds in an M4L device strip are a Live-level concept and may need LiveAPI to read. Added `openrect` (editor window rect) to `get_patcher_context` as a partial workaround.

### 1.3 ✅ FIXED — Current view mode (Patching vs Presentation)

**Fixed (2026-05-23):** `get_patcher_context` now returns `openinpresentation`, `locked`, `dirty`, `openrect`, `object_count`, `name`, `filepath`.

**Fixed (2026-05-24, audit BUG 4):** `set_presentation_mode` now calls `setattr("openinpresentation")` after the thispatcher message, so `get_patcher_context` reflects the current view state — not just the saved default.

### 1.4 ✅ FIXED — Box `text` field in `get_object_attributes`

**Fixed (2026-05-23):** Added `obj.boxtext` to the attributes dict in `get_object_attributes_v8`. Now returns `text` field matching what `get_objects_in_patch` reports. Closes §3.2.

### 1.5 ✅ PARTIALLY FIXED — Patcher's loadbang / device state

**Fixed (2026-05-23):** `dirty` (unsaved changes) and `locked` state now in `get_patcher_context` via `Wind.dirty` and `Patcher.locked`. Device freeze state and device-type still not exposed (would need LiveAPI).

**Fixed (2026-05-24, audit BUG 5):** `dirty` was always `false` after programmatic changes because `Wind.dirty` only tracks GUI edits. Added `mark_dirty()` helper that sends `thispatcher dirty` message after every write action. `dirty` now correctly reflects MCP modifications.

### 1.7 ⚠️ OPEN — Subpatcher inlet/outlet indices re-map on reposition; parent cords silently shift

Inside a subpatcher (`p` or bpatcher), `inlet`/`outlet` objects are indexed by their **left-to-right x-position**, NOT creation order. When `move_object` is called on one of those objects, the indices recompute. The parent's existing cords attached to that wrapper box DO NOT follow the moved object — they stay attached to the same INDEX, which now means a different outlet object.

Net effect: reordering outlets via `move_object` silently rotates which parent cords carry which payload. Symptoms: "the bpatcher is wired but everything goes to the wrong destination." Bit us twice this session — once when the outlets got positioned right-to-left initially, and again after a `move_object` that thought it was un-rotating things but actually shifted them by one position because the cords didn't follow.

Fix candidates: (a) when `move_object` is called on an `inlet`/`outlet` inside a subpatcher with live parent cords, WARN that indices may shift; (b) on `move_object`, auto-rewrite the parent's cord src/dst indices so cords follow the moved object visually (hard — Max may not expose this); (c) document loudly in the skill.

### 1.8 ✅ FIXED — `set_object_attribute` silently no-ops for several patcher-level attributes

**Fixed (2026-05-23):** Root cause was same as §1.6 — `getattrnames()` returns inner-patcher attrs for bpatchers, so box-level attrs like `presentation`, `hidden` weren't found. `set_object_attribute` now falls back to `getboxattrnames()`/`setboxattr()` when the attribute isn't in the object-level list.

Note: `openinpresentation` is a patcher-level attribute (not a box attribute), so it may still require the thispatcher workaround. The `setboxattr` path handles box-wrapper attrs like `presentation`, `presentation_rect`, `hidden`, `patching_rect`.

### 1.6 ✅ FIXED — Bpatcher outer-box attributes not exposed

**Fixed (2026-05-23):** Root cause discovered via API doc audit — Max has separate `getattr`/`getboxattr` APIs. `getattr` reads the object's attributes (inner patcher for bpatchers); `getboxattr` reads the box wrapper's attributes (presentation_rect, hidden, etc.). Added `getboxattrnames()`/`getboxattr()` pass in `get_object_attributes_v8` — outer-box attrs now appear under a `box_attrs` sub-dict. Also fixed `set_object_attribute` to fall back to `setboxattr` when `getattrnames` doesn't include the requested attribute (fixes §1.8 write-side).

Related Max behavior (NOT an MCP gap): `jpatcher` and `bpatcher`, typed as class names, resolve to the **same underlying class**. `obj.maxclass` returns `"patcher"` (generic), `obj.getattr("maxclass")` returns `"jpatcher"` (inner patcher).

---

## 2. Missing writes

### 2.1 ✅ FIXED — Save the patcher

**Fixed (2026-05-23):** Added `save_patcher` tool. Creates a temporary `thispatcher` object in `current_patcher`, sends it the `save` message, then removes it. The temp object uses the `maxmcpid` varname prefix so `collect_objects` skips it. Equivalent to Cmd+S. Safe in M4L — `thispatcher save` doesn't touch geometry.

### 2.2 ✅ FIXED — Set box `text` content directly

**Fixed (2026-05-23):** Closed by §3.1 fix. `add_max_object` now calls `obj.message("set", args)` after creation for `live.comment` (in addition to `message`, `comment`, `flonum`).

### 2.3 ✅ FIXED — Set parameter properties

Previously: `set_object_attribute("_parameter_*", ...)` silently failed per the upstream memory. Iteration-2 work in this fork found that `obj.setattr("_parameter_<key>", value)` (underscore-prefixed) actually works and persists to the saved `.amxd` — the previous "fails" observations were on the non-underscore form on `function`/`live.tab`.

**Surfaced by**: `set_parameter_property(varname, key, value)`. Whitelisted to the `_parameter_*` family. Implementation: `max_mcp_v8_add_on.js` `set_parameter_property_v8` + `SETTABLE_PARAM_KEYS`. Iteration 2 in CHANGES.md.

### 2.4 ✅ FIXED — Toggle Presentation mode view

**Fixed (2026-05-23):** Added `set_presentation_mode(mode)` tool. Uses `thispatcher presentation 0/1` (verified against docs — safe, doesn't touch geometry). Reuses the same `maxmcpid_save_tmp` thispatcher object as `save_patcher`.

### 2.5 ✅ FIXED — Rename varnames (scripting names)

**Fixed (2026-05-23):** Added `rename_object(varname, new_varname)` tool. Sets `obj.varname = new_varname` with collision check via `getnamed` — fails if `new_varname` is already taken.

---

## 3. Inconsistencies

### 3.1 ✅ FIXED — `live.comment` text args silently dropped

`add_max_object(obj_type="live.comment", args=["My label"])` previously produced a box with **empty** `text` field. Args were silently discarded because `live.comment` defines no arg-consuming text contract.

**Fixed (2026-05-23):** Added `live.comment` to the post-creation `set` dispatch in `add_object` (line 392) and to the `text` attr handling in `set_object_attribute` (line 639). Both now route `text` through `obj.message("set", args)`. Also fixed a missing `return` in `set_object_attribute` that caused the `text` set to fall through to "Attribute not found". Pairs with §4.4.

### 3.2 ✅ FIXED — `get_object_attributes` vs `get_objects_in_patch` content divergence

**Fixed (2026-05-23):** Closed by §1.4 fix. Both tools now return `text`.

### 3.3 ✅ FIXED — `get_object_connections` vs `get_objects_in_patch` lines list

**Fixed (2026-05-23):** Root cause was a single-pass design: `collect_objects` assigned varnames and collected patchlines in one `apply()` pass. If `apply()` visited source A before destination B, and B had no varname yet, the A→B patchline was skipped (`dstobject.varname` was empty). Split into two passes: `assign_varnames` (names all unnamed objects) then `collect_objects` (collects boxes + patchlines). Both `get_objects_in_patch` and `get_objects_in_selected` use the two-pass approach.

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

### 4.4 ✅ FIXED — `set_object_attribute` for `text` on `live.comment`

**Fixed (2026-05-23):** Added `live.comment` to the special-case list in `set_object_attribute` and added a missing `return` after the `set` call (previously fell through to "Attribute not found"). Pairs with §3.1.

### 4.5 🔄 OPEN — Position no-op on existing `function` / `bpatcher`

Memory `[feedback-maxmcp-position-quirk]` flags that `set_object_attribute` for `presentation_rect` / `patching_rect` / `presentation_position` / `patching_position` on existing `function` or `bpatcher` objects silently no-ops. The call reports success but the value doesn't update in Max.

Note: this is a Max behavior, not an MCP bug. The MCP could detect by reading back and warning. Workaround already documented: use `move_object` (which writes via `obj.rect`) or `recreate_with_args` instead of `set_object_attribute`.

---

## ⚠️ NEW — Discovered during this fork's work

These were not in the upstream gaps file but bit us during iterations 1 and 2.

### N1 ✅ FIXED — v8 `nav_switch_to_patcher` silently fails when Max isn't foreground

`v8_find_any_wind()` returned null when `max.frontpatcher` was null because the fallback used `this.patcher` inside a function — which doesn't resolve to the Max JS context in v8 (unlike classic js where `this` always refers to `jsthis`).

**Fixed (2026-05-23):** Added `root_patcher` variable (captured at module scope where `this.patcher` works) and used it in `v8_find_any_wind` instead of `this.patcher`. Mirrors the `root_patcher` pattern already in `max_mcp.js`. The `bringtofront` fallback now actually reaches a window.

### N2 ⚠️ DOCUMENTED — Max outlet symbol length limit silently drops large payloads

Any v8 `outlet()` emit with a string atom exceeding ~16KB gets dropped without throwing. The receiver waits forever, the MCP times out.

**Workaround in current code**: `split_long_string(JSON.stringify(result), 2500)` for any response that could exceed the limit. Documented in CHANGES.md "Engineering notes" → "When adding a new MCP tool — the four-file template". `add_boxtext`, `complete_signal_safety`, `get_object_attributes_v8`, `get_parameter_info_v8`, `list_parameters_v8` all follow this pattern.

### N3 ⚠️ DOCUMENTED — v8 `current_patcher` resets on every reload

Every time `max_mcp_v8_add_on.js` is reloaded, its module-scope `var current_patcher = this.patcher;` re-runs, dropping any previous nav state. The next call must re-sync via `switch_to_patcher(...)`.

**Documented in**: CHANGES.md "Engineering notes" → "v8 `current_patcher` resets on every reload".

### N4 ✅ FIXED — `list_open_patchers` `is_current` always false

**Discovered (2026-05-23, audit BUG 1):** `collect_all_patchers()` used `p === current_patcher` (JavaScript object identity) to set `is_current`. Window chain traversal returns fresh patcher wrapper objects that don't `===` match the stored reference, even for the same underlying patcher.

**Fixed (2026-05-24):** Compare by `p.name + p.filepath` instead of `===`.

### N5 ✅ FIXED — `get_objects_in_patch` `patching_rect` format inconsistency

**Discovered (2026-05-23, audit BUG 2):** `collect_objects()` used `obj.rect` directly (documented as `[l,t,r,b]`) but labeled the output field `patching_rect` (convention is `[l,t,w,h]`). Meanwhile `get_object_attributes` returned `patching_rect` as `[l,t,w,h]` via `getboxattr`. The two tools returned incompatible formats for the same field.

**Fixed (2026-05-24):** Convert `obj.rect` from `[l,t,r,b]` to `[l,t,w,h]` in `collect_objects()`. Both tools now return consistent `[left, top, width, height]`.

### N6 ✅ FIXED — `get_avoid_rect_position` returns null for empty patchers

**Discovered (2026-05-23, audit BUG 3):** When a patcher has 0 objects, `l/t/r/b` stay `undefined`. `JSON.stringify([undefined,...])` → `[null,...]`, which the Python server couldn't handle.

**Fixed (2026-05-24):** Default to `[0, 0, 0, 0]` when no objects are found.

### N7 ✅ FIXED — `object_count` off-by-1 vs `get_objects_in_patch`

**Discovered (2026-05-23, audit BUG 6):** `get_patcher_context` used `patcher.count` (includes ALL objects) while `get_objects_in_patch` filters out `maxmcpid_*` system objects. The hidden `maxmcpid_save_tmp` thispatcher caused a +1 discrepancy.

**Fixed (2026-05-24):** Subtract hidden `maxmcpid_*` objects from the count.

### N8 ✅ FIXED — `set_parameter_property` soft failure on non-parameter objects

**Discovered (2026-05-23, audit BUG 7):** Calling `set_parameter_property` on an object without `parameter_enable=1` would attempt `setattr`, get null readback, and return a vague "Readback differs" error.

**Fixed (2026-05-24):** Added `parameter_enable` pre-check in `set_parameter_property_v8`. Returns a clear error immediately.

### N9 ✅ FIXED — `add_subpatcher_io` rejects `inlet~` / `outlet~` signal I/O types

**Discovered (2026-05-24):** `add_subpatcher_io` only accepted `"inlet"` and `"outlet"`, silently rejecting `"inlet~"` and `"outlet~"` with an incorrect comment ("they auto-detect signal vs message"). Official docs confirm `inlet` and `inlet~` are distinct classes — no auto-detection.

**Fixed (2026-05-24):** Guard now accepts all 4 io_types.

### N11 ✅ FIXED — `configure_parameter` rejects all calls (Pydantic validation error)

**Discovered (2026-05-24):** `configure_parameter` in `server.py` typed `properties` as `str` with a `json.loads()` parsing step. MCP sends JSON natively — the value arrives as a pre-parsed dict. Pydantic rejected every call with "Input should be a valid string."

**Fixed (2026-05-24):** Changed `properties: str` → `properties: dict`, removed redundant `json.loads()`.

### N12 ✅ FIXED — `configure_parameter` Float clamp warning never fires

**Discovered (2026-05-24):** The Float+wide-range warning in `configure_parameter_v8` checked `(r[1] - r[0]) > 255`. After Float-type clamping, the resulting span is exactly 255 (e.g., [0, 500] → [0, 255]). The strict `>` missed this boundary case.

**Fixed (2026-05-24):** Changed `> 255` → `>= 255`.

### N10 ✅ FIXED — `check_signal_safety` false positive on delay feedback with intermediate objects

**Discovered (2026-05-24):** The feedback loop detector only excused cycles where `tapout~` was the **direct predecessor** of `tapin~`. Standard delay feedback routes through intermediate processing (`tapout~ → svf~ → *~ → tapin~`), which was incorrectly flagged as dangerous. Both `run_signal_safety_for_add_object` and `check_signal_safety` had this bug.

**Fixed (2026-05-24):** Changed both detectors to check for `tapin~` AND `tapout~` anywhere in the cycle path.

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

### 5.8 `_parameter_type` Float via `setattr` clamps `_parameter_range` to 255 span

Setting `_parameter_type` to 1 (Float) via `setattr` triggers an internal side effect that clamps `_parameter_range` max to `min + 255` on all `live.*` objects. The official docs say Float type has "no range restriction" — that applies to the Inspector/patcher-JSON layer, not the runtime `setattr` API.

**Workaround:** keep `_parameter_type` as 0 (Int) when using `setattr` — Int type does NOT enforce the 256-value limit through this API. Use `_parameter_unitstyle` for display formatting (2=ms, 3=Hz, 5=%). Set range first, never change type to Float after.

Bit us this session: users couldn't submit OSC address changes because Enter just added a return line.

### 5.9 `jpatcher` and `bpatcher` are class aliases

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

## Prioritization (as of 2026-05-24)

Remaining open (all low severity):
- **§1.2** patcher presentation_rect — needs LiveAPI, not solvable via JS API alone.
- **§1.7** inlet/outlet index remapping — Max behavior; best we can do is warn.
- **§4.2** `[console]` auto-install — has trade-offs (modifies patcher state).
- **§4.5** position no-op on `function`/`bpatcher` — Max behavior; can detect and warn.

Fixed 2026-05-23 (17 items): §4.3, §3.4, §3.1, §4.4, §1.4, §3.2, §3.3, §N1, §2.1, §2.2, §1.6, §1.8, §2.4, §2.5, §1.3, §1.5, plus API doc audit covering 19 pages.

Fixed 2026-05-24 (7 items from full 38-tool audit): §N4 is_current, §N5 patching_rect format, §N6 empty patcher avoid_rect, §N7 object_count off-by-1, §N8 set_parameter_property pre-check, plus §1.3 openinpresentation sync (BUG 4), §1.5 dirty flag (BUG 5). See `AUDIT_2026-05-23.md` for full report.

Fixed 2026-05-24 (2 items from configure_parameter testing): §N11 properties type mismatch, §N12 Float clamp warning threshold.
