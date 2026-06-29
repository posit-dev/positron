#
# Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import contextlib
import importlib.metadata
import inspect
import logging
import os
import platform
import sys
import types
import webbrowser
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Set, Union
from urllib.parse import urlparse

from comm.base_comm import BaseComm
from packaging.specifiers import SpecifierSet
from packaging.utils import canonicalize_name

from ._vendor.pydantic import BaseModel
from .positron_comm import CommMessage, JsonRpcErrorCode, PositronComm
from .ui_comm import (
    CallMethodParams,
    CallMethodRequest,
    DidChangePlotsRenderSettingsEvent,
    EvaluateCodeRequest,
    FrontendReadyEvent,
    OpenEditorParams,
    ShowHtmlFileDestination,
    ShowHtmlFileParams,
    ShowUrlParams,
    UiBackendMessageContent,
    UiFrontendEvent,
    WorkingDirectoryParams,
)
from .utils import JsonData, JsonRecord, alias_home, is_local_html_file

if TYPE_CHECKING:
    from .positron_ipkernel import PositronIPyKernel

logger = logging.getLogger(__name__)

_localhosts = [
    "localhost",
    "127.0.0.1",
    "[0:0:0:0:0:0:0:1]",
    "[::1]",
    "0.0.0.0",
    "[0:0:0:0:0:0:0:0]",
    "[::]",
]


#
# RPC methods called from the frontend.
#


class _InvalidParamsError(Exception):
    pass


def _is_module_loaded(kernel: "PositronIPyKernel", params: List[JsonData]) -> bool:
    if not (isinstance(params, list) and len(params) == 1 and isinstance(params[0], str)):
        raise _InvalidParamsError(f"Expected a module name, got: {params}")
    # Consider: this is not a perfect check for a couple of reasons:
    # 1. The module could be loaded under a different name
    # 2. The user may have a variable with the same name as the module
    return params[0] in kernel.shell.user_ns


def _get_loaded_modules(kernel: "PositronIPyKernel", _params: List[JsonData]) -> Optional[JsonData]:
    # Get all keys in the user namespace that start with a module prefix
    # (e.g., 'numpy', 'pandas', etc.)
    return [
        name
        for name in kernel.shell.user_ns
        if not name.startswith("_") and isinstance(kernel.shell.user_ns[name], type(sys))
    ]


def _get_missing_imports(
    _kernel: "PositronIPyKernel", params: List[JsonData]
) -> Optional[JsonData]:
    """Return the subset of the given top-level module names that cannot be imported.

    A module is considered present if it is already loaded or if an import spec
    can be found for it (which covers standard-library modules and installed
    distributions whose import name differs from their distribution name, e.g.
    `sklearn` for scikit-learn). Anything else is reported as missing.

    The caller (the frontend analyzer) is responsible for mapping a missing
    import name back to an installable distribution; this method only answers
    the per-session "is it importable here?" question.
    """
    if not (isinstance(params, list) and len(params) == 1 and isinstance(params[0], list)):
        raise _InvalidParamsError(f"Expected a list of module names, got: {params}")

    import importlib.util

    modules = [name for name in params[0] if isinstance(name, str)]
    missing: List[str] = []
    for name in modules:
        if name in sys.modules:
            continue
        try:
            spec = importlib.util.find_spec(name)
        except (ImportError, ValueError, ModuleNotFoundError):
            # find_spec raises (rather than returning None) when a parent
            # package is missing; treat that as not importable.
            spec = None
        if spec is None:
            missing.append(name)
    return missing


def _set_console_width(_kernel: "PositronIPyKernel", params: List[JsonData]) -> None:
    if not (isinstance(params, list) and len(params) == 1 and isinstance(params[0], int)):
        raise _InvalidParamsError(f"Expected an integer width, got: {params}")

    width = params[0]

    # Set the COLUMNS variable to alter the value returned by shutil.get_terminal_size.
    # For example, pandas uses this (if set) to automatically determine display.max_columns.
    os.environ["COLUMNS"] = str(width)

    # Library-specific options:

    if "numpy" in sys.modules:
        import numpy as np

        np.set_printoptions(linewidth=width)

    if "pandas" in sys.modules:
        import pandas as pd

        # Set display.width to None so that pandas auto-detects the
        # correct value given the terminal width configured via the
        # COLUMNS variable above.  See:
        # https://pandas.pydata.org/docs/user_guide/options.html
        pd.set_option("display.width", None)

    if "polars" in sys.modules:
        import polars as pl

        pl.Config.set_tbl_width_chars(width)

    if "torch" in sys.modules:
        import torch

        torch.set_printoptions(linewidth=width)


