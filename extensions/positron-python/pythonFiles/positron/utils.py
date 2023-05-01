#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import numbers
import types
from binascii import b2a_base64
from datetime import datetime


def get_length(value) -> int:
    length = 0
    if hasattr(value, '__len__'):
        try:
            length = len(value)
        except Exception:
            pass
    return length

def get_qualname(value) -> str:
    """
    Utility to manually construct a qualified type name as
    __qualname__ does not work for all types
    """
    if value is not None:
        t = type(value)
        module = t.__module__
        name = t.__name__
        if module is not None and module != 'builtins':
            return f'{module}.{name}'
        else:
            return name

    return 'None'

def truncate_string(value: str, max: int) -> (str, bool):
    if get_length(value) > max:
        return (value[:max], True)
    else:
        return (value, False)


ISO8601 = "%Y-%m-%dT%H:%M:%S.%f"

# We can't use ipykernel's json_clean function directly as it has since been
# deactivated. JSON message cleaning in jupyter_client will also be removed in
# the near future. We keep a copy below and adjust it for display-only use.
#
# The original function is available in the ipykernel module and was made
# available under the following license:
#
# Copyright (c) IPython Development Team.
# Distributed under the terms of the Modified BSD License.
#
def json_clean(obj):
    # types that are 'atomic' and ok in json as-is.
    atomic_ok = (str, type(None))

    # containers that we need to convert into lists
    container_to_list = (tuple, set, types.GeneratorType)

    # Since bools are a subtype of Integrals, which are a subtype of Reals,
    # we have to check them in that order.

    if isinstance(obj, bool):
        return obj

    if isinstance(obj, numbers.Integral):
        # cast int to int, in case subclasses override __str__ (e.g. boost enum, #4598)
        return int(obj)

    if isinstance(obj, numbers.Real):
        # use string repr to avoid precision issues with JSON
        return repr(obj)

    if isinstance(obj, atomic_ok):
        return obj

    if isinstance(obj, bytes):
        # unanmbiguous binary data is base64-encoded
        # (this probably should have happened upstream)
        return b2a_base64(obj, newline=False).decode('ascii')

    if isinstance(obj, container_to_list) or (
        hasattr(obj, '__iter__') and hasattr(obj, '__next__')
    ):
        obj = list(obj)

    if isinstance(obj, list):
        return [json_clean(x) for x in obj]

    if isinstance(obj, dict):
        # First, validate that the dict won't lose data in conversion due to
        # key collisions after stringification.  This can happen with keys like
        # True and 'true' or 1 and '1', which collide in JSON.
        nkeys = len(obj)
        nkeys_collapsed = len(set(map(str, obj)))
        if nkeys != nkeys_collapsed:
            msg = (
                'dict cannot be safely converted to JSON: '
                'key collision would lead to dropped values'
            )
            raise ValueError(msg)
        # If all OK, proceed by making the new dict that will be json-safe
        out = {}
        for k, v in obj.items():
            out[str(k)] = json_clean(v)
        return out

    if isinstance(obj, datetime):
        return obj.strftime(ISO8601)

    # we don't understand it, it's probably an unserializable object
    raise ValueError("Can't clean for JSON: %r" % obj)

