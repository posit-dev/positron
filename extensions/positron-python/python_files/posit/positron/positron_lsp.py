#
# Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""
Positron Language Server for Python.

A stripped-down LSP server that provides Positron-specific features:
- Namespace-aware completions (variables from the active Python session)
- DataFrame/Series column completions
- Environment variable completions
- Magic command completions
- Hover with type info, docstring, and DataFrame preview
- Signature help
- Help topic resolution

Static analysis features (go-to-definition, references, rename, symbols, diagnostics)
are delegated to third-party extensions like Pyrefly.
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
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Generator, Optional

from ._vendor import attrs, cattrs
from ._vendor.lsprotocol import types
from ._vendor.pygls.io_ import run_async
from ._vendor.pygls.lsp.server import LanguageServer
from ._vendor.pygls.protocol import LanguageServerProtocol, lsp_method
from .help_comm import ShowHelpTopicParams

if TYPE_CHECKING:
    from comm.base_comm import BaseComm

    from ._vendor.pygls.workspace.text_document import TextDocument
    from .positron_ipkernel import PositronShell

logger = logging.getLogger(__name__)

# Prefixes for special Python/IPython syntax
_COMMENT_PREFIX = "#"
_LINE_MAGIC_PREFIX = "%"
_CELL_MAGIC_PREFIX = "%%"
_SHELL_PREFIX = "!"

# Custom LSP method for help topic requests
_HELP_TOPIC = "positron/textDocument/helpTopic"


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


def _safe_resolve_expression(namespace: dict[str, Any], expr: str) -> Any | None:
    """
    Safely resolve an expression to an object from the namespace.

    This parses the expression as an AST and only allows safe node types:
    - Name: variable lookup from namespace
    - Attribute: getattr() access
    - Subscript with string/int literal: __getitem__() access

    Returns None if the expression is unsafe, invalid, or evaluation fails.
    """
    if not expr or not expr.strip():
        return None

    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError:
        return None

    def resolve_node(node: ast.expr) -> Any:
        """Recursively resolve an AST node to its value."""
        if isinstance(node, ast.Name):
            # Variable lookup from namespace
            if node.id not in namespace:
                raise KeyError(node.id)
            return namespace[node.id]

        elif isinstance(node, ast.Attribute):
            # Attribute access: resolve base, then getattr
            base = resolve_node(node.value)
            return getattr(base, node.attr)

        elif isinstance(node, ast.Subscript):
            # Subscript access: only allow string/int literals
            base = resolve_node(node.value)
            key = node.slice

            if isinstance(key, ast.Constant) and isinstance(key.value, (str, int)):
                return base[key.value]
            # Reject computed subscripts like df[var]
            raise ValueError("Only string/int literal subscripts allowed")

        else:
            # Reject all other node types (Call, BinOp, etc.)
            raise ValueError(f"Unsafe node type: {type(node).__name__}")

    try:
        return resolve_node(tree.body)
    except Exception:
        return None


