# MaxMSP MCP Server (personal fork)

This project provides MCP tools for programmatic Max/MSP patch manipulation.

> This is a personal fork on top of the ersatzben fork.
> - Per-iteration history + engineering notes: [`CHANGES.md`](CHANGES.md)
> - Open gaps, status, prioritization: [`GAPS.md`](GAPS.md)
> - Fork heritage: see README.

## Critical Rules

**Run `/maxmsp` skill before creating or modifying patches** - it contains all placement rules, object gotchas, and tool usage guidelines that MUST be followed.

### Quick Reminders (details in skill)

- **CONSIDER SUBPATCHERS** for new functionality!
- **NO OVERLAP**: Always call `get_avoid_rect_position()` before placing objects
- **Message boxes**: Use numbers `[200, 0, 50]` not strings `["200", "0", "50"]`
- **Auto-sizing**: Objects & comments auto-size; messages fixed 70px; UI objects keep defaults

### Required Flags

- **Math/pack/unpack**: JSON strips `.0` from numbers. Use STRING args to preserve floats: `["0", "127", "0", "25."]`. Use `["f", "f", "f"]` for unpack. Set `int_mode=True` to explicitly allow integers. Exception: `scale` with output range ≤ 2 auto-detects float intent.
- **dial**: Use `dial` with `@size` attribute instead of `live.dial` (set `use_live_dial=True` to bypass)
- **trigger/t**: Set `trigger_rtl=True` - fires right-to-left (`[t b f]` sends `f` first)
- **random**: Set `random_bang=True` - numbers set range, bangs trigger output (use `[t b]` to convert)
- **coll**: Always include `@embed 1` to persist data on save

## MCP Tools

Key tools for object manipulation:
- `get_avoid_rect_position()` - Get bounding box before placing
- `add_max_object()` - Create object (auto-fits width)
- `recreate_with_args()` - Change creation-time args, preserving connections
- `move_object()` - Reposition object
- `autofit_existing()` - Apply auto-fit to existing object

M4L parameter introspection (read + write):
- `get_object_attributes(varname)` - now also returns a `parameter_info` sub-dict for parameter-enabled boxes
- `get_parameter_info(varname)` - narrow read of just the `_parameter_*` metadata
- `list_parameters()` - enumerate every Live parameter in the current patcher
- `set_parameter_property(varname, key, value)` - write an `_parameter_*` attribute (whitelisted keys; persists to `.amxd` after Cmd+S)

These surface `_parameter_shortname`, `_parameter_longname`, `_parameter_type`, `_parameter_range`, `_parameter_modmode`, etc. — the M4L attrs that `getattrnames()` hides.

## Architecture

- `server.py` - Python FastMCP server with Socket.IO
- `MaxMSP_Agent/max_mcp.js` - Main Max-side JavaScript handler
- `MaxMSP_Agent/max_mcp_v8_add_on.js` - V8 JavaScript with `obj.boxtext` access

**After code changes**: Reload js objects in Max (double-click to open editor, then close) and restart node.script (`script stop`, `script start`). Full reload sequence in [`CHANGES.md`](CHANGES.md) → Engineering notes.

## Max API notes (verified empirically — for when editing the MCP itself)

Official reference: https://docs.cycling74.com/apiref/ — use this as the source of truth for documented APIs (`MaxObj`, `Patcher`, `jsthis`, `Dict`, `ParameterInfoProvider`, etc.). Notes below capture empirical learnings that AREN'T fully documented or that we've verified differ from the docs in practice.

- **`obj.getattr("_parameter_<key>")` / `obj.setattr("_parameter_<key>", value)` work** on `live.*` boxes with `parameter_enable=1`, even though the `_parameter_*` keys aren't in `getattrnames()` and aren't documented. The on-disk `.amxd` stores them as `parameter_<key>` (no underscore); the JS API uses the underscore form. Same backing storage.
- **`_parameter_type` values**: `0`=Int, `1`=Float, `2`=Enum (where `_parameter_range` is the list of enum item names instead of `[min, max]`), `3`=Blob.
- **`ParameterInfoProvider`** is the documented path for parameter introspection but HUNG in our test environment (Max 9.1.4 + V8 + M4L device) during the iteration-1 probe. Direct getattr was used instead. Possible re-test once the v8 nav-sync issue is fixed (it may have been a symptom rather than a PIP bug — see GAPS.md §N1).
- **`obj.boxtext` is V8-only.** Classic `js` engine doesn't have it. That's why operations needing `boxtext` (e.g., `add_boxtext`, `encapsulate`, `get_object_attributes_v8`) route through `max_mcp_v8_add_on.js`.
- **Cross-engine value passing (`outlet(2, ...)` from classic js → v8)**: complex values (lists, nested objects) must be `JSON.stringify`'d on the sender side and `JSON.parse`'d on the receiver. Bare lists decompose into separate atoms at the Max symbol boundary. Existing pattern: `complete_signal_safety`, `set_parameter_property`.
- **Max symbol length limit**: an outlet emit with a string atom over ~16KB silently drops. Use `split_long_string(JSON.stringify(result), 2500)` for any potentially-large response. See `add_boxtext`, `list_parameters_v8` for the pattern.
- **`current_patcher.apply(fn)` vs `applydeep(fn)`**: `apply` is current patcher only (correct for `get_objects_in_patch`, `check_signal_safety`, `list_parameters`); `applydeep` recurses into subpatchers (use when you genuinely want device-wide enumeration). `applyif(fn, predicate)` filters.
- **`this.patcher`** is the read-only Patcher containing the JS object. V8's module-init `var current_patcher = this.patcher` resets to this on every reload — re-sync via `switch_to_patcher` after editing v8 code.
- **`thispatcher` messages in M4L**: anything that touches geometry (`presentation_rect`, `wclose`, etc.) is hazardous in M4L (can wipe device layout). The `save` message itself is safe. See memory `[feedback-m4l-resize]` for the cautionary tale.

The `Dict` / `outlet_dictionary()` path is the documented alternative to the JSON-stringify trick — viable for v8 but not for the classic `js` engine. This codebase deliberately uses JSON-string-via-outlet for consistency between engines (more in CHANGES.md → "Deliberate departures").
