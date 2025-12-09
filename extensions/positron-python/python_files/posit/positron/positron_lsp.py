#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""
Positron Language Server for Python.

A stripped-down LSP server that provides Positron-specific features:
- Namespace-aware completions (variables from the active Python session)
- DataFrame/Series column completions
- Environment variable completions
- Magic command completions
- Help topic resolution
- Syntax diagnostics with magic/shell command filtering

For Console documents (inmemory: scheme), also provides:
- Hover with type info, docstring, and DataFrame preview
- Signature help

Static analysis features (go-to-definition, references, rename, symbols)
are delegated to third-party extensions like Pylance.
"""

from __future__ import annotations

import ast
import asyncio
import contextlib
import enum
import inspect
import logging
import os
import re
import threading
import warnings
from functools import lru_cache
from typing import TYPE_CHECKING, Any, Callable, Generator, Optional

from ._vendor import attrs, cattrs
from ._vendor.lsprotocol import types
from ._vendor.pygls.io_ import run_async
from ._vendor.pygls.lsp.server import LanguageServer
from ._vendor.pygls.protocol import LanguageServerProtocol, lsp_method
from .help_comm import ShowHelpTopicParams
from .utils import debounce

if TYPE_CHECKING:
    from comm.base_comm import BaseComm

    from .positron_ipkernel import PositronShell

logger = logging.getLogger(__name__)

# Prefixes for special Python/IPython syntax
_COMMENT_PREFIX = "#"
_LINE_MAGIC_PREFIX = "%"
_CELL_MAGIC_PREFIX = "%%"
_SHELL_PREFIX = "!"
_HELP_PREFIX_OR_SUFFIX = "?"

# Custom LSP method for help topic requests
_HELP_TOPIC = "positron/textDocument/helpTopic"

# URI scheme for Console documents (in-memory)
_INMEMORY_SCHEME = "inmemory"


@enum.unique
class _MagicType(str, enum.Enum):
    cell = "cell"
    line = "line"


@attrs.define
class HelpTopicParams:
    """Parameters for the helpTopic request."""

    text_document: types.TextDocumentIdentifier = attrs.field()
    position: types.Position = attrs.field()


@attrs.define
class HelpTopicRequest:
    """A helpTopic request message."""

    id: int | str = attrs.field()
    params: HelpTopicParams = attrs.field()
    method: str = _HELP_TOPIC
    jsonrpc: str = attrs.field(default="2.0")


@attrs.define
class PositronInitializationOptions:
    """Positron-specific language server initialization options."""

    working_directory: Optional[str] = attrs.field(default=None)  # noqa: UP045 because cattrs can't deal with | None in 3.9


def _is_console_document(uri: str) -> bool:
    """Check if the document is a Console document (in-memory scheme)."""
    return uri.startswith(f"{_INMEMORY_SCHEME}:")


def _get_expression_at_position(line: str, character: int) -> str:
    """
    Extract the expression at the given character position.

    This handles dotted expressions like `df.columns` or `os.path.join`.
    """
    if not line or character < 0 or character > len(line):
        return ""

    # Find start of expression (including dots)
    start = character
    while start > 0:
        c = line[start - 1]
        if c.isalnum() or c == "_" or c == ".":
            start -= 1
        else:
            break

    # Find end of word (not including dots since we're usually at end of expression)
    end = character
    while end < len(line) and (line[end].isalnum() or line[end] == "_"):
        end += 1

    return line[start:end]


class PositronLanguageServerProtocol(LanguageServerProtocol):
    """Custom protocol for the Positron language server."""

    def __init__(self, server: PositronLanguageServer, converter: cattrs.Converter):
        super().__init__(server, converter)
        # Queue for handling message batching (performance optimization)
        self._messages_to_handle: list[Any] = []

    @lru_cache  # noqa: B019
    def get_message_type(self, method: str) -> type | None:
        """Override to include custom Positron LSP messages."""
        if method == _HELP_TOPIC:
            return HelpTopicRequest
        return super().get_message_type(method)

    @lsp_method(types.INITIALIZE)
    def lsp_initialize(
        self, params: types.InitializeParams
    ) -> Generator[Any, Any, types.InitializeResult]:
        """Handle the initialize request."""
        server: PositronLanguageServer = self._server  # type: ignore[assignment]

        # Parse Positron-specific initialization options
        try:
            raw_opts = (params.initialization_options or {}).get("positron", {})
            init_opts = cattrs.structure(raw_opts, PositronInitializationOptions)
        except cattrs.BaseValidationError as error:
            msg = f"Invalid PositronInitializationOptions, using defaults: {cattrs.transform_error(error)}"
            server.window_show_message(
                types.ShowMessageParams(message=msg, type=types.MessageType.Error)
            )
            init_opts = PositronInitializationOptions()

        # Store the working directory (using params.root_path since workspace may not be initialized yet)
        server._working_directory = init_opts.working_directory or params.root_path  # noqa: SLF001

        # Yield to parent implementation which handles workspace setup
        return (yield from super().lsp_initialize(params))

    def _data_received(self, data: bytes) -> None:  # type: ignore[override]
        """
        Workaround for pygls performance issue where cancelled requests are still executed.

        See: https://github.com/openlawlibrary/pygls/issues/517
        """
        self._messages_to_handle = []
        super()._data_received(data)  # type: ignore[misc]

        def is_request(msg):
            return hasattr(msg, "method") and hasattr(msg, "id")

        def is_cancel_notification(msg):
            return getattr(msg, "method", None) == types.CANCEL_REQUEST

        # First pass: find all requests that were cancelled in the same batch
        request_ids = set()
        cancelled_ids = set()
        for msg in self._messages_to_handle:
            if is_request(msg):
                request_ids.add(msg.id)
            elif is_cancel_notification(msg) and msg.params.id in request_ids:
                cancelled_ids.add(msg.params.id)

        # Second pass: filter out cancelled requests and their cancel notifications
        self._messages_to_handle = [
            msg
            for msg in self._messages_to_handle
            if not (
                (is_cancel_notification(msg) and msg.params.id in cancelled_ids)
                or (is_request(msg) and msg.id in cancelled_ids)
            )
        ]

        # Now handle the filtered messages
        for msg in self._messages_to_handle:
            super()._procedure_handler(msg)  # type: ignore[misc]

    def _procedure_handler(self, message) -> None:
        """Queue messages for batch processing in _data_received."""
        self._messages_to_handle.append(message)


class PositronLanguageServer(LanguageServer):
    """
    Positron Language Server for Python.

    Provides namespace-aware completions and Positron-specific LSP features.
    """

    protocol: PositronLanguageServerProtocol

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # Reference to the IPython shell for namespace access
        self.shell: PositronShell | None = None

        # LSP comm for frontend communication
        self._comm: BaseComm | None = None

        # Working directory
        self._working_directory: str | None = None

        # Server thread
        self._server_thread: threading.Thread | None = None
        self._stop_event: threading.Event | None = None

        # Event loop for the server thread
        self._loop: asyncio.AbstractEventLoop | None = None

        # Debug mode
        self._debug = False

        # Cache for magic completions
        self._magic_completions: dict[str, tuple] = {}

    def start_tcp(self, host: str) -> None:
        """Start the TCP server."""
        # Create a new event loop for the LSP server thread
        self._loop = asyncio.new_event_loop()
        self._loop.set_debug(self._debug)
        asyncio.set_event_loop(self._loop)

        self._stop_event = stop_event = threading.Event()

        async def lsp_connection(
            reader: asyncio.StreamReader, writer: asyncio.StreamWriter
        ) -> None:
            """Handle an incoming LSP connection."""
            logger.debug("Connected to LSP client")
            self.protocol.set_writer(writer)  # type: ignore[attr-defined]
            await run_async(
                stop_event=stop_event,
                reader=reader,
                protocol=self.protocol,
                logger=logger,
                error_handler=self.report_server_error,
            )
            logger.debug("LSP connection closed")
            self._shutdown_server()

        async def start_server() -> None:
            # Use port=0 to let the OS pick a port
            self._server = await asyncio.start_server(lsp_connection, host, 0)

            # Find the port we're listening on
            for socket in self._server.sockets:
                addr, port = socket.getsockname()
                if addr == host:
                    logger.info("LSP server listening on %s:%d", host, port)
                    break
            else:
                raise AssertionError("Unable to determine LSP server port")

            # Notify the frontend that the server is ready
            if self._comm is None:
                logger.warning("LSP comm not set, cannot send server_started message")
            else:
                logger.info("LSP server ready, sending server_started message")
                self._comm.send({"msg_type": "server_started", "content": {"port": port}})

            # Serve until stopped
            async with self._server:
                await self._server.serve_forever()

        # Run the server
        try:
            self._loop.run_until_complete(start_server())
        except (KeyboardInterrupt, SystemExit):
            pass
        except asyncio.CancelledError:
            logger.debug("Server was cancelled")
        finally:
            self._shutdown_server()

    def start(self, lsp_host: str, shell: PositronShell, comm: BaseComm) -> None:
        """
        Start the LSP server.

        Parameters
        ----------
        lsp_host
            Host address to bind to
        shell
            Reference to the IPython shell for namespace access
        comm
            Comm for communicating with the frontend
        """
        self._comm = comm
        self.shell = shell

        # Reset shutdown flag if restarting
        self.protocol._shutdown = False  # noqa: SLF001

        # Stop any existing server thread
        if self._server_thread is not None and self._server_thread.is_alive():
            logger.warning("LSP server thread already exists, shutting it down")
            if self._stop_event:
                self._stop_event.set()
                self._server_thread.join(timeout=5)
                if self._server_thread.is_alive():
                    logger.warning("LSP server thread did not exit after 5s, dropping it")

        # Start the server in a new thread
        logger.info("Starting LSP server thread")
        self._server_thread = threading.Thread(
            target=self.start_tcp,
            args=(lsp_host,),
            name="PositronLSPThread",
            daemon=True,  # Allow process to exit while thread is running
        )
        self._server_thread.start()

    def _shutdown_server(self) -> None:
        """Internal shutdown logic."""
        logger.info("Shutting down LSP server")

        if self._stop_event:
            self._stop_event.set()

        if self._thread_pool:
            self._thread_pool.shutdown()

        if self._server:
            self._server.close()

        if self._loop and not self._loop.is_closed():
            self._loop.close()

        self._server_thread = None

    def stop(self) -> None:
        """Stop the LSP server from another thread."""
        if self._stop_event is None:
            logger.warning("Cannot stop LSP server, it was not started")
            return
        self._stop_event.set()

    def set_debug(self, debug: bool) -> None:  # noqa: FBT001
        """Enable or disable debug mode."""
        self._debug = debug


def create_server() -> PositronLanguageServer:
    """Create and configure the Positron language server."""
    server = PositronLanguageServer(
        name="positron-lsp",
        version="0.1.0",
        protocol_cls=PositronLanguageServerProtocol,  # type: ignore[arg-type]
        text_document_sync_kind=types.TextDocumentSyncKind.Incremental,
        notebook_document_sync=types.NotebookDocumentSyncOptions(
            notebook_selector=[
                types.NotebookDocumentFilterWithCells(
                    notebook="jupyter-notebook",
                    cells=[types.NotebookCellLanguage(language="python")],
                )
            ]
        ),
    )

    _register_features(server)
    return server


def _register_features(server: PositronLanguageServer) -> None:
    """Register LSP features with the server."""

    # --- Completion ---
    @server.feature(
        types.TEXT_DOCUMENT_COMPLETION,
        types.CompletionOptions(
            trigger_characters=[".", "'", '"', _LINE_MAGIC_PREFIX],
            resolve_provider=True,
        ),
    )
    def completion(params: types.CompletionParams) -> types.CompletionList | None:
        """Provide completions from the namespace and magics."""
        return _handle_completion(server, params)

    @server.feature(types.COMPLETION_ITEM_RESOLVE)
    def completion_item_resolve(params: types.CompletionItem) -> types.CompletionItem:
        """Resolve additional completion item details."""
        return _handle_completion_resolve(server, params)

    # --- Hover (Console only) ---
    @server.feature(types.TEXT_DOCUMENT_HOVER)
    def hover(params: types.TextDocumentPositionParams) -> types.Hover | None:
        """Provide hover information for Console documents."""
        # Only provide hover for Console documents
        if not _is_console_document(params.text_document.uri):
            return None
        return _handle_hover(server, params)

    # --- Signature Help (Console only) ---
    @server.feature(
        types.TEXT_DOCUMENT_SIGNATURE_HELP,
        types.SignatureHelpOptions(trigger_characters=["(", ","]),
    )
    def signature_help(params: types.TextDocumentPositionParams) -> types.SignatureHelp | None:
        """Provide signature help for Console documents."""
        # Only provide signature help for Console documents
        if not _is_console_document(params.text_document.uri):
            return None
        return _handle_signature_help(server, params)

    # --- Help Topic ---
    @server.feature(_HELP_TOPIC)
    def help_topic(params: HelpTopicParams) -> ShowHelpTopicParams | None:
        """Return the help topic for the symbol at the cursor."""
        return _handle_help_topic(server, params)

    # --- Diagnostics ---
    @server.feature(types.TEXT_DOCUMENT_DID_OPEN)
    def did_open(params: types.DidOpenTextDocumentParams) -> None:
        """Handle document open - publish diagnostics."""
        _publish_diagnostics_debounced(server, params.text_document.uri)

    @server.feature(types.TEXT_DOCUMENT_DID_CHANGE)
    def did_change(params: types.DidChangeTextDocumentParams) -> None:
        """Handle document change - publish diagnostics."""
        _publish_diagnostics_debounced(server, params.text_document.uri)

    @server.feature(types.TEXT_DOCUMENT_DID_SAVE)
    def did_save(params: types.DidSaveTextDocumentParams) -> None:
        """Handle document save - publish diagnostics."""
        _publish_diagnostics_debounced(server, params.text_document.uri)

    @server.feature(types.TEXT_DOCUMENT_DID_CLOSE)
    def did_close(params: types.DidCloseTextDocumentParams) -> None:
        """Handle document close - clear diagnostics."""
        server.text_document_publish_diagnostics(
            types.PublishDiagnosticsParams(uri=params.text_document.uri, diagnostics=[])
        )


# --- Completion Handlers ---


def _handle_completion(
    server: PositronLanguageServer, params: types.CompletionParams
) -> types.CompletionList | None:
    """Handle completion requests."""
    document = server.workspace.get_text_document(params.text_document.uri)
    line = document.lines[params.position.line] if document.lines else ""
    trimmed_line = line.lstrip()

    # Don't complete comments or shell commands
    if trimmed_line.startswith((_COMMENT_PREFIX, _SHELL_PREFIX)):
        return None

    items: list[types.CompletionItem] = []
    server._magic_completions.clear()  # noqa: SLF001

    # Get text before cursor for context
    text_before_cursor = line[: params.position.character]

    # Check for dict key access pattern first (e.g., x[" or x[')
    # This includes DataFrame column access and environment variables
    dict_key_match = re.search(r'(\w[\w\.]*)\s*\[\s*["\']([^"\']*)?$', text_before_cursor)
    if dict_key_match:
        items.extend(
            _get_dict_key_completions(
                server, dict_key_match.group(1), dict_key_match.group(2) or ""
            )
        )
    elif "." in text_before_cursor:
        # Attribute completion
        items.extend(_get_attribute_completions(server, text_before_cursor))
    elif trimmed_line.startswith((_LINE_MAGIC_PREFIX, _CELL_MAGIC_PREFIX)):
        # Magic command completion only
        pass  # Will add magics below
    else:
        # Namespace completions
        items.extend(_get_namespace_completions(server, text_before_cursor))

    # Add magic completions if appropriate
    is_completing_attribute = "." in trimmed_line
    has_whitespace = " " in trimmed_line
    has_string = '"' in trimmed_line or "'" in trimmed_line
    if not (is_completing_attribute or has_whitespace or has_string):
        items.extend(_get_magic_completions(server, text_before_cursor))

    return types.CompletionList(is_incomplete=False, items=items) if items else None


def _get_namespace_completions(
    server: PositronLanguageServer, text_before_cursor: str
) -> list[types.CompletionItem]:
    """Get completions from the shell's namespace."""
    if server.shell is None:
        return []

    items = []
    # Get the partial word being typed
    match = re.search(r"(\w*)$", text_before_cursor)
    prefix = match.group(1) if match else ""

    for name, obj in server.shell.user_ns.items():
        # Skip private names unless explicitly typing underscore
        if name.startswith("_") and not prefix.startswith("_"):
            continue
        # Filter by prefix
        if not name.startswith(prefix):
            continue

        kind = _get_completion_kind(obj)
        items.append(
            types.CompletionItem(
                label=name,
                kind=kind,
                sort_text=f"a{name}",  # Sort before other completions
                detail=type(obj).__name__,
            )
        )

    return items


