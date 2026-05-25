
autowatch = 1; // 1
inlets = 1; // Receive network messages here
outlets = 2; // For status, responses, etc.

// Patcher navigation state (mirrors max_mcp.js)
var root_patcher = this.patcher;
var current_patcher = this.patcher;
var patcher_stack = [];

function safe_parse_json(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        outlet(0, "error", "Invalid JSON: " + e.message);
        return null;
    }
}

function split_long_string(inString, maxLength) {
    // var longString = inString.replace(/\s+/g, "");
    var result = [];
    for (var i = 0; i < inString.length; i += maxLength) {
        result.push(inString.substring(i, i + maxLength));
    }
    return result;
}


// Chunked transfer buffer for large JSON strings
var chunk_buffer = "";
var chunk_request_id = "";
var chunk_expected = 0;
var chunk_action = "";

function anything() {
    var a = arrayfromargs(messagename, arguments);
    switch (messagename) {
        case "add_boxtext":
            if (arguments.length < 2) {
                post("add_boxtext: need two args: request_id, stringified_patcher_dict \n");
                return;
            }
            add_boxtext(arguments[0], arguments[1]);
            break;
        case "add_boxtext_start":
            chunk_request_id = arguments[0];
            chunk_expected = arguments[1];
            chunk_buffer = "";
            chunk_action = "add_boxtext";
            break;
        case "add_boxtext_chunk":
            chunk_buffer += arguments[0];
            break;
        case "add_boxtext_end":
            add_boxtext(chunk_request_id, chunk_buffer);
            chunk_buffer = "";
            chunk_request_id = "";
            chunk_expected = 0;
            break;
        case "autofit_v8":
            if (arguments.length >= 2) {
                autofit_v8(arguments[0], arguments[1]);
            }
            break;
        case "complete_encapsulate":
            if (arguments.length < 1) {
                post("complete_encapsulate: need encap_data arg\n");
                return;
            }
            complete_encapsulate(arguments[0]);
            break;
        case "complete_signal_safety":
            if (arguments.length < 1) {
                post("complete_signal_safety: need check_data arg\n");
                return;
            }
            complete_signal_safety(arguments[0]);
            break;
        case "nav_enter_parent":
            nav_enter_parent();
            break;
        case "nav_enter_subpatcher":
            if (arguments.length >= 1) {
                nav_enter_subpatcher(arguments[0]);
            }
            break;
        case "nav_exit_subpatcher":
            nav_exit_subpatcher();
            break;
        case "nav_switch_to_patcher":
            if (arguments.length >= 1) {
                nav_switch_to_patcher(arguments[0]);
            }
            break;
        case "get_object_attributes":
            if (arguments.length >= 2) {
                get_object_attributes_v8(arguments[0], arguments[1]);
            }
            break;
        case "get_parameter_info":
            if (arguments.length >= 2) {
                get_parameter_info_v8(arguments[0], arguments[1]);
            }
            break;
        case "list_parameters":
            if (arguments.length >= 1) {
                list_parameters_v8(arguments[0]);
            }
            break;
        case "set_parameter_property":
            if (arguments.length >= 4) {
                // value arrives as a JSON-stringified payload from max_mcp.js so lists/numbers survive the outlet
                var parsed_value;
                try { parsed_value = JSON.parse(arguments[3]); } catch (e) { parsed_value = arguments[3]; }
                set_parameter_property_v8(arguments[0], arguments[1], arguments[2], parsed_value);
            }
            break;
        case "configure_parameter":
            if (arguments.length >= 3) {
                var parsed_props;
                try { parsed_props = JSON.parse(arguments[2]); } catch (e) { parsed_props = {}; }
                configure_parameter_v8(arguments[0], arguments[1], parsed_props);
            }
            break;
        default:
            // outlet(1, messagename, ...arguments);
            outlet(1, "response", arguments[1]);
    }
}

// ========================================
// Patcher navigation (mirrors max_mcp.js state):

function nav_enter_parent() {
    var parent = current_patcher.parentpatcher;
    if (!parent) {
        post("v8: No parent patcher available\n");
        return;
    }
    patcher_stack.push(current_patcher);
    current_patcher = parent;
    post("v8: Entered parent patcher (depth: " + patcher_stack.length + ")\n");
}

