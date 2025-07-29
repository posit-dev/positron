#
# Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import asyncio
import concurrent.futures
import functools
import inspect
import logging
import sys
import threading
import uuid
from pathlib import Path
from typing import (
    Any,
    Callable,
    Coroutine,
    Dict,
    List,
    Optional,
    Set,
    TypeVar,
    Union,
    cast,
)
from urllib.parse import unquote, urlparse

logger = logging.getLogger(__name__)

JsonData = Union[Dict[str, "JsonData"], List["JsonData"], str, int, float, bool, None]
JsonRecord = Dict[str, JsonData]


T = TypeVar("T")


TESTING = False


def get_qualname(value: Any) -> str:
    """Utility to manually construct a qualified type name as __qualname__ does not work for all types."""
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

    # In the rare situation an object incorrectly handles __qualname__ by not returning
    # a str, we fall back to the name of the type
    if not isinstance(qualname, str):
        qualname = getattr(type(value), "__name__", "object")

    # Tell the type checker that it's a string
    qualname = cast("str", qualname)

    # If the value is not itself a module, prepend its module name if it exists
    if not inspect.ismodule(value):
        module = get_module_name(named_obj)
        if module is not None and module not in {"builtins", "__main__"}:
            qualname = f"{module}.{qualname}"

    return qualname


def get_module_name(value: Any) -> Optional[str]:
    """Get the name of the module defining `value`."""
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


def is_numpy_ufunc(object_: Any) -> bool:
    # We intentionally don't use get_qualname here to avoid an infinite recursion
    object_type = type(object_)
    return object_type.__module__ == "numpy" and object_type.__name__ == "ufunc"


ISO8601 = "%Y-%m-%dT%H:%M:%S.%f"


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
    """Cancel and await a set of tasks."""
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks)
    tasks.clear()


class BackgroundJobQueue:
    """Simple threadpool-based background job queue for pseudo-asynchronous request handling in kernel services."""

    def __init__(self, max_workers=None):
        # Initialize the ThreadPoolExecutor with the specified number
        # of workers
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        self.pending_futures = set()
        self.lock = threading.Lock()

    def submit(self, fn, *args, **kwargs):
        # Submit a job to the thread pool and track the future
        future = self.executor.submit(fn, *args, **kwargs)
        with self.lock:
            self.pending_futures.add(future)

        # Attach a callback to remove the future from the pending set when done
        future.add_done_callback(self._remove_future)
        return future

    def _remove_future(self, future):
        # Callback to remove the future from the pending set when it's done
        with self.lock:
            self.pending_futures.discard(future)

    def wait_for_all(self):
        # Wait for all pending futures to complete
        with self.lock:
            futures = list(self.pending_futures)

        for future in futures:
            future.result()  # This will block until the future is done

    def shutdown(self, *, wait=True):
        # Shut down the executor and optionally wait for all running
        # futures to complete
        self.executor.shutdown(wait=wait)


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


def not_none(value: Optional[T]) -> T:
    """Assert that a value is not None."""
    assert value is not None
    return value


def alias_home(path: Path) -> Path:
    """Alias the home directory to ~ in a path."""
    home_dir = Path.home()
    try:
        # relative_to will raise a ValueError if path is not within the home directory
        return Path("~") / path.relative_to(home_dir)
    except ValueError:
        return path


def guid():
    return str(uuid.uuid4())


def var_guid():
    """Generate a unique identifier for a variable."""
    return f"var_{uuid.uuid4().hex}"