def _parse_os_imports(source: str) -> dict[str, str]:
    """
    Parse import statements to find os module imports.

    Returns a mapping of alias -> 'os' for any imports of the os module.
    Only supports `import os` and `import os as <alias>` forms.
    Does NOT support `from os import ...` (out of scope).

    Returns empty dict if source is empty, invalid, or has no os imports.
    """
    if not source or not source.strip():
        return {}

    imports: dict[str, str] = {}

    # First try parsing the whole source
    try:
        tree = ast.parse(source, mode="exec")
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "os":
                        key = alias.asname or "os"
                        imports[key] = "os"
        return imports
    except SyntaxError:
        pass

    # If whole source fails to parse (e.g., incomplete code during typing),
    # try to extract and parse just the import statements
    # Split by common statement separators and try each part
    for part in re.split(r"[;\n]", source):
        part = part.strip()
        if not part.startswith("import "):
            continue
        try:
            tree = ast.parse(part, mode="exec")
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name == "os":
                            key = alias.asname or "os"
                            imports[key] = "os"
        except SyntaxError:
            continue

    return imports


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

    # --- Hover ---
    @server.feature(types.TEXT_DOCUMENT_HOVER)
    def hover(params: types.TextDocumentPositionParams) -> types.Hover | None:
        """Provide hover information."""
        return _handle_hover(server, params)

    # --- Signature Help ---
    @server.feature(
        types.TEXT_DOCUMENT_SIGNATURE_HELP,
        types.SignatureHelpOptions(trigger_characters=["(", ","]),
    )
    def signature_help(params: types.TextDocumentPositionParams) -> types.SignatureHelp | None:
        """Provide signature help."""
        return _handle_signature_help(server, params)

    # --- Help Topic ---
    @server.feature(_HELP_TOPIC)
    def help_topic(params: HelpTopicParams) -> ShowHelpTopicParams | None:
        """Return the help topic for the symbol at the cursor."""
        return _handle_help_topic(server, params)


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
    text_after_cursor = line[params.position.character :]

    # Check for parameter completion first (e.g., inside a function call like "f(")
    param_items = _get_parameter_completions(server, text_before_cursor)
    if param_items:
        items.extend(param_items)

    # Determine if we're inside a function call
    inside_function_call = bool(param_items) or _is_inside_function_call(text_before_cursor)

    # Check for dict key access pattern (e.g., x[" or x[')
    # This includes DataFrame column access and environment variables
    dict_key_match = re.search(r'(\w[\w\.]*)\s*\[\s*(["\'])([^"\']*)?$', text_before_cursor)
    if dict_key_match:
        quote_char = dict_key_match.group(2)
        # Check if there's already a closing quote after cursor
        has_closing_quote = text_after_cursor.lstrip().startswith(quote_char)
        items.extend(
            _get_dict_key_completions(
                server,
                expr=dict_key_match.group(1),
                prefix=dict_key_match.group(3) or "",
                quote_char=quote_char,
                has_closing_quote=has_closing_quote,
                document=document,
            )
        )

    # Check for os.getenv() completions (e.g., os.getenv(" or os.getenv(key=")
    getenv_items = _get_getenv_completions(
        server, text_before_cursor, text_after_cursor, document=document
    )
    items.extend(getenv_items)

    # Check for path completions in bare string literals (not dict access, not getenv)
    if not dict_key_match and not getenv_items:
        path_items = _get_path_completions(
            server, text_before_cursor, text_after_cursor, params.position
        )
        if path_items:
            return types.CompletionList(is_incomplete=False, items=path_items)

    if not dict_key_match:
        if "." in text_before_cursor and "(" not in text_before_cursor.split(".")[-1]:
            # Attribute completion (only if not inside a function call)
            items.extend(_get_attribute_completions(server, text_before_cursor))
        elif trimmed_line.startswith((_LINE_MAGIC_PREFIX, _CELL_MAGIC_PREFIX)):
            # Magic command completion only
            pass  # Will add magics below
        else:
            # Namespace completions - always include these so users can use positional arguments
            # When inside a function call, don't filter by prefix to allow any namespace item
            items.extend(
                _get_namespace_completions(
                    server, text_before_cursor, filter_prefix=not inside_function_call
                )
            )

    # Add magic completions if appropriate
    is_completing_attribute = "." in trimmed_line
    has_whitespace = " " in trimmed_line
    has_string = '"' in trimmed_line or "'" in trimmed_line
    if not (is_completing_attribute or has_whitespace or has_string):
        items.extend(_get_magic_completions(server, text_before_cursor))

    return types.CompletionList(is_incomplete=False, items=items) if items else None


def _is_inside_function_call(text_before_cursor: str) -> bool:
    """Check if the cursor is inside a function call (after an opening parenthesis)."""
    # Count unmatched opening parentheses
    paren_depth = 0
    for c in text_before_cursor:
        if c == "(":
            paren_depth += 1
        elif c == ")":
            paren_depth -= 1
    return paren_depth > 0


