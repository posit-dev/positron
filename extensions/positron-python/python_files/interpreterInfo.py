# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
# --- Start Positron ---
# ruff: noqa: I001
# --- End Positron ---

import json
import sys

# --- Start Positron ---
import platform
import sysconfig
# --- End Positron ---

obj = {}
obj["versionInfo"] = tuple(sys.version_info)
obj["sysPrefix"] = sys.prefix
obj["sysVersion"] = sys.version
obj["is64Bit"] = sys.maxsize > 2**32
# --- Start Positron ---
obj["implementation"] = sys.implementation.name
# Detect actual CPU architecture the interpreter was compiled for.
# On macOS, platform.machine() returns the interpreter's architecture (e.g., x86_64 Python
# on arm64 hardware via Rosetta reports 'x86_64').
# On Windows, platform.machine() returns the HOST architecture, not the interpreter's.
# So on Windows, we use sysconfig.get_platform() which returns 'win-amd64' or 'win-arm64'.
if sys.platform == "win32":
    # sysconfig.get_platform() returns e.g., 'win-amd64' or 'win-arm64'
    win_platform = sysconfig.get_platform()
    if "arm64" in win_platform:
        obj["architecture"] = "arm64"
    elif "amd64" in win_platform or "x64" in win_platform:
        obj["architecture"] = "x64"
    elif "win32" in win_platform:
        obj["architecture"] = "x86"
    else:
        obj["architecture"] = win_platform
else:
    # On macOS/Linux, platform.machine() returns the interpreter's architecture
    machine = platform.machine().lower()
    if machine in ("arm64", "aarch64"):
        obj["architecture"] = "arm64"
    elif machine in ("x86_64", "amd64", "x64"):
        obj["architecture"] = "x64"
    elif machine in ("i386", "i686", "x86"):
        obj["architecture"] = "x86"
    else:
        obj["architecture"] = machine
# --- End Positron ---

print(json.dumps(obj))