def positron_ipykernel_usage():
    """

    Positron Console Help.
    =========================================

    The Positron Console offers a fully compatible replacement for the standard Python
    interpreter, with convenient shell features, special commands, command
    history mechanism and output results caching. It is an adapted version of an
    [IPython](https://ipython.readthedocs.io/en/stable/) kernel. For more information, check out the
    [Positron documentation](https://positron.posit.co/).

    GETTING HELP
    ------------

    Within the Positron Console you have various ways to get help:

      - `?`             -> Introduction and overview of IPython's features (this screen).
      - `object?`       -> View 'object' in Help pane.
      - `object??`      -> View source code for 'object'
      - `help(object)`  -> View 'object' in Help pane.
      - `%quickref`     -> Quick reference of all IPython specific syntax and magics.



    MAIN FEATURES
    -------------

    * View tabular data in the data explorer via the %view command.

    * Magic commands: type %magic for information on the magic subsystem.

    * System command aliases, via the %alias command or the configuration file(s).

    * Dynamic object information:

      Typing ?word or word? sends 'word' to the help pane.

      Typing ??word or word?? displays source code for 'word'.

      If you just want to see an object's docstring, type '%pdoc object' (without
      quotes, and without % if you have automagic on).

    * Tab completion in the local namespace:

      At any time, hitting tab will complete any available Python commands or
      variable names, and show you a list of the possible completions if there's
      no unambiguous one. It will also complete filenames in the current directory.

    * Search previous command history in multiple ways:

      - Use arrow keys up/down to navigate through the history of executed commands.
      - Hit Ctrl-r: opens a search prompt. Begin typing and the system searches
        your history for lines that match what you've typed so far, completing as
        much as it can.

      - %hist: search history by index.

    * Persistent command history across sessions.

    * System shell with !. Typing !ls will run 'ls' in the current directory.

    * Verbose and colored exception traceback printouts. See the magic xmode and
      xcolor functions for details (just type %magic).

    * Clickable links in exception traceback printouts.

    """  # noqa: D205


numpy_numeric_scalars = [
    "numpy.int8",
    "numpy.uint8",
    "numpy.int16",
    "numpy.uint16",
    "numpy.int32",
    "numpy.uint32",
    "numpy.int64",
    "numpy.uint64",
    "numpy.intp",
    "numpy.uintp",
    "numpy.float16",
    "numpy.float32",
    "numpy.float64",
    "numpy.float96",
    "numpy.complex64",
    "numpy.complex128",
    "numpy.short",
    "numpy.ushort",
    "numpy.intc",
    "numpy.uintc",
    "numpy.long",
    "numpy.ulong",
    "numpy.longlong",
    "numpy.ulonglong",
    "numpy.half",
    "numpy.single",
    "numpy.double",
    "numpy.longdouble",
    "numpy.csingle",
    "numpy.cdouble",
    "numpy.clongdouble",
]


def is_local_html_file(url: str) -> bool:
    """Check if a URL points to a local HTML file."""
    try:
        parsed_url = urlparse(unquote(url))

        # Check if it's a file scheme
        if parsed_url.scheme not in ("file",):
            return False

        # On Windows, the file path might be in netloc. This is the case for Bokeh HTML file URLs.
        path = parsed_url.path or parsed_url.netloc

        # Check if the path contains the .html or .htm extensions
        ext = Path(path).suffix.lower()
        return ext in (".html", ".htm")

    except Exception:
        return False


# Limits the number of concurrent calls allowed by the debounce decorator.
_debounce_semaphore = threading.Semaphore(10)


def debounce(interval_s: int, keyed_by: Optional[str] = None):
    """
    Debounce calls to a function until `interval_s` seconds have passed.

    Adapted from https://github.com/python-lsp/python-lsp-server.
    """

    def wrapper(func: Callable):
        # Dict of Timers, keyed by call values of the keyed_by argument.
        timers: Dict[Any, threading.Timer] = {}

        # Lock to synchronise mutating the timers dict.
        lock = threading.Lock()

        @functools.wraps(func)
        def debounced(*args, **kwargs) -> None:
            _debounce_semaphore.acquire()

            # Get the value of the keyed_by argument, if any.
            sig = inspect.signature(func)
            call_args = sig.bind(*args, **kwargs)
            key = call_args.arguments[keyed_by] if keyed_by else None

            def run() -> None:
                try:
                    # Remove the timer and call the function.
                    with lock:
                        del timers[key]
                    func(*args, **kwargs)
                finally:
                    _debounce_semaphore.release()

            with lock:
                # Cancel any existing timer for the same key.
                old_timer = timers.get(key)
                if old_timer:
                    old_timer.cancel()
                    _debounce_semaphore.release()

                # Create a new timer and start it.
                timer = threading.Timer(debounced.interval_s, run)  # type: ignore
                timers[key] = timer
                timer.start()

        # Store the interval on the debounced function; we lower the interval for faster tests.
        debounced.interval_s = interval_s  # type: ignore

        # Store timers on the debounced function; we wait for them to finish in tests.
        debounced.timers = timers  # type: ignore

        return debounced

    return wrapper


def with_logging(func: Callable):
    """Decorator to log the execution of a function."""
    name = get_qualname(func)

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        logger.debug(f"Calling {name} with args: {args}, kwargs: {kwargs}")
        result = func(*args, **kwargs)
        logger.debug(f"{name} returned: {result}")
        return result

    return wrapper
