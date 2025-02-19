# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import json
import sys

obj = {}
obj["versionInfo"] = tuple(sys.version_info)
obj["sysPrefix"] = sys.prefix
obj["sysVersion"] = sys.version
obj["is64Bit"] = sys.maxsize > 2**32
# --- Start Positron ---
obj["implementation"] = sys.implementation.name
# --- End Positron ---

print(json.dumps(obj))
