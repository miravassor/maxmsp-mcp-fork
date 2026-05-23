# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

MCP server that lets LLMs programmatically create and manipulate Max/MSP patches via the Model Context Protocol. Personal fork on top of the ersatzben fork, adding M4L parameter introspection.

- Per-iteration history + engineering notes: [`CHANGES.md`](CHANGES.md)
- Open gaps, status, prioritization: [`GAPS.md`](GAPS.md)
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
5. Bring the target patcher window to front before calling `switch_to_patcher(...)` (workaround for v8 nav-sync bug — GAPS.md §N1)
6. Call `switch_to_patcher(...)` to re-sync v8's `current_patcher` after v8 reload

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

- `server.py` (1200 lines) — Python FastMCP server. Defines all MCP tools, handles validation (float enforcement, dial rejection, trigger acknowledgment, etc.), and communicates with Max via Socket.IO.
- `max_mcp_node.js` — Node.js bridge inside Max's `node.script`. Relays Socket.IO messages between the Python server and the Max-side JS objects.
- `max_mcp.js` (1800 lines) — Classic JS engine (`js` object). Main dispatcher: handles most operations inline, forwards v8-dependent ones via `outlet(2, ...)`.
- `max_mcp_v8_add_on.js` (800 lines) — V8 engine (`v8` object). Handles operations needing `obj.boxtext` (encapsulate, autofit) and M4L parameter introspection (`_parameter_*` attrs).

### Communication patterns

`server.py` uses two patterns for Max communication:

- **`send_command(payload)`** — fire-and-forget. Used for write-only operations (`remove_object`, `connect_objects`, `set_object_attribute`, etc.). No response expected.
- **`send_request(payload, timeout)`** — request/response with futures. Used when the tool needs data back (`get_objects_in_patch`, `add_object`, `get_parameter_info`, etc.). Each request gets a UUID; the Max side emits a `response` event matched by `request_id`.

### Cross-engine forwarding (classic js → v8)

`max_mcp.js` routes to v8 via `outlet(2, "action_name", request_id, ...args)`. Complex values (lists, dicts) must be `JSON.stringify`'d before the outlet and `JSON.parse`'d on the v8 side — bare lists decompose into separate Max atoms at the symbol boundary. See `set_parameter_property` and `complete_signal_safety` for the pattern.

**Max symbol length limit**: outlet emits with a string atom over ~16KB silently drop. Use `split_long_string(JSON.stringify(result), 2500)` for any potentially-large v8 response.

### Adding a new MCP tool — four-file template

1. **`server.py`** — `@mcp.tool() async def name(ctx, args...)`. Build `payload = {"action": "...", ...}`, call `send_request` (or `send_command`), return response.
2. **`max_mcp.js`** — `case "action_name":` in the `anything()` dispatcher. Inline the logic or forward to v8.
3. **`max_mcp_v8_add_on.js`** — if v8-routed: `case "action_name":` in dispatcher + implementing function. Emit via `outlet(1, "response", split_long_string(...))`.
4. **Documentation** — README tool table, CLAUDE.md if user-facing, CHANGES.md for iteration tracking.

## Critical rules for patch manipulation

**Run `/maxmsp` skill before creating or modifying patches** — it contains all placement rules, object gotchas, and tool usage guidelines that MUST be followed.

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

Object manipulation: `get_avoid_rect_position()`, `add_max_object()`, `recreate_with_args()`, `move_object()`, `autofit_existing()`.

M4L parameter introspection (read + write):
- `get_object_attributes(varname)` — also returns `parameter_info` sub-dict for parameter-enabled boxes
- `get_parameter_info(varname)` — narrow read of just the `_parameter_*` metadata
- `list_parameters()` — enumerate every Live parameter in the current patcher
- `set_parameter_property(varname, key, value)` — write a `_parameter_*` attribute (whitelisted keys; persists to `.amxd` after Cmd+S)

These surface `_parameter_shortname`, `_parameter_longname`, `_parameter_type`, `_parameter_range`, `_parameter_modmode`, etc. — the M4L attrs that `getattrnames()` hides.

## Max API notes (verified empirically)

Official reference: https://docs.cycling74.com/apiref/

- **`_parameter_*` attrs via getattr/setattr work** on `live.*` boxes with `parameter_enable=1`, even though the keys aren't in `getattrnames()`. The on-disk `.amxd` stores them as `parameter_<key>` (no underscore); the JS API uses the underscore form. Same backing storage.
- **`_parameter_type` values**: `0`=Int, `1`=Float, `2`=Enum (where `_parameter_range` is enum item names), `3`=Blob.
- **`obj.boxtext` is V8-only.** Classic `js` engine doesn't have it — that's why `encapsulate`, `autofit`, and `get_object_attributes` route through v8.
- **`current_patcher.apply(fn)` vs `applydeep(fn)`**: `apply` is current patcher only; `applydeep` recurses into subpatchers. `applyif(fn, predicate)` filters.
- **`this.patcher`** in v8 resets to the containing patcher on every reload — re-sync via `switch_to_patcher` after editing v8 code.
- **`thispatcher` messages in M4L**: anything that touches geometry (`presentation_rect`, `wclose`, etc.) is hazardous (can wipe device layout). The `save` message itself is safe.
- **JSON-stringify over outlet instead of `Dict`/`outlet_dictionary()`**: deliberate choice for consistency between classic js and v8 engines. See CHANGES.md "Deliberate departures" for rationale.