def _get_parameter_completions(
    server: PositronLanguageServer, text_before_cursor: str
) -> list[types.CompletionItem]:
    """Get parameter completions when inside a function call."""
    if server.shell is None:
        return []

    # Find if we're inside a function call
    func_end = _find_enclosing_paren(text_before_cursor)
    if func_end < 0:
        return []

    # Extract function name/expression
    func_expr = text_before_cursor[:func_end].rstrip()
    match = re.search(r"([\w\.]+)$", func_expr)
    if not match:
        return []

    func_name = match.group(1)

    # Safely resolve the callable
    obj = _safe_resolve_expression(server.shell.user_ns, func_name)
    if obj is None or not callable(obj):
        return []

    # Parse arguments section to understand context
    args_text = text_before_cursor[func_end + 1 :]

    # Skip parameter completions if we're inside a string literal
    if _is_inside_string(args_text):
        return []

    # Check if cursor is right after an "=" sign (meaning we're typing a value, not a parameter name)
    # Pattern: look for "word=" at the end, possibly with a value started
    if re.search(r"\w+\s*=\s*[^\s,]*$", args_text) and not args_text.rstrip().endswith(","):
        # Cursor is positioned after "=" where a value should go, don't suggest parameters
        return []

    # Find all keyword arguments already provided (param=value)
    already_provided = set()
    # Match keyword arguments: word followed by = (but not at the very end being typed)
    for match in re.finditer(r"(\w+)\s*=", args_text):
        param_name = match.group(1)
        # Only add to already_provided if it's followed by something (value or comma)
        # and not being currently typed
        end_pos = match.end()
        if end_pos < len(args_text):
            already_provided.add(param_name)

    # Check if we're currently typing a partial parameter name
    # Look for a partial word at the end that doesn't have "=" after it
    partial_match = re.search(r"(?:^|,\s*)(\w+)$", args_text)
    partial_prefix = partial_match.group(1) if partial_match else ""

    items = []
    try:
        sig = inspect.signature(obj)
        for i, param in enumerate(sig.parameters.values()):
            # Skip *args and **kwargs style parameters
            if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
                continue

            # Skip parameters already provided
            if param.name in already_provided:
                continue

            # If there's a partial prefix, only include parameters that start with it
            if partial_prefix and not param.name.startswith(partial_prefix):
                continue

            # Create completion for parameter name with "="
            items.append(
                types.CompletionItem(
                    label=f"{param.name}=",
                    kind=types.CompletionItemKind.Variable,
                    # Use "0" prefix to sort before namespace completions (which use "a")
                    sort_text=f"0{i:03d}_{param.name}",
                    detail="parameter",
                )
            )
    except (ValueError, TypeError):
        # Can't get signature for this callable
        pass

    return items


def _get_namespace_completions(
    server: PositronLanguageServer, text_before_cursor: str, *, filter_prefix: bool = True
) -> list[types.CompletionItem]:
    """Get completions from the shell's namespace.

    Args:
        server: The language server instance
        text_before_cursor: The text before the cursor position
        filter_prefix: If True, filter completions by the partial word being typed.
                      If False, return all namespace items (useful when inside function calls
                      where user might want to use items as positional arguments).
    """
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
        # Filter by prefix if requested
        if filter_prefix and not name.startswith(prefix):
            continue

        kind = _get_completion_kind(obj)
        items.append(
            types.CompletionItem(
                label=name,
                kind=kind,
                sort_text=f"a{name}",  # Sort after parameter completions
                detail=type(obj).__name__,
            )
        )

    return items


def _get_dict_key_completions(
    server: PositronLanguageServer,
    *,
    expr: str,
    prefix: str,
    quote_char: str,
    has_closing_quote: bool,
    document: TextDocument | None = None,
) -> list[types.CompletionItem]:
    """Get dict key completions for dict-like objects (dict, DataFrame, Series, os.environ)."""
    if server.shell is None:
        return []

    # Safely resolve the expression
    obj = _safe_resolve_expression(server.shell.user_ns, expr)
    if obj is None:
        # Try static analysis fallback for os.environ
        if document is not None:
            os_imports = _parse_os_imports(document.source)
            # Check if expr is "<alias>.environ" where alias maps to "os"
            match = re.match(r"^(\w+)\.environ$", expr)
            if match and os_imports.get(match.group(1)) == "os":
                return _make_env_var_completions(
                    prefix, quote_char, has_closing_quote=has_closing_quote
                )
        return []

    items = []
    keys: list[str] = []

    # Get keys based on the type of object
    if isinstance(obj, dict):
        keys = [str(k) for k in obj if isinstance(k, str)]
    elif _is_environ_like(obj):
        # os.environ or similar - use shared helper
        return _make_env_var_completions(prefix, quote_char, has_closing_quote=has_closing_quote)
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
        # Include closing quote only if it doesn't already exist
        completion_text = key if has_closing_quote else f"{key}{quote_char}"
        # Defer detail computation to completionItem/resolve for performance
        items.append(
            types.CompletionItem(
                label=completion_text,
                kind=types.CompletionItemKind.Field,
                sort_text=f"a{key}",
                insert_text=completion_text,
                data={"type": "dict_key", "expr": expr, "key": key},
            )
        )

    return items