def _get_dict_key_completions(
    server: PositronLanguageServer, expr: str, prefix: str
) -> list[types.CompletionItem]:
    """Get dict key completions for dict-like objects (dict, DataFrame, Series, os.environ)."""
    if server.shell is None:
        return []

    # Try to evaluate the expression
    try:
        obj = eval(expr, server.shell.user_ns)
    except Exception:
        return []

    items = []
    keys: list[str] = []

    # Get keys based on the type of object
    if isinstance(obj, dict):
        keys = [str(k) for k in obj if isinstance(k, str)]
    elif _is_environ_like(obj):
        # os.environ or similar
        keys = list(os.environ.keys())
    elif _is_dataframe_like(obj):
        # pandas/polars DataFrame
        with contextlib.suppress(Exception):
            keys = list(obj.columns)
    elif _is_series_like(obj):
        # pandas Series with string index
        with contextlib.suppress(Exception):
            keys = [str(k) for k in obj.index if isinstance(k, str)]

    # Filter by prefix and create completion items
    for key in keys:
        if not key.startswith(prefix):
            continue
        # Include closing quote in label
        items.append(
            types.CompletionItem(
                label=f'{key}"',
                kind=types.CompletionItemKind.Field,
                sort_text=f"a{key}",
                insert_text=f'{key}"',
            )
        )

    return items


