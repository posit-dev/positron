# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import json
import sys

# --- Start Positron ---
import platform  # noqa: I001
# --- End Positron ---

obj = {}
obj["versionInfo"] = tuple(sys.version_info)
obj["sysPrefix"] = sys.prefix
obj["sysVersion"] = sys.version
obj["is64Bit"] = sys.maxsize > 2**32
# --- Start Positron ---
obj["implementation"] = sys.implementation.name
# Detect actual CPU architecture the interpreter was compiled for.
# platform.machine() returns the architecture the Python interpreter was compiled for,
# not the host machine architecture. On macOS Rosetta, an x86_64 Python will report
# 'x86_64' even when running on arm64 hardware.
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