def _import_names_for_dist(dist: importlib.metadata.Distribution, canonical: str) -> List[str]:
    """Best-effort list of names a user would `import` to bring this distribution in.

    Wheels typically ship a `top_level.txt`; when missing, fall back to the
    distribution's canonical name with hyphens turned into underscores
    (matches the convention for most pure-Python packages).
    """
    try:
        top_level = dist.read_text("top_level.txt")
    except (FileNotFoundError, OSError):
        top_level = None
    if top_level:
        names = [line.strip() for line in top_level.splitlines() if line.strip()]
        if names:
            return names
    return [canonical.replace("-", "_")]


# `Project-URL` labels are free-form author text with no official vocabulary
# (you see "Homepage", "Home", "Repository", "Source", "GitHub", ... with varied
# casing), so we normalize each label and match it against this synonym table to
# rank candidates when choosing the single best URL to surface.
_URL_CATEGORY_BY_LABEL: Dict[str, str] = {
    "home": "homepage",
    "homepage": "homepage",
    "repository": "repository",
    "repo": "repository",
    "source": "repository",
    "sourcecode": "repository",
    "code": "repository",
    "github": "repository",
    "gitlab": "repository",
    "doc": "documentation",
    "docs": "documentation",
    "documentation": "documentation",
}

# Lower number = higher priority. Any URL that doesn't match a known category
# still beats no URL at all, hence the fallback rank below.
_URL_CATEGORY_PRIORITY: Dict[str, int] = {"homepage": 0, "repository": 1, "documentation": 2}
_URL_FALLBACK_PRIORITY = 3


def _normalize_url_label(label: str) -> str:
    """Lowercase a Project-URL label and strip everything but alphanumerics."""
    return "".join(char for char in label.lower() if char.isalnum())


def _best_package_url(dist: importlib.metadata.Distribution) -> Optional[str]:
    """Pick the single best external URL from a distribution's metadata.

    Prefers the homepage, then the repository/source, then documentation, then
    any other `Project-URL`. The legacy singular `Home-page` header counts as a
    homepage candidate. Returns None when the distribution advertises no URL.
    Core (the Packages pane) validates the scheme before opening it.
    """
    # PackageMetadata (the 3.14 protocol) doesn't expose .get(), but the runtime
    # object (email.message.Message) always has it -- mirror the cast used by
    # _get_packages_installed so both accessors type-check across Python versions.
    metadata: Any = dist.metadata
    best_url: Optional[str] = None
    best_priority = _URL_FALLBACK_PRIORITY + 1
    for entry in metadata.get_all("Project-URL") or []:
        label, _, url = entry.partition(",")
        url = url.strip()
        if not url:
            continue
        category = _URL_CATEGORY_BY_LABEL.get(_normalize_url_label(label))
        # Every value in `_URL_CATEGORY_BY_LABEL` is a key in `_URL_CATEGORY_PRIORITY`,
        # so a recognized category always resolves; anything else is the fallback.
        priority = _URL_CATEGORY_PRIORITY[category] if category else _URL_FALLBACK_PRIORITY
        # Strict `<` keeps the first URL seen at a given priority (so the first
        # repository wins over a later one, etc.).
        if priority < best_priority:
            best_url, best_priority = url, priority
    # Only let the legacy `Home-page` win if no homepage-priority URL was already
    # found in `Project-URL`; a homepage outranks a repository/other we may hold.
    if best_priority > _URL_CATEGORY_PRIORITY["homepage"]:
        home_page = metadata.get("Home-page")
        if home_page and home_page.strip():
            best_url = home_page.strip()
    return best_url


# Get all installed packages
def _get_packages_installed(kernel: "PositronIPyKernel", _params: List[JsonData]) -> JsonData:
    # `attached` mirrors R's search()-membership semantics: true when the
    # user explicitly bound the package in the REPL. We walk user_ns once
    # to find every module the user has bound, by *any* name -- this
    # catches `import x`, `import x as y`, `import x.sub` (binds x), and
    # `from pkg import sub` when sub is a module. Transitive sys.modules
    # entries pulled in by other packages are deliberately ignored.
    user_top_levels: Set[str] = set()
    for value in kernel.shell.user_ns.values():
        if isinstance(value, types.ModuleType):
            module_name = getattr(value, "__name__", None)
            if module_name:
                user_top_levels.add(module_name.partition(".")[0])

    packages_dict = {}
    for dist in importlib.metadata.distributions():
        name = dist.metadata["Name"]
        if name is None:
            continue
        canonical = canonicalize_name(name)
        # Dedupe by canonical name - keeps first occurrence (the one that would be imported)
        if canonical not in packages_dict:
            import_names = _import_names_for_dist(dist, canonical)
            attached = any(import_name in user_top_levels for import_name in import_names)
            # PackageMetadata (the 3.14 protocol) doesn't expose .get(), but the
            # runtime object (email.message.Message) always has it.
            metadata: Any = dist.metadata
            summary = metadata.get("Summary")
            entry: Dict[str, JsonData] = {
                "id": f"{canonical}-{dist.version}",
                "name": name,
                "displayName": canonical,
                "version": dist.version,
                "attached": attached,
                "description": summary if summary and summary != "UNKNOWN" else "",
            }
            url = _best_package_url(dist)
            if url:
                entry["url"] = url
            packages_dict[canonical] = entry
    return sorted(packages_dict.values(), key=lambda p: p["displayName"])


