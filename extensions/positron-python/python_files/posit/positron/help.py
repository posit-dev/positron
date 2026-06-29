#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import contextlib
import logging
import pydoc
import re
from types import MappingProxyType
from typing import TYPE_CHECKING, Any

from .help_comm import (
    HelpBackendMessageContent,
    HelpFrontendEvent,
    ShowHelpKind,
    ShowHelpParams,
    ShowHelpTopicRequest,
)
from .positron_comm import CommMessage, PositronComm
from .pydoc import start_server
from .utils import JsonRecord, get_module_name, get_qualname

if TYPE_CHECKING:
    from comm.base_comm import BaseComm

logger = logging.getLogger(__name__)


def _canonicalize_distribution_name(name: str) -> str:
    # PEP 503: collapse runs of -_. into a single dash and lowercase.
    return re.sub(r"[-_.]+", "-", name).lower()


def _distribution_to_modules(name: str) -> list[str]:
    """Top-level modules provided by the PyPI distribution `name`.

    PyPI distribution names don't always match the importable module name
    (e.g. "scikit-learn" -> "sklearn", "python-dateutil" -> "dateutil").
    Returns an empty list on Python < 3.10 (where the stdlib API is missing)
    or when no installed distribution matches.
    """
    try:
        # packages_distributions exists on Python >= 3.10; pyright's stubs for
        # older versions don't know about it, so suppress the import-symbol
        # check here. ImportError handles the actual runtime absence.
        from importlib.metadata import (
            packages_distributions,  # type: ignore[reportGeneralTypeIssues]
        )
    except ImportError:
        return []

    canonical = _canonicalize_distribution_name(name)
    modules: list[str] = []
    for module, distributions in packages_distributions().items():
        if any(_canonicalize_distribution_name(d) == canonical for d in distributions):
            modules.append(module)
    # When a distribution exposes multiple top-level modules (e.g. setuptools
    # also exposes _distutils_hack, pkg_resources), prefer one whose name
    # matches the distribution name.
    modules.sort(key=lambda m: _canonicalize_distribution_name(m) != canonical)
    return modules


def _safe_locate(path: str) -> Any:
    """Resolve `path` with `pydoc.locate`, returning None instead of raising.

    `pydoc.locate` imports modules along the path and re-raises any error during import
    (wrapped in `pydoc.ErrorDuringImport`). Resolving a help key must never crash the help
    request, so we swallow any failure and treat it as "not resolvable".
    """
    with contextlib.suppress(Exception):
        return pydoc.locate(path)
    return None


def _locatable_key(key: str, obj: Any) -> str:
    """Return a key that `pydoc.locate` can resolve back to `obj`.

    The pydoc server renders help by resolving a key string with `pydoc.locate`. Most
    objects' qualified names resolve fine, but some libraries expose callables whose
    `__qualname__` encodes a private defining class (e.g. `torch._VariableFunctionsClass.abs`),
    which `pydoc.locate` can't import. In that case, fall back to a public path built from the
    object's module and name (e.g. `torch.abs`), preferring the full module path and then the
    top-level package.

    Each candidate is only accepted if it resolves back to the same object, so an unrelated
    name can never be substituted. If nothing resolves, the original key is returned unchanged.
    """
    if _safe_locate(key) is obj:
        return key

    name = getattr(obj, "__name__", None)
    module = get_module_name(obj)
    if name and module:
        candidates = (f"{module}.{name}", f"{module.split('.')[0]}.{name}")
        for candidate in candidates:
            if candidate != key and _safe_locate(candidate) is obj:
                return candidate

    return key