def _get_dict_value_detail(obj: Any, key: str) -> tuple[str | None, types.MarkupContent | None]:
    """Get the detail string and documentation for a dict-like key's value.

    Args:
        obj: The dict-like object (dict, DataFrame, Series)
        key: The key to look up

    Returns:
        A tuple of (detail, documentation) for the value
    """
    with contextlib.suppress(Exception):
        if isinstance(obj, dict):
            value = obj.get(key)
            if value is not None:
                return type(value).__name__, None
        elif _is_dataframe_like(obj):
            # DataFrame column is a Series - show dtype (length) + repr preview
            column = obj[key]
            detail = _get_series_detail(column)
            preview = _get_series_repr_preview(column)
            documentation = (
                types.MarkupContent(
                    kind=types.MarkupKind.Markdown,
                    value=f"```\n{preview}\n```",
                )
                if preview
                else None
            )
            return detail, documentation
        elif _is_series_like(obj):
            value = obj[key]
            return type(value).__name__, None
    return None, None


def _is_environ_like(obj: Any) -> bool:
    """Check if object is os.environ or similar."""
    type_name = type(obj).__name__
    return type_name == "_Environ" or (
        hasattr(obj, "keys") and hasattr(obj, "__getitem__") and type_name.startswith("_Environ")
    )


def _make_env_var_completions(
    prefix: str,
    quote_char: str,
    *,
    has_closing_quote: bool,
) -> list[types.CompletionItem]:
    """Create completion items for environment variables matching prefix."""
    items = []
    for key in os.environ:
        if not key.startswith(prefix):
            continue
        completion_text = key if has_closing_quote else f"{key}{quote_char}"
        items.append(
            types.CompletionItem(
                label=completion_text,
                kind=types.CompletionItemKind.Field,
                sort_text=f"a{key}",
                insert_text=completion_text,
            )
        )
    return items


# --- Path Completion Helpers ---


def _get_path_completion_base_dir(server: PositronLanguageServer) -> Path:
    """Get the base directory for path completions.

    Priority:
    1. server._working_directory (notebook parent or custom workspace)
    2. server.workspace.root_path (project root)
    3. User's home directory (fallback)
    """
    # Priority 1: Working directory (notebook context)
    if server._working_directory:  # noqa: SLF001
        try:
            return Path(server._working_directory)  # noqa: SLF001
        except (ValueError, TypeError):
            pass

    # Priority 2: Workspace root path
    if server.workspace and server.workspace.root_path:
        try:
            return Path(server.workspace.root_path)
        except (ValueError, TypeError):
            pass

    # Priority 3: User's home directory
    return Path.home()


def _parse_partial_path(partial_path: str) -> tuple[str, str]:
    """Parse a partial path into directory and filename components.

    Examples:
        "" → ("", "")
        "my" → ("", "my")
        "dir/" → ("dir/", "")
        "dir/file" → ("dir/", "file")

    Returns:
        Tuple of (directory_part, filename_prefix)
    """
    if not partial_path:
        return ("", "")

    # Normalize path separators to os.sep for processing
    normalized = partial_path.replace("/", os.sep)

    # Check if path ends with separator (completing in a directory)
    if normalized.endswith(os.sep):
        return (partial_path, "")

    # Split into directory and filename
    directory, filename = os.path.split(normalized)

    # Add trailing separator to directory if non-empty
    if directory:
        # Keep original separators in the directory part
        dir_end = len(partial_path) - len(filename)
        directory = partial_path[:dir_end]

    return (directory, filename)


def _scan_directory_for_completions(
    base_dir: Path,
    relative_dir: str,
    filename_prefix: str,
) -> list[tuple[str, bool]]:
    """Scan a directory for matching filesystem entries.

    Args:
        base_dir: Base directory path
        relative_dir: Relative directory from base (e.g., "subdir/")
        filename_prefix: Prefix to filter results (e.g., "my")

    Returns:
        List of (name, is_directory) tuples for matching entries, sorted
        with directories first, then files, alphabetically within each group.
    """
    try:
        # Construct target directory
        if relative_dir:
            # Normalize separators and strip trailing separator
            normalized_dir = relative_dir.replace("/", os.sep).rstrip(os.sep)
            target_dir = base_dir / normalized_dir
        else:
            target_dir = base_dir

        # Check if directory exists and is readable
        if not target_dir.exists() or not target_dir.is_dir():
            return []

        results = []

        # List directory contents
        for entry in target_dir.iterdir():
            entry_name = entry.name

            # Skip hidden files unless prefix starts with "."
            if entry_name.startswith(".") and not filename_prefix.startswith("."):
                continue

            # Filter by prefix (case-sensitive on Unix, case-insensitive on Windows)
            if os.name == "nt":
                if not entry_name.lower().startswith(filename_prefix.lower()):
                    continue
            else:
                if not entry_name.startswith(filename_prefix):
                    continue

            # Add to results
            is_directory = entry.is_dir()
            results.append((entry_name, is_directory))

        # Sort: directories first, then files, alphabetically within each group
        results.sort(key=lambda x: (not x[1], x[0].lower()))

        return results

    except (OSError, PermissionError):
        return []