# Evaluate Requires-Python specifiers against this kernel's interpreter.
def _check_requires_python(_kernel: "PositronIPyKernel", params: List[JsonData]) -> JsonData:
    # params[0] is the list of distinct Requires-Python specifier strings the
    # extension collected from a package's PyPI files. We answer, for each, whether
    # this interpreter satisfies it, using the bundled `packaging` (the same PEP 440
    # implementation pip relies on) against our own version. This keeps PEP 440
    # semantics in the tool that owns them rather than re-implementing them in TS.
    specs = params[0] if params else []
    py_version = platform.python_version()
    result: Dict[str, JsonData] = {}
    if isinstance(specs, list):
        for spec in specs:
            if not isinstance(spec, str):
                continue
            try:
                result[spec] = SpecifierSet(spec).contains(py_version, prereleases=True)
            except Exception:
                # Conservative: an unparseable specifier must not hide a version.
                result[spec] = True
    return result


_RPC_METHODS: Dict[str, Callable[["PositronIPyKernel", List[JsonData]], Optional[JsonData]]] = {
    "setConsoleWidth": _set_console_width,
    "isModuleLoaded": _is_module_loaded,
    "getLoadedModules": _get_loaded_modules,
    "getMissingImports": _get_missing_imports,
    "getPackagesInstalled": _get_packages_installed,
    "checkRequiresPython": _check_requires_python,
}


def _to_json_compatible(obj: object) -> JsonData:
    """Convert a Python object to a JSON-compatible type."""
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, dict):
        return {str(k): _to_json_compatible(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_json_compatible(v) for v in obj]
    if isinstance(obj, set):
        return [_to_json_compatible(v) for v in sorted(obj, key=str)]
    # Handle numpy scalars if numpy is available
    try:
        import numpy as np

        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, np.bool_):
            return bool(obj)
    except ImportError:
        pass
    # Handle pandas objects if pandas is available
    try:
        import pandas as pd

        if isinstance(obj, pd.DataFrame):
            return obj.to_dict(orient="list")
        if isinstance(obj, pd.Series):
            return obj.tolist()
    except ImportError:
        pass
    # Fallback: convert to string
    return str(obj)


