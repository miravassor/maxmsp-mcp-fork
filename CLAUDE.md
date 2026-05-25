# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

MCP server that lets LLMs programmatically create and manipulate Max/MSP patches via the Model Context Protocol. Personal fork on top of the ersatzben fork, adding M4L parameter introspection.

- Per-iteration history + engineering notes: [`CHANGES.md`](CHANGES.md)
- Open gaps, status, prioritization: [`GAPS.md`](GAPS.md)
- Full 38-tool audit report: [`AUDIT_2026-05-23.md`](AUDIT_2026-05-23.md)
- Fork heritage: see README.

## Development setup

```bash
uv venv && source .venv/bin/activate
uv pip install -r requirements.txt
```

The Python server runs via `uv run server.py` (or through the MCP client). No test suite exists — verification is done empirically against a running Max instance.

### Max-side setup

1. Open `MaxMSP_Agent/demo.maxpat` in Max 9+
2. `script npm install` (once, for socket.io)
3. `script start` to begin Socket.IO communication

### Reload sequence after code changes

All steps needed — skipping any causes silent failures:

1. Restart the Python MCP server (FastMCP doesn't hot-reload; typically restart Claude Code)
2. Reload `js max_mcp.js` in Max: double-click the `js` object, then close its editor
3. Reload `v8 max_mcp_v8_add_on.js` in Max: same procedure on the `v8` object
4. `script stop` then `script start` on `node.script` (if node bridge was touched)
5. Call `switch_to_patcher(...)` to re-sync v8's `current_patcher` after v8 reload

## Architecture

```
Claude Code ←—MCP—→ server.py ←—Socket.IO:5002—→ max_mcp_node.js (Node.js in Max)
                                                        │
                                              ┌─────────┴──────────┐
                                              │                    │
                                         max_mcp.js          max_mcp_v8_add_on.js
                                        (classic js)              (v8)
```

**Four components, two JS engines:**

- `server.py` (~1300 lines) — Python FastMCP server. Defines all MCP tools, handles validation (float enforcement, dial rejection, trigger acknowledgment, etc.), and communicates with Max via Socket.IO.
- `max_mcp_node.js` — Node.js bridge inside Max's `node.script`. Relays Socket.IO messages between the Python server and the Max-side JS objects.
- `max_mcp.js` (~2000 lines) — Classic JS engine (`js` object). Main dispatcher: handles most operations inline, forwards v8-dependent ones via `outlet(2, ...)`.
- `max_mcp_v8_add_on.js` (~960 lines) — V8 engine (`v8` object). Handles operations needing `obj.boxtext` (encapsulate, autofit), M4L parameter introspection, and box-level attribute access (`getboxattr`/`setboxattr`).

### Communication patterns

`server.py` uses two patterns for Max communication:

- **`send_command(payload)`** — fire-and-forget. No longer used by any MCP tool (all upgraded to request/response). Kept for potential future low-risk operations.
- **`send_request(payload, timeout)`** — request/response with futures. Used by **all** MCP tools. Each request gets a UUID; the Max side emits a `response` event matched by `request_id`. Returns structured `{success, ..., error?}`.

### Cross-engine forwarding (classic js → v8)

`max_mcp.js` routes to v8 via `outlet(2, "action_name", request_id, ...args)`. Complex values (lists, dicts) must be `JSON.stringify`'d before the outlet and `JSON.parse`'d on the v8 side — bare lists decompose into separate Max atoms at the symbol boundary. See `set_parameter_property` and `complete_signal_safety` for the pattern.

**Max symbol length limit**: outlet emits with a string atom over ~16KB silently drop. Use `split_long_string(JSON.stringify(result), 2500)` for any potentially-large v8 response.

### Adding a new MCP tool — four-file template

1. **`server.py`** — `@mcp.tool() async def name(ctx, args...)`. Build `payload = {"action": "...", ...}`, call `send_request` (or `send_command`), return response.
2. **`max_mcp.js`** — `case "action_name":` in the `anything()` dispatcher. Inline the logic or forward to v8. If the action modifies the patcher, add it to the `WRITE_ACTIONS` table (triggers `mark_dirty()` automatically).
3. **`max_mcp_v8_add_on.js`** — if v8-routed: `case "action_name":` in dispatcher + implementing function. Emit via `outlet(1, "response", split_long_string(...))`.
4. **Documentation** — README tool table, CLAUDE.md if user-facing, CHANGES.md for iteration tracking.

## Critical rules for patch manipulation

**Run `/maxmsp` skill before creating or modifying patches** — it contains all placement rules, object gotchas, and tool usage guidelines that MUST be followed.

**Use `get_object_doc(name)` before connecting unfamiliar objects** — returns inlet/outlet count, signal types, and argument details from `docs.json` (1128 objects covered).

### Quick reminders (details in skill)

- **CONSIDER SUBPATCHERS** for new functionality
- **NO OVERLAP**: Always call `get_avoid_rect_position()` before placing objects
- **Message boxes**: Use numbers `[200, 0, 50]` not strings `["200", "0", "50"]`
- **Auto-sizing**: Objects & comments auto-size; messages fixed 70px; UI objects keep defaults

### Required flags

- **Math/pack/unpack**: JSON strips `.0` from numbers. Use STRING args to preserve floats: `["0", "127", "0", "25."]`. Use `["f", "f", "f"]` for unpack. Set `int_mode=True` to explicitly allow integers. Exception: `scale` with output range ≤ 2 auto-detects float intent.
- **dial**: Use `dial` with `@size` attribute instead of `live.dial` (set `use_live_dial=True` to bypass). Max `@size 255`; for larger ranges use `flonum`/`number` instead (`extend=True` bypasses).
- **trigger/t**: Set `trigger_rtl=True` — fires right-to-left (`[t b f]` sends `f` first)
- **random**: Set `random_bang=True` — numbers set range, bangs trigger output (use `[t b]` to convert)
- **coll**: Always include `@embed 1` to persist data on save
- **line~**: Messages need an EVEN number of values (target/time pairs); set `not_line_msg=True` to bypass.

### Placement & signal flow

See the `/maxmsp` skill for the placement formula (first object at `y = bottom + 50`; same row `x += prev_width + 25`) and signal-flow rules (MSP inlets auto-sum — don't `+~` to combine signals; connect delay feedback directly to `tapin~`, never through a mixer first).

## Key MCP tools

Object manipulation: `get_avoid_rect_position()`, `add_max_object()`, `recreate_with_args()`, `move_object()`, `autofit_existing()`, `rename_object()`, `remove_max_object()`, `set_object_attribute()`.

Connection management: `connect_max_objects()`, `disconnect_max_objects()`, `get_object_connections()`. All three return structured responses with success/error status.

Patcher operations: `save_patcher()`, `set_presentation_mode()`, `get_patcher_context()` (returns name, filepath, openrect, locked, dirty, object_count, openinpresentation).

Subpatcher navigation: `create_subpatcher()`, `enter_subpatcher()`, `exit_subpatcher()`, `enter_parent_patcher()`, `add_subpatcher_io()`, `switch_to_patcher()`.

Messaging: `set_message_text()`, `send_bang_to_object()`, `send_messages_to_object()`, `set_number()`.

Analysis & reference: `check_signal_safety()` (recursive across subpatchers), `encapsulate()`, `get_object_doc()` (1128 objects in `docs.json`), `get_objects_in_selected()`.

M4L parameter introspection (read + write):
- `get_object_attributes(varname)` — returns object attrs + `box_attrs` sub-dict (outer box) + `parameter_info` sub-dict + `text`
- `get_parameter_info(varname)` — narrow read of just the `_parameter_*` metadata
- `list_parameters()` — enumerate every Live parameter in the current patcher
- `set_parameter_property(varname, key, value)` — write a single `_parameter_*` attribute (whitelisted keys; persists to `.amxd` after save)
- `configure_parameter(varname, properties)` — write multiple `_parameter_*` attributes in one call; smart ordering applies `_parameter_type`/`_parameter_steps` before `_parameter_range` to avoid Float clamp; warns if Float type + wide range detected

These surface `_parameter_shortname`, `_parameter_longname`, `_parameter_type`, `_parameter_range`, `_parameter_modmode`, etc. — the M4L attrs that `getattrnames()` hides.

`_parameter_type` encoding: `0`=Int, `1`=Float, `2`=Enum (where `_parameter_range` is the list of enum item names), `3`=Blob.

## Max API notes (verified against official docs)

Official JS API reference: https://docs.cycling74.com/apiref/js/

**Always check the docs before assuming any API behavior.** A full audit of 19 API pages was done 2026-05-23 — results in the memory file `reference-max-js-api.md`.

### Two attribute APIs: `getattr` vs `getboxattr`
- `obj.getattr(name)` / `obj.getattrnames()` — reads **object-level** attributes
- `obj.getboxattr(name)` / `obj.getboxattrnames()` — reads **box-level** attributes
- For bpatchers: `getattr` reads the inner patcher; `getboxattr` reads the outer box (presentation_rect, hidden, etc.)
- Write equivalents: `obj.setattr()` / `obj.setboxattr()`

### thispatcher messages (NOT the same as JS method names)
Reference: https://docs.cycling74.com/reference/thispatcher
- `write` saves the patcher (NOT `save` — no such message exists)
- `presentation 0/1` enters/exits Presentation mode
- `front` brings window to front
- `dirty` / `clean` set/reset the dirty bit

### Other verified facts
- **`obj.rect`** returns `[left, top, right, bottom]` per the docs. `get_objects_in_patch` converts to `[left, top, width, height]` for consistency with `get_object_attributes` (which reads via `getboxattr("patching_rect")`).
- **`obj.boxtext`** is V8-only — classic `js` engine doesn't have it.
- **`this.patcher`** works at module scope in v8 but NOT inside functions. Use a module-scope `root_patcher` variable instead.
- **`_parameter_*` attrs** work via `getattr`/`setattr` on `live.*` boxes with `parameter_enable=1`, even though hidden from `getattrnames()`. Undocumented but empirically verified. The official API (`ParameterInfoProvider`) was re-tested after the v8 nav fix — it no longer hangs, but returns no data because PIP is scoped to its hosting "patcher hierarchy" (per docs). Our v8 lives in `demo.maxpat`; target devices are separate hierarchies. **Item closed permanently** — direct getattr is the only viable cross-patcher approach.
- **`_parameter_range` + `_parameter_type` interaction**: Setting `_parameter_type` to Float (1) via `setattr` clamps `_parameter_range` to a 255 span. Keep type as Int (0) for wide ranges; use `_parameter_unitstyle` for display formatting (2=ms, 3=Hz, 5=%). See GAPS.md §5.8.
- **`_parameter_modmode` restricted in standalone Max**: Values 1 (Unipolar), 2 (Bipolar), 3 (Additive) silently reset to 0 via `setattr`. Only 0 (None) and 4 (Absolute) persist. Likely requires Ableton Live context for modulation-dependent modes.
- **Spatial ordering is fundamental in Max**: execution order, outlet firing order, and subpatcher inlet/outlet indexing are all determined by the **left-to-right x-position** of objects (per docs: "messages are generated based on the spatial organization of the objects in the patcher"). For inlet/outlet objects inside subpatchers, their x-position directly determines the index on the parent box — there is no separate `index` attribute, position IS the index. Moving an inlet/outlet recomputes all indices; parent cords stay on their original index and silently point to different objects. `move_object` warns when targeting I/O objects.
- **`inlet` vs `inlet~`** are distinct Max object classes. `inlet` handles messages only; `inlet~` handles signals only. No auto-detection. `add_subpatcher_io` accepts all 4 types: `inlet`, `outlet`, `inlet~`, `outlet~`.
- **`wind.dirty`** only tracks GUI edits. The MCP uses `thispatcher dirty` message (via `mark_dirty()`) after write operations to keep it accurate.
- **`apply()` traversal order** is not specified by the docs — do not rely on any particular order.
- **JSON-stringify over outlet** instead of `Dict`/`outlet_dictionary()`: deliberate choice for consistency between classic js and v8 engines. See CHANGES.md "Deliberate departures" for rationale.