def _is_environ_like(obj: Any) -> bool:
    """Check if object is os.environ or similar."""
    type_name = type(obj).__name__
    return type_name == "_Environ" or (
        hasattr(obj, "keys") and hasattr(obj, "__getitem__") and type_name.startswith("_Environ")
    )


def _is_series_like(obj: Any) -> bool:
    """Check if object is a pandas/polars Series."""
    type_name = type(obj).__name__
    module = type(obj).__module__
    return type_name == "Series" and ("pandas" in module or "polars" in module)


def _get_attribute_completions(
    server: PositronLanguageServer, text_before_cursor: str
) -> list[types.CompletionItem]:
    """Get attribute completions for an object."""
    if server.shell is None:
        return []

    # Extract the expression before the last dot
    match = re.match(r".*?(\w[\w\.]*)\.(\w*)$", text_before_cursor)
    if not match:
        return []

    expr, attr_prefix = match.groups()

    # Try to evaluate the expression in the namespace
    try:
        obj = eval(expr, server.shell.user_ns)
    except Exception:
        return []

    items = []

    # Special handling for DataFrame/Series column access
    if _is_dataframe_like(obj):
        items.extend(_get_dataframe_column_completions(obj, attr_prefix))

    # Get regular attributes
    try:
        attrs = dir(obj)
    except Exception:
        attrs = []

    for name in attrs:
        # Skip private/dunder unless typing underscore
        if name.startswith("_") and not attr_prefix.startswith("_"):
            continue
        if not name.startswith(attr_prefix):
            continue

        try:
            attr = getattr(obj, name)
            kind = _get_completion_kind(attr)
            detail = type(attr).__name__
        except Exception:
            kind = types.CompletionItemKind.Property
            detail = None

        items.append(
            types.CompletionItem(
                label=name,
                kind=kind,
                sort_text=f"a{name}",
                detail=detail,
            )
        )

    return items


