# MaxMSP MCP Server (personal fork)

This project provides MCP tools for programmatic Max/MSP patch manipulation.

> This is a personal fork on top of the ersatzben fork. Personal-fork additions and code-review checklist live in [`CHANGES.md`](CHANGES.md). The README explains the full fork heritage.

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

**After code changes**: Reload js objects in Max (double-click to open editor, then close) and restart node.script (`script stop`, `script start`).
