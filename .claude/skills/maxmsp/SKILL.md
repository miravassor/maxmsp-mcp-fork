---
name: maxmsp
description: Critical MaxMSP MCP rules for object placement, gotchas, and tool usage. Invoke before creating/modifying Max patches.
user-invocable: true
disable-model-invocation: false
---

# MANDATORY CHECKLIST - Follow Before EVERY Action

## BEFORE placing ANY object:
```
0. Consider whether the task at hand is best served by using a subpatcher.
1. Call get_avoid_rect_position() FIRST
2. Use returned [left, top, right, bottom] to calculate position
3. Place at y = bottom + 50 (minimum)
```
**NEVER skip this step. NEVER guess positions.**

Empty patcher fallback: if `get_avoid_rect_position()` returns null/empty (no objects yet), start at `[50, 50]`.

---

# Required Acknowledgment Flags

**Math objects** (`+`, `-`, `*`, `/`, `%`, `pow`, `scale`, `!+`, `!-`, `!*`, `!/`) and **pack/pak/unpack**:
- JSON strips `.0` from numbers! Use STRING args: `["0", "127", "0", "25."]`
- Strings with `.` are converted to floats, without `.` to ints
- For unpack, use `["f", "f", "f"]` (type specifier)
- Set `int_mode=True` if integer truncation is intentional
- Exception: `scale` with output range ≤ 2 auto-detects float intent

**dial** - use instead of live.dial, requires `@size`:
- Float 0-1: `['@size', 1, '@floatoutput', 1]`
- Bipolar -1 to 1: `['@min', -1, '@size', 2, '@floatoutput', 1, '@mode', 6]`
  - `@min` is an offset added to the output, not a true minimum
  - `@mode` values: 0=Arc, 1=Indicator, 2=Pie, 3=Classic, 4=Needle, 5=Live, 6=Pan
- Int 0-127: `['@size', 127]`
- @size > 255 rejected (MCP UX limit, not a Max limit) — use `flonum`/`number` for large ranges (bypass with `extend=True`)
- `live.dial` rejected — bypass with `use_live_dial=True` only for M4L parameter integration

**trigger/t** - fires RIGHT-TO-LEFT:
- Set `trigger_rtl=True` to acknowledge
- `[t b f]` sends `f` FIRST, then `b`
- Argument types: `b` (bang), `f` (float), `i` (int), `l` (list), `s` (symbol)

**random** - needs BANG to trigger (numbers only set range):
- Set `random_bang=True` to acknowledge
- Use `[t b]` to convert numbers to bangs before `random`
- Integer range gotcha: `random 10` outputs 0-9 (not 0-10). Float range includes the max.

**coll** - data doesn't persist unless embedded:
- Include `@embed 1` in args: `['mycoll', '@embed', 1]`
- Exception: named colls with external data files — these auto-load from disk by name

---

# Signal Processing Guards

These rejections use the `extend=True` flag to bypass:

- **svf~**: Q/resonance argument ≥ 1 rejected (should be 0-1 range)
- **onepole~**: frequency < 10 Hz rejected (takes Hz, not a coefficient — typical values are 1000-5000)
- **comb~**: requires 5 arguments: `[comb~ maxdelay delay feedback feedforward gain]`
- **times~**: does not exist — use `*~` instead

---

# Signal Flow Rules

**Auto-summing**: MSP inlets automatically sum all incoming signals. Never use `+~` just to combine signals — connect them both to the same inlet instead.

**Delay feedback**: Connect feedback directly to `tapin~`, never through a mixer first.

**Safety check**: Call `check_signal_safety()` after building signal chains. It detects feedback loops, high-gain `*~` (>1.0), unsafe `comb~` feedback (≥1.0), and missing limiters before `dac~`.

---

# Placement Rules

After calling `get_avoid_rect_position()` → `[left, top, right, bottom]`:
- First object: `[left, bottom + 50]`
- Same row: x += previous_width + 25
- New row: x = left, y += 50

Width estimates for horizontal spacing: regular objects ~60px, UI objects ~50px, comments auto-size. Use `get_object_attributes()` to read actual `patching_rect` if precise layout matters.

---

# Subpatchers

**Use subpatchers** for: effects, voices, drums, sequencers, mixers, modulation.

```
create_subpatcher([x, y], "varname", "display_name")
enter_subpatcher("varname")
  get_avoid_rect_position()       -- required even inside subpatchers
  add_subpatcher_io([50, 30], "inlet", "in1", "signal input")
  add_subpatcher_io([50, 300], "outlet", "out1", "signal output")
  -- io_type: "inlet", "outlet", "inlet~", "outlet~"
  -- build internal logic between inlet and outlet
exit_subpatcher()
connect_max_objects("source", 0, "varname", 0)   -- connect from parent
```

Navigation stack tracks depth. `get_patcher_context()` returns current depth, path, name, and metadata.

---

# MCP Tools Reference

## Read-only