def _get_path_completions(
    server: PositronLanguageServer,
    text_before_cursor: str,
    text_after_cursor: str,
    position: types.Position,
) -> list[types.CompletionItem]:
    """Get filesystem path completions for string literals.

    Provides incremental completions for paths, completing one segment at a time.
    Directories get trailing slashes, files get auto-closed quotes.

    Args:
        server: The language server instance
        text_before_cursor: Text before cursor position
        text_after_cursor: Text after cursor position
        position: Cursor position for text edit range

    Returns:
        List of completion items for matching filesystem paths
    """
    # Detect if cursor is inside a string literal
    string_match = re.search(r'(["\'])([^"\']*)?$', text_before_cursor)
    if not string_match:
        return []

    quote_char = string_match.group(1)
    partial_path = string_match.group(2) or ""

    # Check for closing quote after cursor
    has_closing_quote = text_after_cursor.lstrip().startswith(quote_char)

    # Get base directory
    base_dir = _get_path_completion_base_dir(server)

    # Parse partial path into directory and filename prefix
    directory_part, filename_prefix = _parse_partial_path(partial_path)

    # Scan directory for matches
    entries = _scan_directory_for_completions(base_dir, directory_part, filename_prefix)
    if not entries:
        return []

    # Create completion items
    items = []
    completion_range = types.Range(position, position)

    for entry_name, is_directory in entries:
        # Calculate what text to insert (incremental completion)
        # Remove the prefix that user has already typed
        remaining = entry_name[len(filename_prefix) :]

        if is_directory:
            # Directories get trailing separator
            completion_text = remaining + "/"
        else:
            # Files: auto-close quote if needed
            completion_text = remaining if has_closing_quote else remaining + quote_char

        # Use InsertReplaceEdit as expected by tests
        text_edit = types.InsertReplaceEdit(
            new_text=completion_text,
            insert=completion_range,
            replace=completion_range,
        )

        kind = types.CompletionItemKind.Folder if is_directory else types.CompletionItemKind.File

        items.append(
            types.CompletionItem(
                label=entry_name,
                kind=kind,
                sort_text=f"0{entry_name}",  # Sort before namespace completions
                text_edit=text_edit,
            )
        )

    return items


def _get_getenv_completions(
    server: PositronLanguageServer,
    text_before_cursor: str,
    text_after_cursor: str,
    document: TextDocument | None = None,
) -> list[types.CompletionItem]:
    """Get environment variable completions for os.getenv() calls.

    Provides completions for the 'key' parameter (first positional or key=)
    but not for the 'default' parameter.
    """
    # Quick early exit: skip expensive parsing if "getenv" isn't in the text
    if server.shell is None or "getenv" not in text_before_cursor:
        return []

    # Check if cursor is inside a string literal (matches opening quote + optional prefix)
    string_match = re.search(r'(["\'])([^"\']*)?$', text_before_cursor)
    if not string_match:
        return []

    quote_char = string_match.group(1)
    prefix = string_match.group(2) or ""
    before_string = text_before_cursor[: string_match.start()]

    # Check for keyword argument (e.g., "key=") - only complete for 'key', not 'default'
    keyword_match = re.search(r"(\w+)\s*=\s*$", before_string)
    if keyword_match and keyword_match.group(1) != "key":
        return []

    # Find the enclosing function call's opening parenthesis
    func_paren_pos = _find_enclosing_paren(before_string)
    if func_paren_pos < 0:
        return []

    # Extract and validate the function name
    func_match = re.search(r"([\w\.]+)\s*$", before_string[:func_paren_pos])
    if not func_match or not func_match.group(1).endswith("getenv"):
        return []

    # Verify it's actually os.getenv (from namespace or static import analysis)
    func_name = func_match.group(1)
    resolved = _safe_resolve_expression(server.shell.user_ns, func_name)
    if resolved is not os.getenv:
        # Try static analysis fallback
        if document is not None:
            os_imports = _parse_os_imports(document.source)
            # Check if func_name is "<alias>.getenv" where alias maps to "os"
            match = re.match(r"^(\w+)\.getenv$", func_name)
            if not (match and os_imports.get(match.group(1)) == "os"):
                return []
        else:
            return []

    # For positional args, only complete the first argument (not 'default')
    if not keyword_match:
        args_text = before_string[func_paren_pos + 1 :]
        if _count_arg_commas(args_text) > 0:
            return []

    has_closing_quote = text_after_cursor.lstrip().startswith(quote_char)
    return _make_env_var_completions(prefix, quote_char, has_closing_quote=has_closing_quote)


