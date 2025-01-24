#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import json
from typing import Any, Dict, Hashable, cast

from .inspectors import INSPECTOR_CLASSES, PositronInspector, get_inspector
from .utils import JsonData


def encode_access_key(key: Any) -> str:
    # If it's not hashable, raise an error.
    if not isinstance(key, Hashable):
        raise TypeError(f"Key {key} is not hashable.")

    # If it's a blank string, return it as-is.
    if isinstance(key, str) and key == "":
        return key

    # Get the key's inspector and serialize the key.
    json_data = get_inspector(key).to_json()
    # Pass separators to json.dumps to remove whitespace after "," and ":".
    return json.dumps(json_data, separators=(",", ":"))


# Since access keys are serialized to JSON, we can't use get_inspector to find the inspector
# corresponding to a serialized access key. We instead use the key's type's qualname, but need this
# dict to map known and supported qualnames to keys that are accepted by get_inspector.
_ACCESS_KEY_QUALNAME_TO_INSPECTOR_KEY: Dict[str, str] = {
    "int": "number",
    "float": "number",
    "complex": "number",
    "bool": "boolean",
    "str": "string",
    "range": "collection",
    "type": "class",
}


def decode_access_key(access_key: str) -> Any:
    # If it's a blank string, return it as-is.
    if access_key == "":
        return access_key

    # Deserialize the access key.
    json_data: JsonData = json.loads(access_key)

    # Validate the json data structure.
    if (
        not isinstance(json_data, dict)
        or not isinstance(json_data["type"], str)
        or not isinstance(json_data["data"], (dict, list, str, int, float, bool, type(None)))
    ):
        raise ValueError(f"Unexpected json data structure: {json_data}")

    # Get the inspector for this type.
    # TODO(pyright): cast shouldn't be necessary, recheck in a future version of pyright
    type_name = cast(str, json_data["type"])
    inspector_key = _ACCESS_KEY_QUALNAME_TO_INSPECTOR_KEY.get(type_name, type_name)
    inspector_cls = INSPECTOR_CLASSES.get(inspector_key, PositronInspector)

    # Reconstruct the access key's original object using the deserialized JSON data.
    return inspector_cls.from_json(json_data)