def _is_dataframe_like(obj: Any) -> bool:
    """Check if object is a DataFrame (without importing pandas)."""
    type_name = type(obj).__name__
    module = type(obj).__module__
    return (type_name == "DataFrame" and "pandas" in module) or (
        type_name in ("DataFrame", "LazyFrame") and "polars" in module
    )


def _get_dataframe_column_completions(obj: Any, prefix: str) -> list[types.CompletionItem]:
    """Get column name completions for DataFrame/Series objects."""
    items = []

    try:
        # Get column names
        if hasattr(obj, "columns"):
            columns = list(obj.columns)
        elif hasattr(obj, "name"):  # Series
            columns = [obj.name] if obj.name else []
        else:
            columns = []

        for col in columns:
            if col is None:
                continue
            col_str = str(col)
            if not col_str.startswith(prefix):
                continue
            items.append(
                types.CompletionItem(
                    label=col_str,
                    kind=types.CompletionItemKind.Field,
                    sort_text=f"0{col_str}",  # Sort columns first
                    detail="column",
                )
            )
    except Exception:
        pass

    return items


def _get_magic_completions(
    server: PositronLanguageServer, text_before_cursor: str
) -> list[types.CompletionItem]:
    """Get magic command completions."""
    if server.shell is None:
        return []

    items = []
    trimmed = text_before_cursor.lstrip()

    try:
        magic_commands = server.shell.magics_manager.lsmagic()
    except Exception:
        return []

    # Cell magics
    for name, func in magic_commands.get("cell", {}).items():
        item = _create_magic_completion_item(server, name, _MagicType.cell, trimmed, func)
        items.append(item)

    # Line magics (unless completing explicit cell magic)
    if not trimmed.startswith(_CELL_MAGIC_PREFIX):
        for name, func in magic_commands.get("line", {}).items():
            item = _create_magic_completion_item(server, name, _MagicType.line, trimmed, func)
            items.append(item)

    return items


