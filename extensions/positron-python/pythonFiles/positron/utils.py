#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import asyncio
import inspect
import numbers
import pprint
import sys
import types
from binascii import b2a_base64
from datetime import datetime
from typing import Any, Coroutine, Optional, Set, Tuple, cast


def get_qualname(value: Any) -> str:
    """
    Utility to manually construct a qualified type name as
    __qualname__ does not work for all types
    """
    # Get a named object corresponding to the value, e.g. an instance's class or a property's getter
    if (
        isinstance(value, type)
        or inspect.ismodule(value)
        or callable(value)
        or inspect.isgetsetdescriptor(value)
    ):
        named_obj = value
    elif isinstance(value, property):
        assert value.fget is not None
        named_obj = value.fget
    else:
        named_obj = type(value)

    qualname = getattr(named_obj, "__qualname__", None)
    if qualname is None:
        # Fall back to unqualified name if a qualified name doesn't exist
        qualname = getattr(named_obj, "__name__", None)

    if qualname is None:
        # Some objects may only have a name on a __class__ attribute
        class_obj = getattr(named_obj, "__class__", None)
        qualname = getattr(class_obj, "__name__", None)

    if qualname is None:
        # Finally, try to return the generic type's name, otherwise report object
        qualname = getattr(type(value), "__name__", "object")

    # Tell the type checker that it's a string
    qualname = cast(str, qualname)

    # If the value is not itself a module, prepend its module name if it exists
    if not inspect.ismodule(value):
        module = get_module_name(named_obj)
        if module is not None and module not in {"builtins", "__main__"}:
            qualname = f"{module}.{qualname}"

    return qualname


def get_module_name(value: Any) -> Optional[str]:
    """
    Get the name of the module defining `value`.
    """
    # It's already a module, return its name
    if inspect.ismodule(value):
        return value.__name__

    # Try to use its __module__ attribute
    module = getattr(value, "__module__", None)
    if module is not None:
        return module

    # Handle numpy ufuncs which don't have a __module__ attribute but which we can assume is "numpy"
    if is_numpy_ufunc(value):
        return "numpy"

    # Handle getset_descriptors (e.g. numpy.float_.base) which don't have a __module__, by
    # finding its module via the __objclass__ attribute
    obj_class = getattr(value, "__objclass__", None)
    if obj_class is not None:
        return obj_class.__module__

    # We couldn't infer the module name
    return None


def is_numpy_ufunc(object: Any) -> bool:
    # We intentionally don't use get_qualname here to avoid an infinite recursion
    object_type = type(object)
    return (
        getattr(object_type, "__module__") == "numpy"
        and getattr(object_type, "__name__") == "ufunc"
    )


def pretty_format(
    value,
    print_width: Optional[int] = None,
    truncate_at: Optional[int] = None,
) -> Tuple[str, bool]:
    if print_width is not None:
        s = pprint.pformat(value, width=print_width, compact=True)
    else:
        s = str(value)

    # TODO: Add type aware truncation
    if truncate_at is not None:
        return truncate_string(s, truncate_at)

    return s, False


def truncate_string(value: str, max: int) -> Tuple[str, bool]:
    if len(value) > max:
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
        return b2a_base64(obj, newline=False).decode("ascii")

    if isinstance(obj, container_to_list) or (
        hasattr(obj, "__iter__") and hasattr(obj, "__next__")
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
                "dict cannot be safely converted to JSON: "
                "key collision would lead to dropped values"
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


def create_task(coro: Coroutine, pending_tasks: Set[asyncio.Task], **kwargs) -> asyncio.Task:
    """
    Create a strongly referenced task to avoid it being garbage collected.

    Note that the call should hold a strong reference to pending_tasks.

    See the asyncio docs for more info: https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task.
    """
    task = asyncio.create_task(coro, **kwargs)
    pending_tasks.add(task)
    task.add_done_callback(pending_tasks.remove)
    return task


async def cancel_tasks(tasks: Set[asyncio.Task]) -> None:
    """
    Cancel and await a set of tasks.
    """
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks)
    tasks.clear()


def safe_isinstance(obj: Any, module: str, class_name: str, *attrs: str) -> bool:
    """
    Check if `obj` is an instance of module.class_name if loaded.

    Adapted from `IPython.core.completer._safe_isinstance`.
    """
    if module in sys.modules:
        m = sys.modules[module]
        for attr in [class_name, *attrs]:
            m = getattr(m, attr)
        if not isinstance(m, type):
            raise ValueError(f"{module}.{class_name}.{'.'.join(attrs)} is not a type")
        return isinstance(obj, m)
    return False