def help(topic="help"):  # noqa: A001
    """
    Show help for the given topic.

    Examples
    --------

    Show help for the `help` function itself:

    >>> help()

    Show help for a type:

    >>> import pandas
    >>> help(pandas.DataFrame)

    A string import path works too:

    >>> help("pandas.DataFrame")

    Show help for a type given an instance:

    >>> df = pandas.DataFrame()
    >>> help(df)
    """
    from .positron_ipkernel import PositronIPyKernel

    if PositronIPyKernel.initialized():
        kernel = PositronIPyKernel.instance()
        kernel.help_service.show_help(topic)
    else:
        raise Exception("Unexpected error. No PositronIPyKernel has been initialized.")


class HelpService:
    """Manages the help server and submits help-related events to the `FrontendService`."""

    # Not sure why, but some qualified names cause errors in pydoc. Manually replace these with
    # names that are known to work.
    _QUALNAME_OVERRIDES = MappingProxyType(
        {
            "pandas.core.frame": "pandas",
            "pandas.core.series": "pandas",
        }
    )

    def __init__(self):
        self._comm: PositronComm | None = None
        self._pydoc_thread = None

    def on_comm_open(self, comm: BaseComm, _msg: JsonRecord) -> None:
        self._comm = PositronComm(comm)
        self._comm.on_msg(self.handle_msg, HelpBackendMessageContent)

    def handle_msg(self, msg: CommMessage[HelpBackendMessageContent], _raw_msg: JsonRecord) -> None:
        """Handle messages received from the client via the positron.help comm."""
        request = msg.content.data

        if isinstance(request, ShowHelpTopicRequest):
            if self._comm is not None:
                self._comm.send_result(data=True)
            self.show_help(request.params.topic)

        else:
            logger.warning(f"Unhandled request: {request}")

    def shutdown(self) -> None:
        # shutdown pydoc
        if self._pydoc_thread is not None and self._pydoc_thread.serving:
            logger.info("Stopping pydoc server thread")
            self._pydoc_thread.stop()
            logger.info("Pydoc server thread stopped")
        # shutdown comm
        if self._comm is not None:
            with contextlib.suppress(Exception):
                self._comm.close()

    def start(self):
        self._pydoc_thread = start_server()

    def show_help(self, request: str | Any | None) -> None:
        if self._pydoc_thread is None or not self._pydoc_thread.serving:
            logger.warning("Ignoring help request, the pydoc server is not serving")
            return

        # Map from the object to the URL for the pydoc server.
        # We first use pydoc.resolve, which lets us handle an object or an import path.
        result = None
        with contextlib.suppress(ImportError):
            result = pydoc.resolve(thing=request)

        # If pydoc can't resolve the request (e.g. a PyPI distribution name like
        # "scikit-learn" whose import name is "sklearn"), try mapping the
        # distribution name to its top-level module(s) and resolving those.
        if result is None and isinstance(request, str):
            for module_name in _distribution_to_modules(request):
                with contextlib.suppress(ImportError):
                    result = pydoc.resolve(thing=module_name)
                if result is not None:
                    break

        if result is None:
            # We could not resolve to an object, try to get help for the request as a string.
            key = request
        else:
            # We resolved to an object.
            obj = result[0]
            key = get_qualname(obj)

            # Not sure why, but some qualified names cause errors in pydoc. Manually replace these with
            # names that are known to work.
            for old, new in self._QUALNAME_OVERRIDES.items():
                if key.startswith(old):
                    key = key.replace(old, new)
                    break

            # Some libraries (e.g. torch, tensorflow) expose callables whose __qualname__
            # encodes a private defining class (e.g. torch._VariableFunctionsClass.abs), so the
            # qualname-based key can't be resolved by pydoc.locate() on the server side. Fall back
            # to a public path derived from the object's module and name.
            key = _locatable_key(key, obj)

        url = f"{self._pydoc_thread.url}get?key={key}"

        # Submit the event to the frontend service
        event = ShowHelpParams(content=url, kind=ShowHelpKind.Url, focus=True)
        if self._comm is not None:
            self._comm.send_event(name=HelpFrontendEvent.ShowHelp.value, payload=event.dict())