def _create_magic_completion_item(
    server: PositronLanguageServer,
    name: str,
    magic_type: _MagicType,
    chars_before_cursor: str,
    func: Callable,
) -> types.CompletionItem:
    """Create a completion item for a magic command."""
    prefix = _CELL_MAGIC_PREFIX if magic_type == _MagicType.cell else _LINE_MAGIC_PREFIX

    # Determine insert_text - handle existing '%' characters
    match = re.search(r"\s*([^\s]*)$", chars_before_cursor)
    text = match.group(1) if match else ""

    match2 = re.match(r"^(%*)", text)
    count = len(match2.group(1)) if match2 else 0
    pad_count = max(0, len(prefix) - count)
    insert_text = prefix[0] * pad_count + name

    label = prefix + name

    # Cache for resolution
    server._magic_completions[label] = (f"{magic_type.value} magic {name}", func.__doc__)  # noqa: SLF001

    return types.CompletionItem(
        label=label,
        filter_text=name,
        kind=types.CompletionItemKind.Function,
        sort_text=f"z{name}",  # Sort after regular completions
        insert_text=insert_text,
        insert_text_format=types.InsertTextFormat.PlainText,
    )


def _get_completion_kind(obj: Any) -> types.CompletionItemKind:
    """Determine the completion kind for an object."""
    if callable(obj):
        if inspect.isclass(obj):
            return types.CompletionItemKind.Class
        else:
            return types.CompletionItemKind.Function
    elif inspect.ismodule(obj):
        return types.CompletionItemKind.Module
    else:
        return types.CompletionItemKind.Variable