function nav_enter_subpatcher(var_name) {
    var obj = current_patcher.getnamed(var_name);
    if (!obj) {
        post("v8: Object not found: " + var_name + "\n");
        return;
    }
    var subpatch = obj.subpatcher();
    if (!subpatch) {
        post("v8: Not a subpatcher: " + var_name + "\n");
        return;
    }
    patcher_stack.push(current_patcher);
    current_patcher = subpatch;
    post("v8: Entered subpatcher: " + var_name + " (depth: " + patcher_stack.length + ")\n");
}

function nav_exit_subpatcher() {
    if (patcher_stack.length === 0) {
        post("v8: Already at root\n");
        return;
    }
    current_patcher = patcher_stack.pop();
    post("v8: Exited to parent (depth: " + patcher_stack.length + ")\n");
}

function v8_find_any_wind() {
    var fp = max.frontpatcher;
    if (fp && fp.wind) return { wind: fp.wind, pushed: null };

    // Use root_patcher (captured at module scope), not this.patcher —
    // in v8, 'this' inside a function doesn't refer to the Max JS context.
    var p = root_patcher;
    var topmost_with_wind = null;
    while (p) {
        if (p.wind) topmost_with_wind = p;
        p = p.parentpatcher;
    }
    if (topmost_with_wind && topmost_with_wind.wind) {
        topmost_with_wind.wind.bringtofront();
        fp = max.frontpatcher;
        if (fp && fp.wind) return { wind: fp.wind, pushed: topmost_with_wind.wind };
        return { wind: topmost_with_wind.wind, pushed: topmost_with_wind.wind };
    }

    if (current_patcher && current_patcher.wind)
        return { wind: current_patcher.wind, pushed: null };
    return null;
}

function v8_find_patcher_by_name(patcher_name) {
    var result = v8_find_any_wind();
    if (!result) return null;

    var w = result.wind;
    var found = null;
    while (w) {
        var p = w.assoc;
        if (p && (p.name === patcher_name || p.filepath === patcher_name)) {
            found = p;
            break;
        }
        w = w.next;
    }

    if (result.pushed) result.pushed.sendtoback();
    return found;
}

function nav_switch_to_patcher(patcher_name) {
    var found = v8_find_patcher_by_name(patcher_name);

    if (found) {
        patcher_stack = [];
        current_patcher = found;
        post("v8: Switched to patcher: " + found.name + "\n");
    } else {
        post("v8: Patcher not found: " + patcher_name + "\n");
    }
}

// ========================================

function add_boxtext(request_id, data){
    var patcher_dict = safe_parse_json(data);
    if (!patcher_dict) {
        post("add_boxtext: failed to parse JSON (length=" + data.length + ")\n");
        var result = {"request_id": request_id, "results": {"error": "Failed to parse patcher dictionary"}};
        outlet(1, "response", JSON.stringify(result));
        return;
    }
    var p = current_patcher;

    patcher_dict.boxes.forEach(function (b) {
        var obj = p.getnamed(b.box.varname);
        if (obj) {
            b.box["text"] = obj.boxtext;
        }
    });

    var results = {"request_id": request_id, "results": patcher_dict}
    outlet(1, "response", split_long_string(JSON.stringify(results, null, 0), 2500));
}

// Character width lookup for Arial 12pt (slightly wider to prevent wrapping)
function get_text_width(text) {
    var very_narrow = "il|!.,;:'`1";      // ~4px
    var narrow = "jtfr()-[]{}/ -";         // ~5px
    var medium = "aceszvxyknuhbdgpq023456789"; // ~7px
    var wide = "mwMW@%";                   // ~10px
    // Everything else (uppercase, ~, *, +, etc.): ~8px

    var width = 0;
    for (var i = 0; i < text.length; i++) {
        var c = text[i];
        if (very_narrow.indexOf(c) !== -1) {
            width += 4;
        } else if (narrow.indexOf(c) !== -1) {
            width += 5;
        } else if (medium.indexOf(c) !== -1) {
            width += 7;
        } else if (wide.indexOf(c) !== -1) {
            width += 10;
        } else {
            width += 8;  // default for uppercase, symbols like ~ * +
        }
    }
    return width;
}

