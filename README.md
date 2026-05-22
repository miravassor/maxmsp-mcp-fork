# MaxMSP-MCP Server (Personal Fork — M4L Parameter Access)

This project uses the [Model Context Protocol](https://modelcontextprotocol.io/introduction) (MCP) to let LLMs directly understand and generate Max patches.

> **Fork heritage** (top of stack first):
> - **This fork** — adds M4L parameter introspection ([details below](#this-forks-additions-m4l-parameter-access) and in [`CHANGES.md`](CHANGES.md)).
> - **Upstream** — [ersatzben/maxmsp-mcp](https://github.com/ersatzben/maxmsp-mcp): added subpatcher navigation, encapsulation, signal-safety analysis, and a dozen other tools. The "Upstream fork additions" section below is their work.
> - **Original** — [tiianhk/MaxMSP-MCP-Server](https://github.com/tiianhk/MaxMSP-MCP-Server) by Haokun Tian and Shuoyang Zheng. See [Acknowledgements](#acknowledgements).

---

## This fork's additions (M4L parameter access)

The `_parameter_*` family of attributes — `_parameter_shortname`, `_parameter_longname`, `_parameter_type`, `_parameter_range`, `_parameter_initial`, `_parameter_modmode`, etc. — controls how a `live.*` control appears in Ableton Live (device-strip name, automation label, value range, modulation behaviour). These attributes are **hidden from `getattrnames()`** in Max, so previous tools couldn't read them. This fork adds tools that surface them, plus an additive change to `get_object_attributes`.

See [`CHANGES.md`](CHANGES.md) for the file-by-file breakdown of what changed and where.

### New MCP tools (+3)

| Tool | Description |
|------|-------------|
| `get_parameter_info(varname)` | Read M4L `_parameter_*` metadata for a single box. Returns `is_parameter: false` if the box has `parameter_enable=0`. |
| `list_parameters()` | Enumerate every Live parameter in the current patcher. Returns one entry per parameter-enabled box. |
| `set_parameter_property(varname, key, value)` | Write an M4L parameter property. Whitelisted keys; updates runtime state and persists to the saved `.amxd` after Cmd+S. |

### Changed tools

| Tool | Change |
|------|--------|
| `get_object_attributes(varname)` | Response now includes a `parameter_info` sub-dict for boxes with `parameter_enable=1`. Pure additive — existing consumers see the same fields plus the new one. |

`_parameter_type` values: `0`=Int, `1`=Float, `2`=Enum (where `_parameter_range` is the list of enum item names), `3`=Blob.

---

## Upstream fork additions (ersatzben)

The ersatzben fork significantly extends the original with new tools, safety features, and Claude Code integration. The items below are their work, not this fork's.

### Tools added by upstream (+11)

| Tool | Description |
|------|-------------|
| `create_subpatcher` | Create a new `p` (subpatcher) object |
| `enter_subpatcher` | Navigate into a subpatcher context |
| `exit_subpatcher` | Return to parent patcher |
| `get_patcher_context` | Get current depth and navigation path |
| `add_subpatcher_io` | Add inlet/outlet objects inside subpatchers |
| `get_object_connections` | Query all connections for an object |
| `recreate_with_args` | Change creation-time arguments, preserving connections |
| `move_object` | Reposition an object |
| `autofit_existing` | Apply auto-sizing to existing objects |
| `check_signal_safety` | Analyze patch for dangerous signal patterns |
| `encapsulate` | Encapsulate selected objects into a subpatcher |

### Safety & Validation Features

- **Float enforcement**: Math objects (`+`, `-`, `*`, `/`, `%`, `pow`, `scale`) and pack/unpack objects require float arguments. Use STRING args to preserve floats (JSON strips `.0`): `["0", "127", "0", "25."]`. Use `int_mode=True` to explicitly allow integers. Exception: `scale` with output range ≤ 2 auto-detects float intent.
- **dial range enforcement**: Rejects `live.dial` (suggests `dial` with inline attributes); requires `@size` on `dial` objects; rejects `@size > 255` (unusable UI - use `extend=True` to bypass)
- **trigger/t acknowledgment**: Requires `trigger_rtl=True` flag to confirm understanding that outlets fire right-to-left
- **random acknowledgment**: Requires `random_bang=True` flag to confirm understanding that numbers set range but bangs trigger output
- **coll embed enforcement**: Requires `@embed 1` in args to ensure data persists on save
- **line~ message validation**: Rejects messages with odd numeric count (likely malformed target-time pairs)
- **Object validation**: Rejects invalid objects (e.g., `times~` → suggests `*~`)
- **Argument validation**: Enforces minimum arguments for complex objects (e.g., `comb~` requires 5 args)
- **Parameter range checks**: Catches common mistakes like svf~ Q >= 1 or onepole~ frequency < 10 Hz
- **Large patch warnings**: Alerts when root patcher exceeds 80 objects
- **Signal safety analysis**: Detects feedback loops, high gain, unsafe comb~ feedback, and missing limiters before `dac~`

### Quality of Life Improvements

- **Auto-sizing**: Objects and comments automatically fit their content
- **Increased timeouts**: Better handling of large patchers (5s vs 2s)
- **Subpatcher support**: Full navigation and creation within nested patchers
- **Alias preservation**: Encapsulate preserves user-facing names (`*~` not `times~`, `t` not `trigger`)

---

## Demo Videos

### Understand: LLM Explaining a Max Patch

![img](./assets/understand.gif)

[Video link](https://www.youtube.com/watch?v=YKXqS66zrec). Acknowledgement: the patch being explained is from [MaxMSP_TeachingSketches](https://github.com/jeffThompson/MaxMSP_TeachingSketches/blob/master/02_MSP/07%20Ring%20Modulation.maxpat).

### Generate: LLM Making an FM Synth

![img](./assets/generate.gif)

[Full video](https://www.youtube.com/watch?v=Ns89YuE5-to) with audio.

---

## Installation

### Prerequisites

- Python 3.8 or newer
- [uv package manager](https://github.com/astral-sh/uv)
- Max 9 or newer (requires JavaScript V8 engine)

### Installing the MCP Server

1. **Install uv:**
```bash
# macOS/Linux:
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows:
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

2. **Clone and set up:**
```bash
git clone https://github.com/tiianhk/MaxMSP-MCP-Server.git
cd MaxMSP-MCP-Server
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

3. **Connect to your MCP client:**

**For Claude Code (recommended):**

As of Claude Code v2.1.47, MCP servers must be registered via the CLI (the `mcpServers` key in `~/.claude/settings.json` is no longer read). Run:

```bash
claude mcp add --scope user maxmsp -- uv --directory /path/to/MaxMSP-MCP-Server run server.py
```

Verify with `/mcp` inside a Claude Code session.

Alternatively, for project-scoped configuration, create a `.mcp.json` at your project root:

```json
{
  "mcpServers": {
    "maxmsp": {
      "command": "uv",
      "args": [
        "--directory",
        "/path/to/MaxMSP-MCP-Server",
        "run",
        "server.py"
      ]
    }
  }
}
```

**For Claude Desktop or Cursor:**

```
python install.py --client claude
# or
python install.py --client cursor
```

### Installing to a Max Patch

1. Open `MaxMSP_Agent/demo.maxpat` in Max 9
2. Click `script npm version` to verify npm is installed
3. Click `script npm install` to install dependencies
4. Click `script start` to begin communication

Once connected, the LLM can explain, modify, or create Max objects within the patch.

---

## Architecture

```
┌─────────────────┐     Socket.IO      ┌─────────────────┐
│   Claude Code   │ ←───────────────→  │    server.py    │
│  (MCP Client)   │     (port 5002)    │  (FastMCP/Python)│
└─────────────────┘                    └────────┬────────┘
                                                │
                                       ┌────────▼────────┐
                                       │ max_mcp_node.js │
                                       │   (Node.js)     │
                                       └────────┬────────┘
                                                │
                              ┌─────────────────┴─────────────────┐
                              │                                   │
                     ┌────────▼────────┐              ┌───────────▼───────────┐
                     │   max_mcp.js    │              │ max_mcp_v8_add_on.js  │
                     │  (Max js object)│              │   (Max v8 runtime)    │
                     └─────────────────┘              └───────────────────────┘
```

- **server.py** - Python FastMCP server with Socket.IO, validation, and tool definitions
- **max_mcp_node.js** - Node.js bridge running inside Max's `node.script`
- **max_mcp.js** - Main Max-side JavaScript handler for most operations
- **max_mcp_v8_add_on.js** - V8 JavaScript with `boxtext` access for encapsulation

---

## MCP Tools Reference

### Object Creation & Manipulation

| Tool | Description |
|------|-------------|
| `add_max_object(position, obj_type, varname, args)` | Create an object |
| `remove_max_object(varname)` | Delete an object |
| `connect_max_objects(src, outlet, dst, inlet)` | Connect two objects |
| `disconnect_max_objects(src, outlet, dst, inlet)` | Disconnect objects |
| `move_object(varname, x, y)` | Reposition an object |
| `recreate_with_args(varname, new_args)` | Change creation-time args |
| `autofit_existing(varname)` | Auto-size existing object |

### Object Properties

| Tool | Description |
|------|-------------|
| `set_object_attribute(varname, attr, value)` | Set an attribute |
| `set_parameter_property(varname, key, value)` | Set an M4L `_parameter_*` attribute (whitelisted keys; persists to `.amxd` after Cmd+S) |
| `set_message_text(varname, text_list)` | Set message box content |
| `set_number(varname, num)` | Set number box/slider value |
| `send_bang_to_object(varname)` | Send a bang |
| `send_messages_to_object(varname, message)` | Send message list |

### Query Tools

| Tool | Description |
|------|-------------|
| `get_objects_in_patch()` | Get all objects and connections |
| `get_objects_in_selected()` | Get selected objects |
| `get_object_attributes(varname)` | Get object's attributes (plus `parameter_info` for M4L parameters) |
| `get_parameter_info(varname)` | Read M4L `_parameter_*` metadata for a single box |
| `list_parameters()` | Enumerate every M4L parameter in the current patcher |
| `get_object_connections(varname)` | Get object's connections |
| `get_avoid_rect_position()` | Get bounding box for placement |
| `list_all_objects()` | List available Max objects |
| `get_object_doc(name)` | Get Max documentation |

**M4L parameter introspection.** The `_parameter_*` family of attributes
(`_parameter_shortname`, `_parameter_longname`, `_parameter_type`, `_parameter_range`,
`_parameter_initial`, `_parameter_modmode`, etc.) is **not enumerated by
`getattrnames()`** in Max — these attributes are hidden from the standard attribute
list. The tools above read them by name, surfacing the metadata that controls how a
`live.*` control appears in Ableton Live (device-strip name, automation label, value
range, modulation behaviour). `_parameter_type` is `0`=Int, `1`=Float, `2`=Enum
(where `_parameter_range` is the list of enum item names), `3`=Blob.

### Subpatcher Navigation

| Tool | Description |
|------|-------------|
| `create_subpatcher(position, varname, name)` | Create a `p` object |
| `enter_subpatcher(varname)` | Navigate into subpatcher |
| `exit_subpatcher()` | Return to parent |
| `get_patcher_context()` | Get current depth/path |
| `add_subpatcher_io(position, io_type, varname)` | Add inlet/outlet |

### Safety & Organization

| Tool | Description |
|------|-------------|
| `check_signal_safety()` | Analyze for dangerous patterns |
| `encapsulate(varnames, name, varname)` | Encapsulate objects |

---


## Development

After making code changes:

1. Reload js objects in Max (double-click to open editor, then close)
2. Restart node.script (`script stop`, then `script start`)

---

## Acknowledgements

This fork builds on prior work:

- The **original** [MaxMSP-MCP-Server](https://github.com/tiianhk/MaxMSP-MCP-Server) created by **Haokun Tian** and **Shuoyang Zheng**.
- The **ersatzben fork** ([ersatzben/maxmsp-mcp](https://github.com/ersatzben/maxmsp-mcp)) — added the subpatcher / safety / encapsulation tool layer this fork now extends.

The original project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.

**Original repository:** https://github.com/tiianhk/MaxMSP-MCP-Server

---

## Disclaimer

This is a third-party implementation and not made by Cycling '74.