def _find_enclosing_paren(text: str) -> int:
    """Find position of the opening parenthesis for the enclosing function call."""
    depth = 0
    for i in range(len(text) - 1, -1, -1):
        c = text[i]
        if c == ")":
            depth += 1
        elif c == "(":
            if depth == 0:
                return i
            depth -= 1
    return -1


def _count_arg_commas(args_text: str) -> int:
    """Count commas in function arguments, ignoring those inside strings or nested parens."""
    count = 0
    in_string = False
    string_char = ""
    depth = 0
    for c in args_text:
        if in_string:
            if c == string_char:
                in_string = False
        elif c in "\"'":
            in_string = True
            string_char = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif c == "," and depth == 0:
            count += 1
    return count


def _is_inside_string(text: str) -> bool:
    """Check if cursor is inside an unclosed string literal."""
    in_string = False
    string_char = ""
    for c in text:
        if in_string:
            if c == string_char:
                in_string = False
        elif c in "\"'":
            in_string = True
            string_char = c
    return in_string


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

    # Safely resolve the expression
    obj = _safe_resolve_expression(server.shell.user_ns, expr)
    if obj is None:
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

    # Handle dict key completions
    if params.data and isinstance(params.data, dict) and params.data.get("type") == "dict_key":
        expr = params.data.get("expr")
        key = params.data.get("key")
        if expr and key and server.shell:
            obj = _safe_resolve_expression(server.shell.user_ns, expr)
            if obj is not None:
                params.detail, params.documentation = _get_dict_value_detail(obj, key)
        return params

    # Try to get more info from namespace
    if server.shell and params.label in server.shell.user_ns:
        obj = server.shell.user_ns[params.label]

        if _is_dataframe_like(obj):
            params.detail = _get_dataframe_detail(obj)
            preview = _get_dataframe_preview(obj)
            if preview:
                params.documentation = types.MarkupContent(
                    kind=types.MarkupKind.Markdown,
                    value=f"```\n{preview}\n```",
                )
        elif _is_series_like(obj):
            params.detail = _get_series_detail(obj)
            preview = _get_series_repr_preview(obj)
            if preview:
                params.documentation = types.MarkupContent(
                    kind=types.MarkupKind.Markdown,
                    value=f"```\n{preview}\n```",
                )
        else:
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

    # Safely resolve the expression
    obj = _safe_resolve_expression(server.shell.user_ns, expr)
    if obj is None:
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


def _get_dataframe_detail(obj: Any) -> str:
    """Get detail string for DataFrame: 'DataFrame (rows x cols)'."""
    try:
        rows, cols = obj.shape
        return f"{type(obj).__name__} ({rows} x {cols})"
    except Exception:
        return type(obj).__name__


def _get_series_detail(obj: Any) -> str:
    """Get detail string for Series: 'dtype (length)'."""
    try:
        dtype = str(obj.dtype)
        length = len(obj)
        return f"{dtype} ({length})"
    except Exception:
        return type(obj).__name__


def _get_series_repr_preview(obj: Any, max_items: int = 10) -> str | None:
    """Get a string preview of a Series."""
    try:
        if hasattr(obj, "head"):
            return str(obj.head(max_items))
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
    func_end = _find_enclosing_paren(text_before_cursor)
    if func_end < 0:
        return None

    # Extract function name/expression
    func_expr = text_before_cursor[:func_end].rstrip()
    match = re.search(r"([\w\.]+)$", func_expr)
    if not match:
        return None

    func_name = match.group(1)

    # Safely resolve the callable
    obj = _safe_resolve_expression(server.shell.user_ns, func_name)
    if obj is None:
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

    # Determine active parameter (count commas, ignoring those inside strings/nested parens)
    args_text = text_before_cursor[func_end + 1 :]
    active_param = _count_arg_commas(args_text)

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
    obj = _safe_resolve_expression(server.shell.user_ns, expr)
    if obj is not None:
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
    else:
        # Fall back to the expression itself
        topic = expr

    logger.info("Help topic found: %s", topic)
    return ShowHelpTopicParams(topic=topic)


# Create the server instance
POSITRON = create_server()