function complete_signal_safety(data_str) {
    var data = safe_parse_json(data_str);
    if (!data) return;

    var p = current_patcher;
    var request_id = data.request_id;
    var warnings = data.warnings || [];
    var objects_to_check = data.objects_to_check || [];

    // Check *~ and comb~ objects for dangerous gain/feedback values
    for (var i = 0; i < objects_to_check.length; i++) {
        var vn = objects_to_check[i];
        var obj = p.getnamed(vn);
        if (!obj) continue;

        var boxtext = obj.boxtext || "";
        var parts = boxtext.split(" ");
        var mc = obj.maxclass;

        if (mc === "*~") {
            // Check for gain > 1.0
            // *~ can have 0 or 1 argument (the gain multiplier)
            if (parts.length > 1) {
                var gain = parseFloat(parts[1]);
                if (!isNaN(gain) && gain > 1.0) {
                    warnings.push({
                        type: "HIGH_GAIN",
                        message: "*~ with gain > 1.0 may cause clipping",
                        object: vn,
                        value: gain
                    });
                }
            }
        } else if (mc === "comb~") {
            // comb~ args: maxdelay delay feedback feedforward gain
            // feedback is the 3rd argument (index 3 in parts, since parts[0] is "comb~")
            if (parts.length >= 4) {
                var feedback = parseFloat(parts[3]);
                if (!isNaN(feedback) && Math.abs(feedback) >= 1.0) {
                    warnings.push({
                        type: "UNSAFE_FEEDBACK",
                        message: "comb~ feedback >= 1.0 will cause runaway gain",
                        object: vn,
                        value: feedback
                    });
                }
            }
        }
    }

    // Return results
    if (data.is_add_object_response) {
        // Response for add_object with signal safety check
        // Combine: data.signal_warnings (from js) + warnings (from v8 gain check)
        var all_warnings = data.existing_warnings || [];
        var signal_warnings = (data.signal_warnings || []).concat(warnings);

        // Format signal warnings and add to all_warnings
        if (signal_warnings.length > 0) {
            var signal_msgs = [];
            for (var i = 0; i < signal_warnings.length; i++) {
                var w = signal_warnings[i];
                var msg = "[" + w.type + "] " + w.message;
                if (w.object) msg += " (object: " + w.object + ")";
                if (w.value !== undefined) msg += " value: " + w.value;
                signal_msgs.push(msg);
            }
            all_warnings.push("SIGNAL SAFETY: " + signal_msgs.join(" | "));
        }

        var response_str = all_warnings.length > 0 ? "ok - " + all_warnings.join(" | ") : "ok";
        var result = { "request_id": request_id, "results": response_str };
        outlet(1, "response", JSON.stringify(result));
    } else {
        // Manual check_signal_safety call - send full response
        var result = {
            "request_id": request_id,
            "results": {
                "safe": warnings.length === 0,
                "warnings": warnings,
                "signal_objects_count": data.signal_objects_count,
                "signal_connections_count": data.signal_connections_count
            }
        };
        outlet(1, "response", JSON.stringify(result));
    }
}

// Map internal Max class names to user-facing names
var internal_to_user_class = {
    // Math operators
    "plus~": "+~",
    "times~": "*~",
    "minus~": "-~",
    "div~": "/~",
    "modulo~": "%~",
    // Reverse operators
    "rminus~": "!-~",
    "rdiv~": "!/~",
    // Comparison operators
    "equals~": "==~",
    "notequals~": "!=~",
    "greaterthan~": ">~",
    "greaterthaneq~": ">=~",
    "lessthan~": "<~",
    "lessthaneq~": "<=~"
};

// Objects that need float formatting to avoid integer truncation
var FLOAT_SENSITIVE_OBJECTS = {
    "+": true, "-": true, "*": true, "/": true, "%": true,
    "pow": true, "scale": true,
    "pack": true, "pak": true, "unpack": true
};

// Format a number with decimal point to ensure Max interprets as float
function format_float_arg(arg) {
    if (typeof arg === "number") {
        var s = arg.toString();
        if (s.indexOf(".") === -1 && s.indexOf("e") === -1) {
            return s + ".";
        }
        return s;
    }
    if (typeof arg === "string") {
        return arg;
    }
    return String(arg);
}