class UiService:
    """
    Wrapper around a comm channel whose lifetime matches that of the Positron frontend.

    Used for communication with the frontend, unscoped to any particular view.
    """

    def __init__(self, kernel: "PositronIPyKernel") -> None:
        self.kernel = kernel

        self._comm: Optional[PositronComm] = None

        self.working_directory: Optional[Path] = None

    def on_comm_open(self, comm: BaseComm, _msg: JsonRecord) -> None:
        self._comm = PositronComm(comm)
        self._comm.on_msg(self.handle_msg, UiBackendMessageContent)

        self.browser = PositronViewerBrowser(comm=self._comm)
        webbrowser.register(
            self.browser.name,
            PositronViewerBrowser,
            self.browser,
            preferred=True,
        )

        # Clear the current working directory to generate an event for the new
        # client (i.e. after a reconnect)
        self.working_directory = None
        try:
            self.poll_working_directory()
        except Exception:
            logger.exception("Error polling working directory")

    def poll_working_directory(self) -> None:
        """
        Polls for changes to the working directory.

        And sends an event to the front end if the working directory has changed.
        """
        # Get the current working directory
        current_dir = Path.cwd()

        # If it isn't the same as the last working directory, send an event
        if current_dir != self.working_directory:
            self.working_directory = current_dir
            # Deliver event to client
            if self._comm is not None:
                event = WorkingDirectoryParams(directory=str(alias_home(current_dir)))
                self._send_event(name=UiFrontendEvent.WorkingDirectory, payload=event)

    def open_editor(self, file: str, line: int, column: int, *, pinned: bool = True) -> None:
        event = OpenEditorParams(file=file, line=line, column=column, pinned=pinned)
        self._send_event(name=UiFrontendEvent.OpenEditor, payload=event)

    def clear_console(self) -> None:
        self._send_event(name=UiFrontendEvent.ClearConsole, payload={})

    def clear_webview_preloads(self) -> None:
        self._send_event(name=UiFrontendEvent.ClearWebviewPreloads, payload={})

    def handle_msg(self, msg: CommMessage[UiBackendMessageContent], _raw_msg: JsonRecord) -> None:
        request = msg.content.data

        if isinstance(request, CallMethodRequest):
            # Unwrap nested JSON-RPC
            self._call_method(request.params)

        elif isinstance(request, EvaluateCodeRequest):
            self._evaluate_code(request.params.code)

        elif isinstance(request, DidChangePlotsRenderSettingsEvent):
            self.kernel.plots_service.update_render_settings(request.params.settings)

        elif isinstance(request, FrontendReadyEvent):
            pass

        else:
            logger.warning(f"Unhandled request: {request}")

    def _call_method(self, rpc_request: CallMethodParams) -> None:
        func = _RPC_METHODS.get(rpc_request.method)
        if func is None:
            return logger.warning(f"Invalid frontend RPC request method: {rpc_request.method}")

        try:
            result = func(self.kernel, rpc_request.params)
        except _InvalidParamsError as exception:
            return logger.warning(
                f"Invalid frontend RPC request params for method '{rpc_request.method}'. {exception}"
            )

        if self._comm is not None:
            self._comm.send_result(data=result)
            return None
        return None

    def _evaluate_code(self, code: str) -> None:
        from io import StringIO

        stdout_buf = StringIO()
        stderr_buf = StringIO()

        try:
            with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
                try:
                    # Try eval first (for expressions)
                    result = eval(code, self.kernel.shell.user_ns)
                    json_result = _to_json_compatible(result)
                except SyntaxError:
                    # Fall back to exec for statements
                    exec(code, self.kernel.shell.user_ns)
                    json_result = None
        except Exception as err:
            logger.warning(f"Error evaluating code: {err}")
            if self._comm is not None:
                self._comm.send_error(JsonRpcErrorCode.INTERNAL_ERROR, str(err))
            return

        output = stdout_buf.getvalue() + stderr_buf.getvalue()

        if self._comm is not None:
            self._comm.send_result(data={"result": json_result, "output": output})

    def shutdown(self) -> None:
        if self._comm is not None:
            with contextlib.suppress(Exception):
                self._comm.close()

    def _send_event(self, name: str, payload: Union[BaseModel, JsonRecord]) -> None:
        if self._comm is not None:
            if isinstance(payload, BaseModel):
                payload = payload.dict()
            self._comm.send_event(name=name, payload=payload)


class PositronViewerBrowser(webbrowser.BaseBrowser):
    """Launcher class for Positron Viewer browsers."""

    def __init__(
        self,
        name: str = "positron_viewer",
        comm: Optional[PositronComm] = None,
    ):
        self.name = name
        self._comm = comm

    def open(self, url, new=0, autoraise=True) -> bool:  # noqa: ARG002, FBT002
        if not self._comm:
            return False

        destination = ShowHtmlFileDestination.Viewer
        # If url is pointing to an HTML file, route to the ShowHtmlFile comm
        if is_local_html_file(url):
            # Send bokeh and plotly plots to the plots pane.
            # Identify them by checking the stack for their respective modules/functions.
            if self._is_module_function("bokeh.io.showing", "show") or self._is_module_function(
                "plotly.basedatatypes"
            ):
                destination = ShowHtmlFileDestination.Plot

            return self._send_show_html_event(url, destination)

        for addr in _localhosts:
            if addr in url:
                is_plot = self._is_module_function("plotly.basedatatypes")
                if is_plot:
                    return self._send_show_html_event(url, ShowHtmlFileDestination.Plot)
                else:
                    event = ShowUrlParams(url=url)
                    self._comm.send_event(name=UiFrontendEvent.ShowUrl, payload=event.dict())

                return True
        # pass back to webbrowser's list of browsers to open up the link
        return False

    @staticmethod
    def _is_module_function(module_name: str, function_name: Union[str, None] = None) -> bool:
        module = sys.modules.get(module_name)
        if module:
            for frame_info in inspect.stack():
                if function_name:
                    if (
                        inspect.getmodule(frame_info.frame, frame_info.filename) == module
                        and frame_info.function == function_name
                    ):
                        return True
                else:
                    if inspect.getmodule(frame_info.frame) == module:
                        return True
        return False

    def _send_show_html_event(self, url: str, destination: str) -> bool:
        if self._comm is None:
            logger.warning("No comm available to send ShowHtmlFile event")
            return False
        if os.name == "nt" and is_local_html_file(url):
            url = urlparse(url).netloc or urlparse(url).path
        self._comm.send_event(
            name=UiFrontendEvent.ShowHtmlFile,
            payload=ShowHtmlFileParams(
                path=url,
                # Use the URL's title.
                title="",
                destination=destination,
                # No particular height is required.
                height=0,
            ).dict(),
        )
        return True
