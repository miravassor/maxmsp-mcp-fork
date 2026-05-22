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
- Fix the v8 nav-sync silent-failure (Known Issues item 1). Each iteration costs ~30 seconds of "click Everest_OSC to front" workaround. Could send the patcher's filepath in addition to its name and have v8 cross-check against `parentpatcher` walks before giving up.
- Exercise the remaining `_parameter_*` write keys (ranges, modmode, initial, units) and confirm each persists. Likely all work the same way, but worth a quick batch test before relying on them.
- `set_parameter_properties_batch(varname, dict)` — convenience tool that takes a dict of key/value pairs and applies them in one round trip. Useful when reconfiguring a parameter wholesale.