function complete_encapsulate(data_str) {
    var data = safe_parse_json(data_str);
    if (!data) return;

    var p = current_patcher;
    var request_id = data.request_id;
    var subpatcher_varname = data.subpatcher_varname;
    var objects_info = data.objects_info;
    var internal_connections = data.internal_connections;
    var inlet_list = data.inlet_list;
    var outlet_list = data.outlet_list;
    var inlet_varnames = data.inlet_varnames;
    var outlet_varnames = data.outlet_varnames;
    var varname_set = data.varname_set;

    // Get subpatcher
    var sub_obj = p.getnamed(subpatcher_varname);
    if (!sub_obj) {
        var result = {"request_id": request_id, "results": {
            "success": false,
            "error": "Subpatcher not found: " + subpatcher_varname
        }};
        outlet(1, "response", JSON.stringify(result));
        return;
    }
    var subpatch = sub_obj.subpatcher();

    // Map old varnames to new internal varnames
    var new_varname_map = {};

    // Recreate objects inside subpatcher using boxtext
    for (var i = 0; i < objects_info.length; i++) {
        var o = objects_info[i];
        var orig_obj = p.getnamed(o.varname);
        if (!orig_obj) {
            post("encapsulate: original object not found: " + o.varname + "\n");
            continue;
        }

        var boxtext = orig_obj.boxtext || "";
        var obj_type = o.maxclass;
        var new_vn = "_enc_" + o.varname;
        var obj_args = [];

        // Get object type from boxtext when available - this preserves user-facing names
        // (e.g., ">~" instead of "greaterthan~", "t" instead of "trigger")
        if (boxtext && obj_type !== "message" && obj_type !== "comment") {
            var boxtext_parts = boxtext.split(" ");
            if (boxtext_parts[0]) {
                obj_type = boxtext_parts[0];  // Use the user-facing name from boxtext
            }
        }

        // Get original dimensions
        var orig_rect = orig_obj.rect;
        var orig_width = orig_rect[2] - orig_rect[0];
        var orig_height = orig_rect[3] - orig_rect[1];

        // Handle different object types
        if (obj_type === "message") {
            // For message boxes, boxtext IS the content
            obj_args = boxtext.split(" ");
            // Convert numeric strings to numbers, but preserve special Max syntax:
            // $1-$9 (variable substitution), \, \; \$ (escapes), commas, semicolons
            for (var j = 0; j < obj_args.length; j++) {
                var arg = obj_args[j];
                // Skip if contains special characters: $, \, comma, semicolon
                if (arg.indexOf("$") !== -1 ||
                    arg.indexOf("\\") !== -1 ||
                    arg.indexOf(",") !== -1 ||
                    arg.indexOf(";") !== -1) {
                    continue;  // Keep as string
                }
                // Only convert pure numeric values
                if (arg.match(/^-?\d*\.?\d+$/)) {
                    var num = parseFloat(arg);
                    if (!isNaN(num)) {
                        // Preserve integer vs float distinction
                        if (arg.indexOf(".") !== -1) {
                            obj_args[j] = num;
                        } else {
                            obj_args[j] = Math.floor(num);
                        }
                    }
                }
            }
        } else if (obj_type === "comment") {
            // For comments, boxtext is the text content - keep as single string
            obj_args = [boxtext];
        } else if (boxtext) {
            // For regular objects, boxtext is "type arg1 arg2..."
            var parts = boxtext.split(" ");
            obj_args = parts.slice(1);  // Skip the type, just get args
            // Convert string numbers back to numbers
            for (var j = 0; j < obj_args.length; j++) {
                var num = parseFloat(obj_args[j]);
                if (!isNaN(num) && obj_args[j].match(/^-?\d*\.?\d+$/)) {
                    // Preserve integer vs float distinction
                    if (obj_args[j].indexOf(".") !== -1) {
                        obj_args[j] = num;
                    } else {
                        obj_args[j] = Math.floor(num);
                    }
                }
            }
        }

        // Create object in subpatcher (use float formatting for sensitive objects)
        var new_obj;
        if (FLOAT_SENSITIVE_OBJECTS[obj_type] && obj_args.length > 0) {
            var formatted_args = [];
            for (var j = 0; j < obj_args.length; j++) {
                formatted_args.push(format_float_arg(obj_args[j]));
            }
            var boxtext_str = obj_type + " " + formatted_args.join(" ");
            new_obj = subpatch.newdefault(o.new_x, o.new_y, boxtext_str);
        } else {
            new_obj = subpatch.newdefault(o.new_x, o.new_y, obj_type, obj_args);
        }
        new_obj.varname = new_vn;
        new_varname_map[o.varname] = new_vn;

        // Set content for message and comment boxes
        if (obj_type === "message" || obj_type === "comment") {
            new_obj.message("set", obj_args);
        }

        // Preserve original dimensions
        var new_rect = new_obj.rect;
        new_obj.rect = [new_rect[0], new_rect[1], new_rect[0] + orig_width, new_rect[1] + orig_height];
    }

    // Reconnect internal connections
    for (var i = 0; i < internal_connections.length; i++) {
        var ic = internal_connections[i];
        var src = subpatch.getnamed(new_varname_map[ic.src_varname]);
        var dst = subpatch.getnamed(new_varname_map[ic.dst_varname]);
        if (src && dst) {
            subpatch.connect(src, ic.src_outlet, dst, ic.dst_inlet);
        }
    }

    // Connect inlets to internal objects
    for (var i = 0; i < inlet_list.length; i++) {
        var il = inlet_list[i];
        var inlet_obj = subpatch.getnamed(inlet_varnames[i]);
        var dst = subpatch.getnamed(new_varname_map[il.dst_varname]);
        if (inlet_obj && dst) {
            subpatch.connect(inlet_obj, 0, dst, il.dst_inlet);
        }
    }

    // Connect internal objects to outlets
    for (var i = 0; i < outlet_list.length; i++) {
        var ol = outlet_list[i];
        var outlet_obj = subpatch.getnamed(outlet_varnames[i]);
        var src = subpatch.getnamed(new_varname_map[ol.src_varname]);
        if (src && outlet_obj) {
            subpatch.connect(src, ol.src_outlet, outlet_obj, 0);
        }
    }

    // Connect external sources to subpatcher inlets (in parent patcher)
    for (var i = 0; i < inlet_list.length; i++) {
        var il = inlet_list[i];
        for (var j = 0; j < il.external.length; j++) {
            var ext = il.external[j];
            var src = p.getnamed(ext.src_varname);
            if (src) {
                p.connect(src, ext.src_outlet, sub_obj, i);
            }
        }
    }

    // Connect subpatcher outlets to external destinations (in parent patcher)
    for (var i = 0; i < outlet_list.length; i++) {
        var ol = outlet_list[i];
        for (var j = 0; j < ol.external.length; j++) {
            var ext = ol.external[j];
            var dst = p.getnamed(ext.dst_varname);
            if (dst) {
                p.connect(sub_obj, i, dst, ext.dst_inlet);
            }
        }
    }

    // Remove original objects
    for (var i = 0; i < objects_info.length; i++) {
        var orig_obj = p.getnamed(objects_info[i].varname);
        if (orig_obj) {
            p.remove(orig_obj);
        }
    }

    // Return success
    var result = {"request_id": request_id, "results": {
        "success": true,
        "subpatcher_varname": subpatcher_varname,
        "objects_encapsulated": objects_info.length,
        "inlets_created": inlet_list.length,
        "outlets_created": outlet_list.length,
        "internal_connections": internal_connections.length
    }};
    outlet(1, "response", JSON.stringify(result));
    post("Encapsulated " + objects_info.length + " objects into " + subpatcher_varname + "\n");
}