def _handle_completion_resolve(
    server: PositronLanguageServer, params: types.CompletionItem
) -> types.CompletionItem:
    """Resolve additional details for a completion item."""
    # Check magic completions cache
    magic = server._magic_completions.get(params.label)  # noqa: SLF001
    if magic:
        params.detail, params.documentation = magic
        return params

    # Try to get more info from namespace
    if server.shell and params.label in server.shell.user_ns:
        obj = server.shell.user_ns[params.label]
        params.detail = type(obj).__name__

        # Get docstring
        doc = inspect.getdoc(obj)
        if doc:
            params.documentation = types.MarkupContent(
                kind=types.MarkupKind.Markdown,
                value=doc,
            )

    return params


# --- Hover Handler ---


def _handle_hover(
    server: PositronLanguageServer, params: types.TextDocumentPositionParams
) -> types.Hover | None:
    """Handle hover requests for Console documents."""
    if server.shell is None:
        return None

    document = server.workspace.get_text_document(params.text_document.uri)
    line = document.lines[params.position.line] if document.lines else ""

    # Get the expression at cursor
    expr = _get_expression_at_position(line, params.position.character)
    if not expr:
        return None

    # Try to evaluate in namespace
    try:
        obj = eval(expr, server.shell.user_ns)
    except Exception:
        return None

    # Build hover content
    parts = []

    # Type info
    type_name = type(obj).__name__
    parts.append(f"**{expr}**: `{type_name}`")

    # DataFrame/Series preview
    if _is_dataframe_like(obj):
        preview = _get_dataframe_preview(obj)
        if preview:
            parts.append(f"\n```\n{preview}\n```")

    # Docstring for functions/classes
    doc = inspect.getdoc(obj)
    if doc:
        parts.append(f"\n---\n{doc}")

    content = "\n".join(parts)

    return types.Hover(
        contents=types.MarkupContent(
            kind=types.MarkupKind.Markdown,
            value=content,
        )
    )


