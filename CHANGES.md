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

## Test status

| Path | Status |
|------|--------|
| `get_object_attributes(varname)` augmentation | ✅ Verified end-to-end with `riseDial` (live.dial, parameter-enabled) — returned correct `parameter_info`. Edge cases verified: `uiLblPort` (live.comment, no params) and `obj-23` (scale, plain object) correctly omit `parameter_info`. |
| `get_parameter_info(varname)` | ⚠ Code in place; not yet tested via MCP. The Python MCP server needs a restart for the new tool schema to register. The underlying helper is the same one used by the verified `get_object_attributes` augmentation. |
| `list_parameters()` | ⚠ Same as above — code in place, not yet tested via MCP. Uses `current_patcher.apply(...)` which is the standard iteration pattern used elsewhere in the file. |

To finish testing the two new tools: restart the MCP server (cycle Claude Code or re-register), then call `get_parameter_info("riseDial")` and `list_parameters()` in a session with `Everest_OSC.amxd` (or any M4L device) as the current patcher.

---

## Future work suggested

- Set/write side: an analogous `set_parameter_property(varname, key, value)`. Per the upstream gap log, `set_object_attribute("_parameter_*", ...)` silently fails — likely needs a different Max API (message-based attribute setting, e.g. `obj.message("_parameter_shortname", value)`). Worth a follow-up probe.
- Augment `get_objects_in_patch` to also include `parameter_info` per box — would make patch dumps self-describing for M4L work. Trivial extension once the helper is in v8.
- Fix the v8 nav-sync silent-failure (item 1 above). Could send the patcher's filepath in addition to its name and have v8 cross-check against `parentpatcher` walks before giving up.