function autofit_v8(request_id, var_name) {
    var p = current_patcher;
    var obj = p.getnamed(var_name);

    if (!obj) {
        var r = {"request_id": request_id, "results": {"success": false, "error": "Object not found: " + var_name}};
        outlet(1, "response", JSON.stringify(r, null, 0));
        return;
    }

    var mc = obj.maxclass;
    if (mc === "inlet" || mc === "outlet" || mc === "inlet~" || mc === "outlet~") {
        var r = {"request_id": request_id, "results": {"success": true, "varname": var_name, "skipped": "inlet/outlet"}};
        outlet(1, "response", JSON.stringify(r, null, 0));
        return;
    }

    var skip_classes = ["toggle", "button", "slider", "dial", "number", "flonum",
                        "kslider", "panel", "live.dial", "live.slider", "live.toggle",
                        "live.button", "live.numbox", "live.menu", "meter~", "spectroscope~",
                        "gain~", "levelmeter~", "multislider", "matrixctrl", "nodes"];
    if (skip_classes.indexOf(mc) !== -1) {
        var r = {"request_id": request_id, "results": {"success": true, "varname": var_name, "skipped": "ui_object"}};
        outlet(1, "response", JSON.stringify(r, null, 0));
        return;
    }

    if (mc === "message") {
        var rect = obj.rect;
        var current_width = rect[2] - rect[0];
        var current_height = rect[3] - rect[1];
        if (current_width !== 70) {
            obj.rect = [rect[0], rect[1], rect[0] + 70, rect[1] + current_height];
        }
        var r = {"request_id": request_id, "results": {"success": true, "varname": var_name, "width": 70}};
        outlet(1, "response", JSON.stringify(r, null, 0));
        return;
    }

    var text = obj.boxtext;
    if (!text) {
        text = obj.maxclass;
    }

    var rect = obj.rect;
    var current_width = rect[2] - rect[0];
    var current_height = rect[3] - rect[1];

    var box_padding = 16;
    var min_width = 32;
    var text_width = get_text_width(text);
    var calculated_width = Math.max(min_width, text_width + box_padding);

    if (Math.abs(current_width - calculated_width) > 3) {
        obj.rect = [rect[0], rect[1], rect[0] + calculated_width, rect[1] + current_height];
    }
    var r = {"request_id": request_id, "results": {"success": true, "varname": var_name, "width": calculated_width}};
    outlet(1, "response", JSON.stringify(r, null, 0));
}