def _get_dataframe_preview(obj: Any, max_rows: int = 5) -> str | None:
    """Get a string preview of a DataFrame."""
    try:
        if hasattr(obj, "head"):
            return str(obj.head(max_rows))
        return str(obj)[:500]
    except Exception:
        return None


# --- Signature Help Handler ---


def _handle_signature_help(
    server: PositronLanguageServer, params: types.TextDocumentPositionParams
) -> types.SignatureHelp | None:
    """Handle signature help requests for Console documents."""
    if server.shell is None:
        return None

    document = server.workspace.get_text_document(params.text_document.uri)
    line = document.lines[params.position.line] if document.lines else ""
    text_before_cursor = line[: params.position.character]

    # Find function call context
    # Simple approach: find the last unclosed parenthesis
    paren_depth = 0
    func_end = -1
    for i in range(len(text_before_cursor) - 1, -1, -1):
        c = text_before_cursor[i]
        if c == ")":
            paren_depth += 1
        elif c == "(":
            if paren_depth == 0:
                func_end = i
                break
            paren_depth -= 1

    if func_end < 0:
        return None

    # Extract function name/expression
    func_expr = text_before_cursor[:func_end].rstrip()
    match = re.search(r"([\w\.]+)$", func_expr)
    if not match:
        return None

    func_name = match.group(1)

    # Try to get the callable
    try:
        obj = eval(func_name, server.shell.user_ns)
    except Exception:
        return None

    if not callable(obj):
        return None

    # Get signature - handle builtins which may not have introspectable signatures
    sig_str = None
    params_list = []
    try:
        sig = inspect.signature(obj)
        sig_str = str(sig)
        params_list.extend(
            types.ParameterInformation(
                label=str(param),
                documentation=None,
            )
            for param in sig.parameters.values()
        )
    except (ValueError, TypeError):
        # For builtins, try to extract signature from docstring
        doc = inspect.getdoc(obj)
        if doc:
            # First line of docstring often contains the signature
            first_line = doc.split("\n")[0]
            # Match patterns like "print(value, ..., sep=' ', end='\n', ...)"
            match = re.match(rf"^{re.escape(func_name.split('.')[-1])}\s*\(([^)]*)\)", first_line)
            if match:
                sig_str = f"({match.group(1)})"
                # Simple parameter extraction
                param_strs = [p.strip() for p in match.group(1).split(",") if p.strip()]
                params_list.extend(
                    types.ParameterInformation(
                        label=p,
                        documentation=None,
                    )
                    for p in param_strs
                )

        if not sig_str:
            return None

    doc = inspect.getdoc(obj)
    signature_info = types.SignatureInformation(
        label=f"{func_name}{sig_str}",
        documentation=doc,
        parameters=params_list,
    )

    # Determine active parameter
    args_text = text_before_cursor[func_end + 1 :]
    active_param = args_text.count(",")

    return types.SignatureHelp(
        signatures=[signature_info],
        active_signature=0,
        active_parameter=active_param,
    )


