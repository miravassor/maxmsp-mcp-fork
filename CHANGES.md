# Personal fork changes

This document tracks what this fork adds on top of the [ersatzben/maxmsp-mcp](https://github.com/ersatzben/maxmsp-mcp) upstream. It's intended as a code-review checklist — every file touched, every code location to inspect, and the reasoning behind design choices.

For the user-facing summary, see [README.md → This fork's additions](README.md#this-forks-additions-m4l-parameter-access).

---

## Branch

`full_param_access` — branched from upstream `main` at commit `4f0e037` ("fixing MCP registration issue, updating readme").

## Goal

Read access to Max-for-Live parameter metadata (`_parameter_*` attributes on `live.*` boxes). These are hidden from `obj.getattrnames()` so the existing `get_object_attributes` couldn't reach them. Writes (setting parameter properties) are explicitly out of scope for this iteration.

## Empirical finding that drove the design

`obj.getattr("_parameter_<key>")` works directly in V8, even though the keys are absent from `getattrnames()`. `ParameterInfoProvider` (the documented API) was tried first and rejected — it hung on parameter-enabled boxes during probing, and didn't return anything direct getattr couldn't already supply. The final implementation uses only direct getattr.

Verified keys (each returned real values on `riseDial`, `live.numbox`, `live.text` in the `Everest_OSC.amxd` device, 2026-05-22):
- `_parameter_shortname`, `_parameter_longname`, `_parameter_type`, `_parameter_range`, `_parameter_initial`, `_parameter_initial_enable`, `_parameter_unitstyle`, `_parameter_units`, `_parameter_modmode`, `_parameter_steps`, `_parameter_invisible`, `_parameter_exponent`, `_parameter_linknames`
- `parameter_enable`, `parameter_mappable`

Confirmed-NOT-real (returned `undefined`/`null`): `_parameter_mmin`, `_parameter_mmax`, `_parameter_enum`, `_parameter_unitstyle_custom`, `_parameter_info`, `_parameter_initial_active`, `_parameter_modulation_color`, and all non-underscore variants like `parameter_shortname`.

`_parameter_type` encoding observed: `0`=Int (live.numbox), `1`=Float (live.dial), `2`=Enum (live.text — `_parameter_range` returned the list of enum item names instead of `[min, max]`).

---

## Files changed

### `server.py` (+71 lines)

| Location | Change |
|----------|--------|
| `get_object_attributes` (≈line 684) | Docstring updated to mention `parameter_info` sub-dict. Body unchanged — still forwards to Max-side handler. |
| New tool: `get_parameter_info(varname)` (after `get_object_attributes`) | Thin async wrapper sending `{"action": "get_parameter_info", "varname": ...}`. Returns `{varname, maxclass, is_parameter, parameter_info}`. |
| New tool: `list_parameters()` (after `get_parameter_info`) | Async wrapper sending `{"action": "list_parameters"}`. Returns `{parameters: [...], count: N}`. 10s timeout in case the patcher has many parameters. |

### `MaxMSP_Agent/max_mcp.js` (smaller diff — refactor + dispatcher additions)

| Location | Change |
|----------|--------|
| Dispatcher `case "get_object_attributes"` | Unchanged — still calls `get_object_attributes(...)`. |
| Dispatcher: two new cases (`get_parameter_info`, `list_parameters`) | Both forward directly to v8 via `outlet(2, ...)`. Pattern matches existing v8-routed actions. |
| Function `get_object_attributes(...)` body | **Rewritten as a forwarder**: now just `outlet(2, "get_object_attributes", request_id, var_name)`. The actual logic moved to v8 so the parameter-info merge happens there. |

Why move to v8: the parameter-info helper (`build_parameter_info`) is in v8, and routing the whole tool through v8 avoids cross-engine round-tripping for the merge.

### `MaxMSP_Agent/max_mcp_v8_add_on.js` (+136 lines)

All new code lives between the existing `autofit_v8` function and what would have been the original file end. The dispatcher (in `anything()`) gets three new cases before the `default:`.

| Location | Change |
|----------|--------|
| Dispatcher: cases `get_object_attributes`, `get_parameter_info`, `list_parameters` | Each calls the matching `*_v8` function below. |
| `PARAM_INFO_KEYS` constant | The 13 `_parameter_*` keys empirically verified as accessible. Add to this list if more are discovered. |
| `build_parameter_info(obj)` helper | Returns the parameter-info dict for a box, or `null` if `parameter_enable != 1`. Wraps every `getattr` call in `try/catch` and skips null/undefined values. Single source of truth for parameter introspection — all three tools call into this. |
| `get_object_attributes_v8(request_id, var_name)` | Builds the same attribute dict the old max_mcp.js version did (loop over `getattrnames`), then attaches `parameter_info` if the box is parameter-enabled. Uses `split_long_string` for chunked emit. |
| `get_parameter_info_v8(request_id, var_name)` | Single-box read. Returns `{varname, maxclass, is_parameter, parameter_info}`. |
| `list_parameters_v8(request_id)` | Iterates `current_patcher.apply(...)`, runs the helper on every box, returns a list of entries for parameter-enabled boxes with varnames. Skips unnamed parameters (the MCP can't address them anyway). |

### `README.md` (+47 lines, restructured)

| Section | Change |
|---------|--------|
| Title + intro | Rewritten to reflect "personal fork on top of ersatzben/maxmsp-mcp on top of tiianhk's original". Fork heritage block at top makes the layering explicit. |
| New section: "This fork's additions (M4L parameter access)" | High-level user-facing description of what this fork adds. Links here for code review. |
| Renamed: "What's New in This Fork" → "Upstream fork additions (ersatzben)" | Same content as before (the +11 tools, safety features, QoL) — just relabelled so it's clear those aren't this fork's work. |
| Query Tools table (in "MCP Tools Reference") | Added `get_parameter_info` and `list_parameters`; updated `get_object_attributes` description. Followed by a blurb explaining the `_parameter_*` introspection. |
| Acknowledgements | Now credits both the original repo and the ersatzben fork. |

### `CLAUDE.md` (+7 lines)

Added a short M4L parameter-introspection block under "MCP Tools" pointing to the three relevant tools. Kept tight — CLAUDE.md is for agent guidance, detailed changes belong here.

### `MaxMSP_Agent/demo.maxpat` (±69 lines) — **NOT INTENTIONAL**

Max touched this file during the JS/v8 reload cycles in this session (probably window position / focus state, or auto-save). **Review this diff before committing**: `git diff MaxMSP_Agent/demo.maxpat` to check whether anything substantive was changed; `git restore MaxMSP_Agent/demo.maxpat` if you want to drop it.

### `CHANGES.md` (this file) — new

Tracks personal-fork changes for future review.

---

## Probe code (temporary, removed)

During development, a `probe_parameters(varname)` tool existed to map which API surfaces which fields. It was removed before this changelog was written. The empirical findings it produced are summarized in the "Empirical finding that drove the design" section above. If you ever need to re-run the probe, the design pattern is recoverable from git history (search for `PROBE_PARAM_KEYS` in the v8 add-on).

---

## Known issues discovered along the way (NOT fixed in this PR)

These are observations from the debug cycle that are worth filing but out of scope here:

1. **v8 `nav_switch_to_patcher` silently fails** when Max isn't the foreground app. `v8_find_any_wind()` returns null (cannot read `max.frontpatcher`), the switch is skipped, no error is raised. Workaround during testing: bring the target patcher window to front manually before `switch_to_patcher` calls.
2. **Max symbol length limit** is enforced silently. Any v8 outlet emit that exceeds it gets dropped without throwing. The codebase already uses `split_long_string` for known-large responses; new code that emits via `outlet(1, "response", ...)` should follow that pattern. This bit the probe before it was fixed.
3. **`[console]` object requirement** for `get_max_console` remains friction — the device patchers we worked with (Everest_OSC.amxd, demo.maxpat) didn't have it, making post()-based debugging unavailable.

---

## Engineering notes for future MCP edits

Cross-cutting gotchas that bit us repeatedly. If you're adding a tool to this MCP, internalize these first:

### v8 `current_patcher` resets on every reload

Every time `max_mcp_v8_add_on.js` is reloaded in Max (double-click → close editor), its module-scope `var current_patcher = this.patcher;` re-runs. `this.patcher` is the immediate parent (e.g. a `run-agent` bpatcher inside `demo.maxpat`) — NOT whatever you'd most-recently navigated to. The v8 side then doesn't know about any prior `switch_to_patcher` call.

**Implication for testing**: after reloading v8, the very next call must be `switch_to_patcher(...)` (or equivalent nav) to re-sync. Otherwise tools that depend on `current_patcher` look up varnames in the wrong patcher and return "Object not found".

**Implication for fix candidates**: making v8 re-sync on reload would require persisting nav state outside the JS module (Max globals, a `coll`, etc.) and re-reading on init. Not done. Related to known-issue #1 above.

### Cross-engine value passing via `outlet(2, ...)`

`max_mcp.js` (classic JS engine) routes some actions to `max_mcp_v8_add_on.js` (V8 engine) via `outlet(2, ...)`. Max-symbol atoms only natively carry primitive types — bare lists and nested objects decompose or get coerced at the boundary.

**Rule**: when a tool needs to forward a complex value (list, dict, nested), `JSON.stringify` it on the max_mcp.js side before outlet, and `JSON.parse` it on the v8 side on receipt. See `set_parameter_property`'s `value` arg for the canonical example. Primitive values (strings, numbers) pass through cleanly without stringify and don't need this.

The existing `complete_signal_safety` / `add_boxtext_*` chunked-transfer paths use the same pattern for the same reason — large/nested payloads always stringify across `outlet(2, ...)`.

### When adding a new MCP tool — the four-file template

A new tool requires:

1. **`server.py`** — `@mcp.tool() async def name(ctx, args...)`. Build a `payload = {"action": "...", ...}` dict and `await maxmsp.send_request(payload, timeout=...)` (or `send_command` for fire-and-forget). Return the response.
2. **`max_mcp.js`** — add a `case "action_name":` in the `anything()` dispatcher. Either inline the logic OR forward to v8 via `outlet(2, "action_name", request_id, ...args, [JSON.stringify(complex_value)])`.
3. **`max_mcp_v8_add_on.js`** — if v8-routed, add a `case "action_name":` in v8's dispatcher and the implementing function. Always emit responses via `outlet(1, "response", split_long_string(JSON.stringify(result), 2500))` — the chunked emit is required for any response that could exceed ~16KB (the Max symbol budget per outlet emit).
4. **Documentation** — README's tool table, CLAUDE.md if it's a user-facing pattern, CHANGES.md if it's part of an in-progress fork iteration.

### Reload sequence after MCP code changes

When you've edited the MCP source:
1. **Restart the Python MCP server** (typically requires Claude Code restart since FastMCP doesn't hot-reload). Without this, new Python-side tools won't appear in the agent's tool list.
2. **Reload `js max_mcp.js` in Max**: double-click the `js` object → close its editor. Max re-reads the file.
3. **Reload `v8 max_mcp_v8_add_on.js` in Max**: same procedure on the `v8` object.
4. **`script stop`, `script start`** on the `node.script` if you've touched anything node-bridge-related.
5. **Bring the target patcher window to front** before any `switch_to_patcher` call, to work around known-issue #1.
6. **Call `switch_to_patcher(...)`** to re-sync v8's `current_patcher` after the v8 reload.

Skipping any of these can produce silent "everything looks normal but tools fail mysteriously" symptoms. We hit each of them at least once during iterations 1 and 2.

### Deliberate departures from documented Max JS API patterns

An audit against https://docs.cycling74.com/apiref/ flagged two places where this code chooses a pragmatic path over the documented one. Both are intentional — record them here so a future maintainer doesn't "fix" them without context.

**1. Direct `obj.getattr("_parameter_*")` instead of `ParameterInfoProvider`.**
The docs describe `ParameterInfoProvider` (https://docs.cycling74.com/apiref/js/parameterinfoprovider/) as the canonical API for M4L parameter introspection. We rejected it during the iteration-1 probe because it **hung** when called on parameter-enabled boxes in this Max version (9.1.4 + V8 + an M4L device). Direct `getattr`/`setattr` on the underscore-prefixed keys works empirically and is what's currently in use.

Open question: the v8 nav-sync silent-failure (known-issues #1) was only fully diagnosed AFTER we rejected PIP, so PIP's hang might have been a symptom of v8 scanning the wrong patcher rather than a PIP bug per se. Worth a clean re-test in a future iteration with v8 properly synced before any conclusion is drawn. For now: direct getattr is the load-bearing path; PIP is documented but not used.

**2. `JSON.stringify` over `outlet(2, ...)` instead of `Dict` / `outlet_dictionary()`.**
The docs describe `outlet_dictionary()` (v8-only) and named `Dict` objects as the canonical way to pass structured data between Max JS objects. We use JSON-stringified strings instead, because:
- `max_mcp.js` runs the classic `js` engine, which has no `outlet_dictionary`. Routing from classic → v8 via Dict would need both ends to use named Dict objects.
- The existing fork uses the JSON-string-via-outlet pattern throughout (`add_boxtext`, `complete_signal_safety`, `complete_encapsulate`). Following the same pattern keeps the codebase coherent.
- A Dict-based rewrite is a substantial pipeline change with no clear correctness benefit.

If a future iteration migrates everything to v8 (retiring the classic-JS `max_mcp.js`), revisiting this with `outlet_dictionary` would be idiomatic. Not justified for the current architecture.

---

## Test status

| Path | Status |
|------|--------|
| `get_object_attributes(varname)` augmentation | ✅ Verified end-to-end with `riseDial` (live.dial, parameter-enabled) — returned correct `parameter_info`. Edge cases verified: `uiLblPort` (live.comment, no params) and `obj-23` (scale, plain object) correctly omit `parameter_info`. |
| `get_parameter_info(varname)` | ✅ Used in iteration 2 to verify the write side's readback. Confirmed working on `riseDial`. |
| `list_parameters()` | ⚠ Code in place; not yet exercised via MCP, but shares the same helper that the verified paths use. Uses `current_patcher.apply(...)` which is the standard iteration pattern used elsewhere in the file. |

---

# Iteration 2 — Parameter writes (`set_parameter_property`)

## Branch

`set_param_property` — branched from `main` at the merge of `full_param_access` (commit `125da8f`).

## Goal

Write access to the same `_parameter_*` family iteration 1 made readable. Lets agents programmatically set device-strip shortnames, automation longnames, ranges, modulation modes, etc. without leaving the chat.

## Empirical finding that drove the design

`obj.setattr("_parameter_shortname", "RiseTest")` on a `live.dial` WORKS — both updates runtime state and persists to the saved `.amxd` after Cmd+S (verified by grep on the binary file). The prior [`maxmsp-mcp-tool-reliability`](file:///Users/alexandrev/.claude/projects/-Users-alexandrev-max-files/memory/maxmsp-mcp-tool-reliability.md) memory's "silently fails" observations were on the **non-underscore** form (`parameter_shortname`) and/or on `function`/`live.tab` objects — different surface, didn't generalize.

The probe (since removed) tried 5 mechanisms in sequence: `setattr`, `obj.message(key, value)` with underscore key, `obj.message(key_no_underscore, value)`, direct JS property assignment, and `obj.message("attr_set", key, value)`. `setattr` worked on attempt 1; subsequent mechanisms ran on the already-set value (inconclusive but unneeded). On-disk persistence confirmed by `grep -ao '"parameter_shortname": "ProbeTest"' Everest_OSC.amxd` after Cmd+S.

Note: Max stores the saved attribute under the **non-underscore** name (`parameter_shortname`) in the JSON, but the JS API uses the **underscore** form (`_parameter_shortname`) for both `getattr` and `setattr`. Both name spaces map to the same backing storage.

## Files changed (iteration 2)

### `server.py`

| Location | Change |
|----------|--------|
| New tool: `set_parameter_property(varname, key, value)` (after `list_parameters`) | Async wrapper sending `{"action": "set_parameter_property", "varname": ..., "key": ..., "value": [...]}`. Returns `{varname, key, requested_value, applied_value, actual_value, success, threw, error, note}`. Value is always a list (matches `set_object_attribute` pattern); v8 unwraps single-element lists before calling setattr. |

### `MaxMSP_Agent/max_mcp.js`

| Location | Change |
|----------|--------|
| Dispatcher: new case `set_parameter_property` | Forwards to v8 via `outlet(2, ...)`. Crucially **JSON-stringifies the value** before forwarding, so lists / nested types survive the Max outlet symbol boundary. v8 parses back on receipt. |

### `MaxMSP_Agent/max_mcp_v8_add_on.js`

| Location | Change |
|----------|--------|
| Dispatcher: new case `set_parameter_property` | Parses the JSON-stringified `value` arg back into a JS value before calling `set_parameter_property_v8`. |
| `SETTABLE_PARAM_KEYS` constant | Whitelist of allowed keys = `PARAM_INFO_KEYS` (the iteration-1 read list) plus `parameter_enable` and `parameter_mappable`. Anything else → structured error pointing at `set_object_attribute`. |
| `set_parameter_property_v8(request_id, varname, key, value)` | Single function. Validates key against whitelist; looks up box; unwraps single-element lists; calls `obj.setattr(key, setval)` in a try/catch; reads back via `obj.getattr(key)`; returns `success=true` iff the readback matches the applied value. Includes a `note` field reminding the caller to Cmd+S to persist. |

### `README.md`

- "New MCP tools (+2)" → "(+3)" with `set_parameter_property` added.
- Object Properties table gets a new row.

### `CLAUDE.md`

- Added `set_parameter_property` to the M4L parameter-introspection list.

### `CHANGES.md` (this file)

- This Iteration 2 section.

## Probe code (temporary, removed)

`probe_parameter_write(varname, key, test_value)` existed during development to find the working mechanism. Removed before commit. The findings are baked into the implementation above.

## Test status (iteration 2)

| Path | Status |
|------|--------|
| `set_parameter_property` happy path | ✅ Verified `set_parameter_property("riseDial", "_parameter_shortname", ["RiseTest"])` → `success: true`, `applied_value: "RiseTest"`, `actual_value: "RiseTest"`. |
| Whitelist | ✅ Verified `set_parameter_property("riseDial", "not_a_real_key", ["x"])` rejected with a structured error listing the allowed keys. |
| Disk persistence | ✅ Verified earlier in the probe phase: `setattr("_parameter_shortname", "ProbeTest")` + Cmd+S produced a `.amxd` whose embedded JSON contained `"parameter_shortname": "ProbeTest"` (matched via `grep -ao` on the binary file). The set tool uses the same code path. |
| Other `_parameter_*` keys (range, modmode, initial, etc.) | ⚠ Not individually verified — only `_parameter_shortname` was exercised end-to-end. The setattr code path is uniform, but quirks per key are possible (e.g., `_parameter_range` for Enum types is a list, not `[min, max]`). |

---

## Future work suggested

- Augment `get_objects_in_patch` to also include `parameter_info` per box — would make patch dumps self-describing for M4L work. Trivial extension once the helper is in v8.
- Exercise the remaining `_parameter_*` write keys (ranges, modmode, initial, units) and confirm each persists. Likely all work the same way, but worth a quick batch test before relying on them.
- `set_parameter_properties_batch(varname, dict)` — convenience tool that takes a dict of key/value pairs and applies them in one round trip. Useful when reconfiguring a parameter wholesale.

---

# Iteration 3 — Full 38-tool audit & bug fixes (2026-05-24)

## Goal

Systematic audit of every MCP tool against a live Max 9 sandbox (M4L Audio Effect). Test each tool for correctness, silent failures, data corruption, and unexpected side effects. Cross-reference against official Cycling '74 API docs.

## Method

Tested all 38 tools on `sandbox.amxd` in this order: read-only tools (baseline state), validation gates (11 rejection paths), write operations (create → verify → modify → verify → cleanup → verify restoration). Full report in `AUDIT_2026-05-23.md`.

## Bugs found and fixed

Seven bugs discovered. All fixed in commit `75e30cb`, verified live before commit.

### BUG 1 — `list_open_patchers` `is_current` always false

**Root cause** (`max_mcp.js:867`): `p === current_patcher` used JavaScript object identity. `wind.assoc` returns a fresh patcher wrapper on each traversal — not the same object reference stored by `switch_to_patcher`.

**API evidence**: Official docs say `wind.assoc` returns a `Patcher` (read-only) with no identity guarantee across calls.

**Fix**: Compare by `p.name === current_patcher.name && p.filepath === current_patcher.filepath`.

### BUG 2 — `get_objects_in_patch` `patching_rect` format inconsistency

**Root cause** (`max_mcp.js:1198`): Used `obj.rect` directly (documented as `[l,t,r,b]`) but labeled the field `patching_rect` (convention is `[l,t,w,h]`). `get_object_attributes` (via v8's `getboxattr`) returns `[l,t,w,h]` — two tools returned incompatible formats for the same field name.

**API evidence**: Official docs: `rect` is `"(left, top, right, bottom)"`.

**Fix**: Convert `obj.rect` from `[l,t,r,b]` to `[l,t,w,h]` in `collect_objects()`. Both tools now return consistent `[left, top, width, height]`.

### BUG 3 — `get_avoid_rect_position` no output for empty patchers

**Root cause** (`max_mcp.js:1237`): `l/t/r/b` stay `undefined` when 0 objects exist. `JSON.stringify([undefined,...])` → `[null,...]`.

**Fix**: Default to `[0, 0, 0, 0]` when no objects found.

### BUG 4 — `set_presentation_mode` doesn't update `openinpresentation`

**Root cause** (`max_mcp.js:966`): `thispatcher.presentation` changes the view but doesn't update the patcher attribute. `get_patcher_context` reads the attribute, not the view state.

**API evidence**: Official thispatcher docs: `presentation` — "will cause the patcher to enter or exit presentation mode" (view toggle, not attribute write). `openinpresentation` is undocumented as a patcher attribute.

**Fix**: Add `current_patcher.setattr("openinpresentation", mode)` after the thispatcher message.

### BUG 5 — `dirty` always false after programmatic changes

**Root cause** (`max_mcp.js:1064`): Reads `wind.dirty` which only tracks GUI edits, not JS API changes.

**API evidence**: Official thispatcher docs provide explicit `dirty`/`clean` messages: "sets the patch's dirty bit in the window."

**Fix**: Added `mark_dirty()` helper that sends `thispatcher dirty` message. Called after every write action via a `WRITE_ACTIONS` dispatch table at the end of `anything()`. Also refactored `save_patcher`/`set_presentation_mode` to use shared `get_or_create_thispatcher()`.

### BUG 6 — `object_count` off-by-1

**Root cause**: `get_patcher_context` used `patcher.count` (all objects including hidden `maxmcpid_save_tmp`). `get_objects_in_patch` filters `maxmcpid_*` out.

**Fix**: Subtract hidden `maxmcpid_*` objects from the count.

### BUG 7 — `set_parameter_property` soft failure on non-parameter objects

**Root cause**: No `parameter_enable` pre-check. `setattr` proceeds silently, readback returns null, user gets vague error.

**Fix**: Added `parameter_enable` check in `set_parameter_property_v8` before attempting setattr. Returns clear error immediately.

## Other changes in this iteration

- **Skill rewrite** (`.claude/skills/maxmsp/SKILL.md`): Added missing validation gates (svf~, onepole~, comb~, times~, inverse math), complete 38-tool reference table, M4L parameter introspection section, signal processing guards, empty-patcher fallback. Removed fixed-bug workarounds after fixes were verified.
- **GAPS.md**: Added N4-N8 as fixed items, updated §1.3 and §1.5 with BUG 4/5 fixes.

## Test status (iteration 3)

| Path | Status |
|------|--------|
| 38/38 tools tested | ✅ All functional |
| 11 validation gates | ✅ All correct (no false accepts or rejects) |
| 7 bug fixes verified live | ✅ All confirmed working after JS reload |
| Regression after fixes | ✅ Object creation, connections, parameter writes, format consistency all verified |
| Data integrity | ✅ Sandbox restored to exact original state after full test cycle |

---

# Iteration 4 — M4L device build + bug fixes (2026-05-24)

## Goal

End-to-end stress test: build a real Max for Live Audio Effect device (`sandbox.amxd`) using maximum MCP tool coverage, verifying each call's behavior and output. Document bugs found and fix them.

## Device built: Stereo Filter Delay

A complete M4L Audio Effect with:
- `plugin~` → `[p delay_fx]` subpatcher → `plugout~` stereo signal chain
- 4 `live.dial` M4L parameters: Delay Time (10–1000ms), Feedback (0–95%), Filter Cutoff (100–15000 Hz), Dry/Wet (0–100%)
- Inside subpatcher: dual-mono `tapin~/tapout~` delay with `svf~` lowpass filtering per channel, `*~` feedback, `scale`-based control mapping, dry/wet crossfade via `*~` multipliers summed at outlets
- Presentation mode layout for Live device strip
- All parameters configured with shortname, longname, type, range, initial, unitstyle, exponent

## MCP tools exercised

32+ distinct tool types called across ~120 individual calls. Every tool in the skill reference was used except `encapsulate`, `get_object_doc`, `list_all_objects`, `get_objects_in_selected`, `clear_console_buffer`, `clear_max_console`, `get_max_console`.

## Bugs found and fixed

### Bug 1 — `add_subpatcher_io` rejects `inlet~`/`outlet~` (FIXED)

`max_mcp.js:1102` guard only accepted `"inlet"` and `"outlet"`, with a comment claiming "they auto-detect signal vs message." Verified against official docs: `inlet` and `inlet~` are **distinct Max object classes** — `inlet` is message-only, `inlet~` is signal-only. No auto-detection.

**Fix:** Accept all 4 io_types: `inlet`, `outlet`, `inlet~`, `outlet~`. Removed incorrect comment.

### Bug 2 — `_parameter_type` Float via setattr clamps `_parameter_range` to 255 span (DOCUMENTED)

Setting `_parameter_type` to 1 (Float) via `setattr` triggers an internal side effect that clamps `_parameter_range` max to `min + 255`. This happens regardless of `_parameter_steps` or ordering. The official docs say Float type has "no range restriction" — but that applies to the Inspector/patcher JSON layer (`saved_attribute_attributes`), not the runtime `setattr` API.

**Key finding:** keeping `_parameter_type` as 0 (Int) allows arbitrary range spans via `setattr`. Int type does NOT enforce the documented 256-value limit through this API. The correct approach for wide ranges:
1. Keep `_parameter_type` as Int (0) — do NOT change to Float
2. Set `_parameter_range` to the desired [min, max]
3. Use `_parameter_unitstyle` for display formatting (2=ms, 3=Hz, 5=%)

**Not an MCP bug** — Max runtime behavior. Workaround applied to the device.

### Bug 3 — `check_signal_safety` false positive on valid delay feedback (FIXED)

Both instances of the feedback loop detector (in `run_signal_safety_for_add_object` and `check_signal_safety`) only excused loops where `tapout~` was the **direct predecessor** of `tapin~`. Standard delay feedback routes through intermediate processing (filter, gain): `tapout~ → svf~ → *~ → tapin~`. These were flagged as dangerous.

**Fix:** Changed both detectors to check for `tapin~` AND `tapout~` **anywhere** in the cycle path, not requiring direct adjacency.

## Files changed (iteration 4)

### `max_mcp.js`

| Location | Change |
|----------|--------|
| `add_subpatcher_io` (~line 1102) | Accept `inlet~`/`outlet~` in addition to `inlet`/`outlet` |
| `run_signal_safety_for_add_object` (~line 512) | Check for tapin~/tapout~ pair in cycle, not direct adjacency |
| `check_signal_safety` (~line 1536) | Same fix as above |

## Test status (iteration 4)

| Path | Status |
|------|--------|
| `add_subpatcher_io` with `inlet~`/`outlet~` | ✅ Created successfully, verified via `get_object_attributes` (text shows `inlet~`/`outlet~`) |
| `check_signal_safety` on delay feedback loop | ✅ Returns `safe: true` with tapin~/tapout~/svf~/*~ in loop |
| `set_parameter_property` wide ranges with Int type | ✅ [10, 1000] and [100, 15000] both succeed |
| Full device (sandbox.amxd) | ✅ Saved, 4 parameters configured, presentation mode set up |

---

# Iteration 5 — `configure_parameter` bug fixes (2026-05-24)

## Goal

Test and fix `configure_parameter`, the batch parameter-write tool added in iteration 4's `max_mcp_v8_add_on.js`. Two bugs found and fixed.

## Bugs found and fixed

### BUG 1 — `configure_parameter` `properties` param typed as `str` instead of `dict`

**Root cause** (`server.py:815`): `properties` was annotated as `str` with a `json.loads()` parsing step. MCP sends JSON natively — the value arrives as a pre-parsed dict, not a string. Pydantic rejected every call with `Input should be a valid string`.

**Fix:** Changed `properties: str` → `properties: dict`, removed the redundant `json.loads()` step and error handling.

### BUG 2 — Float clamp warning never fires on clamped range

**Root cause** (`max_mcp_v8_add_on.js:922`): Warning checked `(r[1] - r[0]) > 255` but after Float-type clamping the resulting span is exactly 255 (e.g., requested [0, 500] → actual [0, 255]). The `>` missed this case.

**Fix:** Changed `> 255` → `>= 255`.

## Files changed (iteration 5)

### `server.py`

| Location | Change |
|----------|--------|
| `configure_parameter` (~line 815) | `properties: str` → `properties: dict`; removed `json.loads()` parsing |

### `MaxMSP_Agent/max_mcp_v8_add_on.js`

| Location | Change |
|----------|--------|
| `configure_parameter_v8` Float clamp warning (~line 922) | `> 255` → `>= 255` |

## Test status (iteration 5)

| Path | Status |
|------|--------|
| Happy path (3 properties) | ✅ All `success: true` |
| Smart ordering (type before range) | ✅ `_parameter_type` applied first regardless of input order |
| Invalid key rejection | ✅ `bogus_key` rejected, valid keys still applied |
| Missing object | ✅ Returns `"error": "Object not found"` |
| Float clamp detection | ✅ Range [0,500] clamped to [0,255], `success: false`, warning fires |
| Float clamp warning text | ✅ "Float type clamps _parameter_range to 255 span…" |
| Restore after tests | ✅ All parameters restored to original values |