// ========================================
// M4L parameter metadata
//
// _parameter_* attributes are NOT enumerated by getattrnames(), but ARE accessible
// via direct obj.getattr(). Verified empirically against Max 9 on 2026-05-22 with
// live.dial, live.numbox, live.text. live.comment has no parameter wiring.
//
// _parameter_type values: 0=Int, 1=Float, 2=Enum, 3=Blob.
//   For type 2 (Enum), _parameter_range is the list of enum item names.
//   For types 0/1, _parameter_range is [min, max].

var PARAM_INFO_KEYS = [
    "_parameter_shortname",
    "_parameter_longname",
    "_parameter_type",
    "_parameter_range",
    "_parameter_initial",
    "_parameter_initial_enable",
    "_parameter_unitstyle",
    "_parameter_units",
    "_parameter_modmode",
    "_parameter_steps",
    "_parameter_invisible",
    "_parameter_exponent",
    "_parameter_linknames"
];

// Returns a dict of M4L parameter metadata for a box, or null if the box is
// not a Live parameter (parameter_enable != 1).
function build_parameter_info(obj) {
    var enable = null;
    try { enable = obj.getattr("parameter_enable"); } catch (e) {}
    if (!enable) return null;

    var info = { parameter_enable: enable };
    try {
        var mappable = obj.getattr("parameter_mappable");
        if (mappable !== null && mappable !== undefined) info.parameter_mappable = mappable;
    } catch (e) {}

    for (var i = 0; i < PARAM_INFO_KEYS.length; i++) {
        var key = PARAM_INFO_KEYS[i];
        var v;
        try { v = obj.getattr(key); } catch (e) { v = undefined; }
        if (v !== null && v !== undefined) {
            info[key] = v;
        }
    }
    return info;
}