# --- Help Topic Handler ---


def _handle_help_topic(
    server: PositronLanguageServer, params: HelpTopicParams
) -> ShowHelpTopicParams | None:
    """Handle help topic requests."""
    if server.shell is None:
        return None

    document = server.workspace.get_text_document(params.text_document.uri)
    line = document.lines[params.position.line] if document.lines else ""

    # Get the expression at cursor
    expr = _get_expression_at_position(line, params.position.character)
    if not expr:
        return None

    # Try to resolve the full name
    try:
        obj = eval(expr, server.shell.user_ns)
        # Get the fully qualified name based on the type of object
        if isinstance(obj, type):
            # For classes/types, use the type's module and name
            module = getattr(obj, "__module__", None)
            name = getattr(obj, "__qualname__", getattr(obj, "__name__", expr))
        elif callable(obj):
            # For functions/methods, use their module and name
            module = getattr(obj, "__module__", None)
            name = getattr(obj, "__qualname__", getattr(obj, "__name__", expr))
        else:
            # For instances, use the type's module and name (e.g., int -> builtins.int)
            obj_type = type(obj)
            module = getattr(obj_type, "__module__", None)
            name = getattr(obj_type, "__qualname__", getattr(obj_type, "__name__", expr))

        topic = f"{module}.{name}" if module else name
    except Exception:
        # Fall back to the expression itself
        topic = expr

    logger.info("Help topic found: %s", topic)
    return ShowHelpTopicParams(topic=topic)


# --- Diagnostics ---


@debounce(1, keyed_by="uri")
def _publish_diagnostics_debounced(server: PositronLanguageServer, uri: str) -> None:
    """Publish diagnostics with debouncing."""
    try:
        _publish_diagnostics(server, uri)
    except Exception:
        logger.exception(f"Failed to publish diagnostics for {uri}")


def _publish_diagnostics(server: PositronLanguageServer, uri: str) -> None:
    """Publish syntax diagnostics for a document."""
    if uri not in server.workspace.text_documents:
        return

    document = server.workspace.get_text_document(uri)

    # Comment out magic/shell/help command lines so they don't appear as syntax errors
    source_lines = []
    for line in document.lines:
        trimmed = line.lstrip()
        if trimmed.startswith(
            (_LINE_MAGIC_PREFIX, _SHELL_PREFIX, _HELP_PREFIX_OR_SUFFIX)
        ) or trimmed.rstrip().endswith(_HELP_PREFIX_OR_SUFFIX):
            source_lines.append(f"#{line}")
        else:
            source_lines.append(line)

    source = "".join(source_lines)

    # Check for syntax errors
    diagnostics = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            ast.parse(source)
        except SyntaxError as e:
            if e.lineno is not None:
                # Adjust for 0-based line numbers
                line_no = e.lineno - 1
                col = (e.offset or 1) - 1
                diagnostics.append(
                    types.Diagnostic(
                        range=types.Range(
                            start=types.Position(line=line_no, character=col),
                            end=types.Position(line=line_no, character=col + 1),
                        ),
                        message=e.msg or "Syntax error",
                        severity=types.DiagnosticSeverity.Error,
                        source="positron-lsp",
                    )
                )

    server.text_document_publish_diagnostics(
        types.PublishDiagnosticsParams(uri=uri, diagnostics=diagnostics)
    )


# Create the server instance
POSITRON = create_server()