| Tool | Purpose |
|------|---------|
| `get_avoid_rect_position()` | **REQUIRED** before placing — returns bounding rect |
| `get_objects_in_patch()` | All boxes and patchlines in current patcher |
| `get_object_attributes(var)` | Full attribute dump + `parameter_info` for M4L params |
| `get_object_connections(var)` | Inputs and outputs for one object |
| `get_object_doc(name)` | Official Max docs for an object type |
| `list_all_objects()` | All available Max object types |
| `get_patcher_context()` | Name, filepath, depth, locked, object_count |
| `list_open_patchers()` | All open patcher windows |
| `get_objects_in_selected()` | Selected objects (patcher must be unlocked) |
| `check_signal_safety()` | Analyze for dangerous signal patterns |
| `get_max_console(lines)` | Read Max console (requires [console] object) |
| `list_parameters()` | All M4L parameters in current patcher |
| `get_parameter_info(var)` | M4L parameter metadata for one object |

## Write — with response

| Tool | Purpose |
|------|---------|
| `add_max_object(pos, type, var, args)` | Create object |
| `move_object(var, x, y)` | Reposition (returns old/new position) |
| `recreate_with_args(var, args)` | Change creation args, preserve connections |
| `rename_object(var, new_var)` | Rename varname (collision-checked) |
| `save_patcher()` | Save to disk (Cmd+S equivalent) |
| `set_presentation_mode(0\|1)` | Toggle patching/presentation view |
| `switch_to_patcher(name)` | Navigate to any open patcher |
| `set_parameter_property(var, key, value)` | Write M4L parameter attribute |
| `encapsulate(varnames, name, var)` | Move objects into new subpatcher |
| `clear_console_buffer()` | Clear internal console ring buffer |

## Write — fire-and-forget (no response)

These return no output. **Verify with a read tool after** if correctness matters.

| Tool | Purpose |
|------|---------|
| `remove_max_object(var)` | Delete object |
| `connect_max_objects(src, out, dst, in)` | Connect two objects |
| `disconnect_max_objects(src, out, dst, in)` | Disconnect two objects |
| `set_object_attribute(var, attr, value)` | Set any attribute |
| `set_message_text(var, list)` | Set message box content |
| `send_bang_to_object(var)` | Send bang |
| `send_messages_to_object(var, msg)` | Send arbitrary message |
| `set_number(var, num)` | Set number/slider/dial value |
| `create_subpatcher(pos, var, name)` | Create p object |
| `enter_subpatcher(var)` | Navigate into subpatcher |
| `exit_subpatcher()` | Return to parent |
| `enter_parent_patcher()` | Navigate above root (for abstractions) |
| `add_subpatcher_io(pos, type, var, comment)` | Add inlet/outlet inside subpatcher |
| `autofit_existing(var)` | Auto-size object to fit text |
| `clear_max_console()` | Clear visual console (buffer untouched) |

---

# Message Boxes

- Use numbers: `[200, 0, 50]`
- NOT strings: `["200", "0", "50"]` (creates literal quotes in Max)
- Default 70px width (user adjusts manually)

**line~ messages** — must have EVEN number of values (target/time pairs):
- `[0, 0, 1, 500, 0, 500]` for instant→0, ramp→1 in 500ms, →0 in 500ms
- Odd count rejected (set `not_line_msg=True` to bypass)

---

# M4L Parameter Introspection

For Max for Live devices with `live.*` objects (live.dial, live.numbox, live.text, etc.):

- `get_object_attributes(var)` returns a `parameter_info` sub-dict with all `_parameter_*` keys
- `get_parameter_info(var)` returns just the parameter metadata
- `list_parameters()` enumerates all parameters in the patcher
- `set_parameter_property(var, key, value)` writes parameter attributes

Allowed keys for `set_parameter_property`: `_parameter_shortname`, `_parameter_longname`, `_parameter_type`, `_parameter_range`, `_parameter_initial`, `_parameter_initial_enable`, `_parameter_unitstyle`, `_parameter_units`, `_parameter_modmode`, `_parameter_steps`, `_parameter_invisible`, `_parameter_exponent`, `_parameter_linknames`, `parameter_enable`, `parameter_mappable`.

`_parameter_type` values: 0=Int, 1=Float, 2=Enum. For Enum, `_parameter_range` is a list of item names.

After writing, call `save_patcher()` to persist changes to the .amxd file.

---

# Known Quirks & Workarounds

**`get_avoid_rect_position()` in empty patchers**: Returns null values. Use `[50, 50]` as starting position.

**`patching_rect` format**: `get_objects_in_patch()` returns `obj.rect` which is documented as `[left, top, right, bottom]`. However, objects freshly created via the MCP return `[left, top, width, height]` until the patcher is saved and reloaded. Both formats can coexist in the same response. Use `get_object_attributes()` for reliable `[left, top, width, height]` via `getboxattr("patching_rect")`.

**`list_open_patchers()` is_current**: Always returns `false` due to a patcher reference identity bug. Use `get_patcher_context()` to check which patcher is current.

**`dirty` flag**: `get_patcher_context()` reports `dirty: false` even after programmatic changes. Max only sets the window dirty flag for GUI edits, not MCP operations.

**`object_count` vs boxes**: `get_patcher_context().object_count` includes hidden MCP system objects. `get_objects_in_patch()` filters them out. Expect a difference of 1.

**Fire-and-forget commands**: `connect_max_objects`, `remove_max_object`, `set_object_attribute`, etc. return no output and cannot report errors. After critical operations, verify with `get_object_connections()` or `get_object_attributes()`.

**`set_presentation_mode`**: Toggles the view but `get_patcher_context().openinpresentation` may not update (reads saved default, not live view state).