function get_object_attributes_v8(request_id, var_name) {
    var obj = current_patcher.getnamed(var_name);
    if (!obj) {
        var err = {"request_id": request_id, "results": {"error": "Object not found: " + var_name}};
        outlet(1, "response", JSON.stringify(err));
        return;
    }
    var attributes = {};
    try {
        var attrnames = obj.getattrnames();
        for (var i = 0; i < attrnames.length; i++) {
            var name = attrnames[i];
            attributes[name] = obj.getattr(name);
        }
    } catch (e) {
        // emit whatever we have
    }
    // boxtext isn't in getattrnames() but is available via v8
    var boxtext = obj.boxtext;
    if (boxtext !== undefined && boxtext !== null) {
        attributes.text = boxtext;
    }
    // Box-level attributes (presentation_rect, hidden, etc.) are separate
    // from object attributes. For bpatchers, getattr reads the inner patcher;
    // getboxattr reads the outer box — which is what users actually need.
    try {
        var boxattrnames = obj.getboxattrnames();
        if (boxattrnames && boxattrnames.length > 0) {
            var box_attrs = {};
            for (var i = 0; i < boxattrnames.length; i++) {
                var bname = boxattrnames[i];
                if (!attributes.hasOwnProperty(bname)) {
                    box_attrs[bname] = obj.getboxattr(bname);
                }
            }
            if (Object.keys(box_attrs).length > 0) {
                attributes.box_attrs = box_attrs;
            }
        }
    } catch (e) {
        // not all objects support getboxattr
    }
    var param_info = build_parameter_info(obj);
    if (param_info) {
        attributes.parameter_info = param_info;
    }
    var results = {"request_id": request_id, "results": attributes};
    outlet(1, "response", split_long_string(JSON.stringify(results, null, 0), 2500));
}

function get_parameter_info_v8(request_id, var_name) {
    var obj = current_patcher.getnamed(var_name);
    if (!obj) {
        var err = {"request_id": request_id, "results": {"error": "Object not found: " + var_name}};
        outlet(1, "response", JSON.stringify(err));
        return;
    }
    var info = build_parameter_info(obj);
    var result = {
        "request_id": request_id,
        "results": {
            "varname": var_name,
            "maxclass": obj.maxclass || "",
            "is_parameter": info !== null,
            "parameter_info": info
        }
    };
    outlet(1, "response", split_long_string(JSON.stringify(result, null, 0), 2500));
}

// Keys allowed for set_parameter_property. Subset of writable parameter attrs:
// the PARAM_INFO_KEYS (read list) plus the non-underscore parameter_enable /
// parameter_mappable. Verified empirically (2026-05-22) that obj.setattr() on
// the underscore-prefixed forms persists to the saved .amxd on Max 9.1.4.
var SETTABLE_PARAM_KEYS = PARAM_INFO_KEYS.concat(["parameter_enable", "parameter_mappable"]);

function set_parameter_property_v8(request_id, varname, key, value) {
    if (SETTABLE_PARAM_KEYS.indexOf(key) === -1) {
        var err = {"request_id": request_id, "results": {
            "success": false,
            "error": "Key '" + key + "' is not in the allowed parameter-property list. Allowed: " + SETTABLE_PARAM_KEYS.join(", ") + ". For arbitrary attrs, use set_object_attribute."
        }};
        outlet(1, "response", JSON.stringify(err));
        return;
    }
    var obj = current_patcher.getnamed(varname);
    if (!obj) {
        var err = {"request_id": request_id, "results": {"success": false, "error": "Object not found: " + varname}};
        outlet(1, "response", JSON.stringify(err));
        return;
    }

    var pe;
    try { pe = obj.getattr("parameter_enable"); } catch(e) { pe = 0; }
    if (!pe) {
        var err = {"request_id": request_id, "results": {"success": false, "error": "Object '" + varname + "' does not have parameter_enable=1. Only live.* objects with parameters can use set_parameter_property."}};
        outlet(1, "response", JSON.stringify(err));
        return;
    }

    // Unwrap single-element lists to their bare value. _parameter_range and enum
    // lists stay as multi-element arrays; shortname/longname/etc come in as ["text"]
    // and need the bare string for setattr to match the documented call shape.
    var setval = (Array.isArray(value) && value.length === 1) ? value[0] : value;

    // Pre-read for warning detection (before setattr changes state)
    var warning = null;
    if (key === "_parameter_type" && setval === 1) {
        var pre_range;
        try { pre_range = obj.getattr("_parameter_range"); } catch (e) {}
        if (Array.isArray(pre_range) && pre_range.length === 2 && (pre_range[1] - pre_range[0]) > 255) {
            warning = "Float type will clamp _parameter_range to 255 span. Use Int type (0) with _parameter_unitstyle for wide ranges.";
        }
    } else if (key === "_parameter_range" && Array.isArray(setval) && setval.length === 2 && (setval[1] - setval[0]) > 255) {
        var pre_type;
        try { pre_type = obj.getattr("_parameter_type"); } catch (e) {}
        if (pre_type === 1) {
            warning = "Float type limits _parameter_range to 255 span. Use Int type (0) with _parameter_unitstyle instead.";
        }
    }

    var threw = false, error_msg = null;
    try { obj.setattr(key, setval); } catch (e) { threw = true; error_msg = e.message || String(e); }

    var after;
    try { after = obj.getattr(key); } catch (e) { after = null; }

    var success = !threw && (JSON.stringify(after) === JSON.stringify(setval));

    var result = {
        "request_id": request_id,
        "results": {
            "varname": varname,
            "key": key,
            "requested_value": value,
            "applied_value": setval,
            "actual_value": after,
            "success": success,
            "threw": threw,
            "error": error_msg,
            "warning": warning,
            "note": success ? "Runtime updated. Save the patcher (Cmd+S) in Max to persist to disk." : "setattr did not produce the requested value. Readback differs."
        }
    };
    outlet(1, "response", JSON.stringify(result));
}

function configure_parameter_v8(request_id, varname, properties) {
    var obj = current_patcher.getnamed(varname);
    if (!obj) {
        var err = {"request_id": request_id, "results": {"error": "Object not found: " + varname}};
        outlet(1, "response", JSON.stringify(err));
        return;
    }
    var pe;
    try { pe = obj.getattr("parameter_enable"); } catch(e) { pe = 0; }
    if (!pe) {
        var err = {"request_id": request_id, "results": {"error": "Object '" + varname + "' does not have parameter_enable=1."}};
        outlet(1, "response", JSON.stringify(err));
        return;
    }

    var results_per_key = [];
    var all_success = true;
    var warnings = [];

    var keys = Object.keys(properties);
    for (var i = 0; i < keys.length; i++) {
        if (SETTABLE_PARAM_KEYS.indexOf(keys[i]) === -1) {
            results_per_key.push({key: keys[i], success: false, error: "Not in allowed keys"});
            all_success = false;
            keys.splice(i, 1); i--;
        }
    }

    // Sort: type and steps before range to avoid the Float clamp issue
    var priority = {"_parameter_type": 0, "_parameter_steps": 1};
    keys.sort(function(a, b) {
        return (priority[a] !== undefined ? priority[a] : 50) - (priority[b] !== undefined ? priority[b] : 50);
    });

    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var val = properties[k];
        var setval = (Array.isArray(val) && val.length === 1) ? val[0] : val;
        var threw = false, err_msg = null;
        try { obj.setattr(k, setval); } catch (e) { threw = true; err_msg = e.message || String(e); }
        var after;
        try { after = obj.getattr(k); } catch (e) { after = null; }
        var ok = !threw && (JSON.stringify(after) === JSON.stringify(setval));
        if (!ok) all_success = false;
        results_per_key.push({key: k, requested: val, actual: after, success: ok, error: err_msg});
    }

    // Warn about Float + wide range
    try {
        var t = obj.getattr("_parameter_type");
        var r = obj.getattr("_parameter_range");
        if (t === 1 && Array.isArray(r) && r.length === 2 && (r[1] - r[0]) >= 255) {
            warnings.push("Float type clamps _parameter_range to 255 span. Use Int type (0) with _parameter_unitstyle.");
        }
    } catch (e) {}

    var result = {"request_id": request_id, "results": {
        "varname": varname, "results_per_key": results_per_key,
        "all_success": all_success, "warnings": warnings
    }};
    outlet(1, "response", JSON.stringify(result));
}

function list_parameters_v8(request_id) {
    var params = [];
    try {
        current_patcher.apply(function (obj) {
            var mc = obj.maxclass;
            if (!mc || mc === "patchline") return;
            var info = build_parameter_info(obj);
            if (!info) return;
            // Skip unnamed parameters — caller can't address them
            var vn = obj.varname || "";
            if (!vn) return;
            params.push({
                varname: vn,
                maxclass: mc,
                parameter_info: info
            });
        });
    } catch (e) {
        var err = {"request_id": request_id, "results": {"error": "list_parameters exception: " + (e.message || String(e))}};
        outlet(1, "response", JSON.stringify(err));
        return;
    }
    var result = {"request_id": request_id, "results": {"parameters": params, "count": params.length}};
    outlet(1, "response", split_long_string(JSON.stringify(result, null, 0), 2500));
}


