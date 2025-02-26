#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import asyncio
import enum
import inspect
import logging
import re
import threading
import warnings
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Type, Union, cast

from comm.base_comm import BaseComm

from ._vendor import attrs, cattrs
from ._vendor.jedi.api import Interpreter, Project, Script
from ._vendor.jedi.api.classes import Completion
from ._vendor.jedi_language_server import jedi_utils, pygls_utils
from ._vendor.jedi_language_server.server import (
    JediLanguageServer,
    JediLanguageServerProtocol,
    _choose_markup,
    completion_item_resolve,
    declaration,
    definition,
    did_change_configuration,
    did_close_diagnostics,
    document_symbol,
    highlight,
    hover,
    rename,
    signature_help,
    type_definition,
    workspace_symbol,
)
from ._vendor.lsprotocol.types import (
    CANCEL_REQUEST,
    COMPLETION_ITEM_RESOLVE,
    INITIALIZE,
    TEXT_DOCUMENT_CODE_ACTION,
    TEXT_DOCUMENT_COMPLETION,
    TEXT_DOCUMENT_DECLARATION,
    TEXT_DOCUMENT_DEFINITION,
    TEXT_DOCUMENT_DID_CHANGE,
    TEXT_DOCUMENT_DID_CLOSE,
    TEXT_DOCUMENT_DID_OPEN,
    TEXT_DOCUMENT_DID_SAVE,
    TEXT_DOCUMENT_DOCUMENT_HIGHLIGHT,
    TEXT_DOCUMENT_DOCUMENT_SYMBOL,
    TEXT_DOCUMENT_HOVER,
    TEXT_DOCUMENT_REFERENCES,
    TEXT_DOCUMENT_RENAME,
    TEXT_DOCUMENT_SIGNATURE_HELP,
    TEXT_DOCUMENT_TYPE_DEFINITION,
    WORKSPACE_DID_CHANGE_CONFIGURATION,
    WORKSPACE_SYMBOL,
    CodeAction,
    CodeActionKind,
    CodeActionOptions,
    CodeActionParams,
    CompletionItem,
    CompletionItemKind,
    CompletionList,
    CompletionOptions,
    CompletionParams,
    DidChangeConfigurationParams,
    DidChangeTextDocumentParams,
    DidCloseTextDocumentParams,
    DidOpenTextDocumentParams,
    DidSaveTextDocumentParams,
    DocumentHighlight,
    DocumentSymbol,
    DocumentSymbolParams,
    Hover,
    InitializeParams,
    InitializeResult,
    InsertReplaceEdit,
    InsertTextFormat,
    Location,
    MessageType,
    Position,
    Range,
    RenameParams,
    SignatureHelp,
    SignatureHelpOptions,
    SymbolInformation,
    TextDocumentIdentifier,
    TextDocumentPositionParams,
    WorkspaceEdit,
    WorkspaceSymbolParams,
)
from ._vendor.pygls.capabilities import get_capability
from ._vendor.pygls.feature_manager import has_ls_param_or_annotation
from ._vendor.pygls.protocol import lsp_method
from ._vendor.pygls.workspace.text_document import TextDocument
from .help_comm import ShowHelpTopicParams
from .jedi import apply_jedi_patches
from .utils import debounce

if TYPE_CHECKING:
    from .positron_ipkernel import PositronShell


logger = logging.getLogger(__name__)

_COMMENT_PREFIX = r"#"
_LINE_MAGIC_PREFIX = r"%"
_CELL_MAGIC_PREFIX = r"%%"
_SHELL_PREFIX = "!"
_HELP_PREFIX_OR_SUFFIX = "?"
_HELP_TOPIC = "positron/textDocument/helpTopic"
_VSCODE_NOTEBOOK_CELL_SCHEME = "vscode-notebook-cell"

# Apply Positron patches to Jedi itself.
apply_jedi_patches()


def _jedi_utils_script(project: Optional[Project], document: TextDocument) -> Script:
    """
    Search the caller stack for the server object and return a Jedi Interpreter object.

    This lets us use an `Interpreter` (with reference to the shell's user namespace) for all LSP
    methods without having to vendor all of that code from `jedi-language-server`.
    """
    # Get the server object from the caller's scope.
    frame = inspect.currentframe()
    if frame is not None and frame.f_back is not None:
        # Get the server object from the caller's scope.
        server = frame.f_back.f_locals.get("server")
        if isinstance(server, PositronJediLanguageServer):
            # Return a Jedi Interpreter.
            return _interpreter(project, document, server.shell)
    raise AssertionError("Could not find server object in the caller's scope")


jedi_utils.script = _jedi_utils_script


@enum.unique
class _MagicType(str, enum.Enum):
    cell = "cell"
    line = "line"


@attrs.define
class HelpTopicParams:
    text_document: TextDocumentIdentifier = attrs.field()
    position: "Position" = attrs.field()


@attrs.define
class HelpTopicRequest:
    id: Union[int, str] = attrs.field()
    params: HelpTopicParams = attrs.field()
    method: str = _HELP_TOPIC
    jsonrpc: str = attrs.field(default="2.0")


@attrs.define
class PositronInitializationOptions:
    """Positron-specific language server initialization options."""

    notebook_path: Optional[Path] = attrs.field(default=None)


class PositronJediLanguageServerProtocol(JediLanguageServerProtocol):
    def __init__(self, server, converter):
        super().__init__(server, converter)

        # See `self._data_received` for a description.
        self._messages_to_handle = []

    @lru_cache  # noqa: B019
    def get_message_type(self, method: str) -> Optional[Type]:
        # Overriden to include custom Positron LSP messages.
        # Doing so ensures that the corresponding feature function receives `params` of the correct type.
        if method == _HELP_TOPIC:
            return HelpTopicRequest
        return super().get_message_type(method)

    @lsp_method(INITIALIZE)
    def lsp_initialize(self, params: InitializeParams) -> InitializeResult:
        result = super().lsp_initialize(params)

        server = self._server

        # Parse Positron-specific initialization options.
        try:
            raw_initialization_options = (params.initialization_options or {}).get("positron", {})
            initialization_options = cattrs.structure(
                raw_initialization_options, PositronInitializationOptions
            )
        except cattrs.BaseValidationError as error:
            # Show an error message in the client.
            msg = f"Invalid PositronInitializationOptions, using defaults: {cattrs.transform_error(error)}"
            server.show_message(msg, msg_type=MessageType.Error)
            server.show_message_log(msg, msg_type=MessageType.Error)
            initialization_options = PositronInitializationOptions()

        # If a notebook path was provided, set the project path to the notebook's parent.
        # See https://github.com/posit-dev/positron/issues/5948.
        notebook_path = initialization_options.notebook_path
        path = notebook_path.parent if notebook_path else self._server.workspace.root_path

        # Create the Jedi Project.
        # Note that this overwrites a Project already created in the parent class.
        workspace_options = server.initialization_options.workspace
        server.project = (
            Project(
                path=path,
                environment_path=workspace_options.environment_path,
                added_sys_path=workspace_options.extra_paths,
                smart_sys_path=True,
                load_unsafe_extensions=False,
            )
            if path
            else None
        )

        return result

    def _data_received(self, data: bytes) -> None:
        # Workaround to a pygls performance issue where the server still executes requests
        # even if they're immediately cancelled.
        # See: https://github.com/openlawlibrary/pygls/issues/517.

        # This should parse `data` and call `self._procedure_handler` with each parsed message.
        # That usually handles each message, but we've overridden it to just add them to a queue.
        self._messages_to_handle = []
        super()._data_received(data)

        def is_request(message):
            return hasattr(message, "method") and hasattr(message, "id")

        def is_cancel_notification(message):
            return getattr(message, "method", None) == CANCEL_REQUEST

        # First pass: find all requests that were cancelled in the same batch of `data`.
        request_ids = set()
        cancelled_ids = set()
        for message in self._messages_to_handle:
            if is_request(message):
                request_ids.add(message.id)
            elif is_cancel_notification(message) and message.params.id in request_ids:
                cancelled_ids.add(message.params.id)

        # Second pass: remove all requests that were cancelled in the same batch of `data`,
        # and the cancel notifications themselves.
        self._messages_to_handle = [
            msg
            for msg in self._messages_to_handle
            if not (
                # Remove cancel notifications whose params.id is in cancelled_ids...
                (is_cancel_notification(msg) and msg.params.id in cancelled_ids)
                # ...or original messages whose id is in cancelled_ids.
                or (is_request(msg) and msg.id in cancelled_ids)
            )
        ]

        # Now handle the messages.
        for message in self._messages_to_handle:
            super()._procedure_handler(message)

    def _procedure_handler(self, message) -> None:
        # Overridden to just queue messages which are handled later in `self._data_received`.
        self._messages_to_handle.append(message)


class PositronJediLanguageServer(JediLanguageServer):
    """Positron extension to the Jedi language server."""

    loop: asyncio.AbstractEventLoop
    lsp: PositronJediLanguageServerProtocol  # type: ignore reportIncompatibleVariableOverride

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)

        # LSP comm used to notify the frontend when the server is ready
        self._comm: Optional[BaseComm] = None

        # Reference to the user's namespace set on server start
        self.shell: Optional[PositronShell] = None

        # The LSP server is started in a separate thread
        self._server_thread: Optional[threading.Thread] = None

        # Enable asyncio debug mode in the event loop
        self._debug = False

    def feature(self, feature_name: str, options: Optional[Any] = None) -> Callable:
        def decorator(f):
            # Unfortunately Jedi doesn't handle subclassing of the LSP, so we
            # need to detect and reject features we did not register.
            if not has_ls_param_or_annotation(f, type(self)):
                return None

            """(Re-)register a feature with the LSP."""
            lsp = self.lsp

            if feature_name in lsp.fm.features:
                del lsp.fm.features[feature_name]
            if feature_name in lsp.fm.feature_options:
                del lsp.fm.feature_options[feature_name]

            return lsp.fm.feature(feature_name, options)(f)

        return decorator

    def start_tcp(self, host: str, port: int) -> None:
        """Starts TCP server."""
        logger.info("Starting TCP server on %s:%s", host, port)

        # Create a new event loop for the LSP server thread.
        self.loop = asyncio.new_event_loop()

        # Set the event loop's debug mode.
        self.loop.set_debug(self._debug)

        # Use our event loop as the thread's current event loop.
        asyncio.set_event_loop(self.loop)

        self._stop_event = threading.Event()
        self._server = self.loop.run_until_complete(self.loop.create_server(self.lsp, host, port))

        # Notify the frontend that the LSP server is ready
        if self._comm is None:
            logger.warning("LSP comm was not set, could not send server_started message")
        else:
            logger.info("LSP server is ready, sending server_started message")
            self._comm.send({"msg_type": "server_started", "content": {}})

        # Run the event loop until the stop event is set.
        try:
            while not self._stop_event.is_set():
                self.loop.run_until_complete(asyncio.sleep(1))
        except (KeyboardInterrupt, SystemExit):
            pass
        finally:
            self.shutdown()

    def start(self, lsp_host: str, lsp_port: int, shell: "PositronShell", comm: BaseComm) -> None:
        """
        Start the LSP.

        Starts with a reference to Positron's IPyKernel to enhance
        completions with awareness of live variables from user's namespace.
        """
        # Give the LSP server access to the LSP comm to notify the frontend when the server is ready
        self._comm = comm

        # Give the LSP server access to the kernel to enhance completions with live variables
        self.shell = shell

        # If self.lsp has been used previously in this process and sucessfully exited, it will be
        # marked with a shutdown flag, which makes it ignore all messages.
        # We reset it here, so we allow the server to start again.
        self.lsp._shutdown = False  # noqa: SLF001

        if self._server_thread is not None:
            logger.warning("LSP server thread was not properly shutdown")
            return

        # Start Jedi LSP as an asyncio TCP server in a separate thread.
        logger.info("Starting LSP server thread")
        self._server_thread = threading.Thread(
            target=self.start_tcp, args=(lsp_host, lsp_port), name="LSPServerThread"
        )
        self._server_thread.start()

    def shutdown(self) -> None:
        logger.info("Shutting down LSP server thread")

        # Below is taken as-is from pygls.server.Server.shutdown to remove awaiting
        # server.wait_closed since it is a no-op if called after server.close in <=3.11 and blocks
        # forever in >=3.12 when exit() is called in the console.
        # See: https://github.com/python/cpython/issues/79033 for more.
        if self._stop_event is not None:
            self._stop_event.set()

        if self._thread_pool:
            self._thread_pool.terminate()
            self._thread_pool.join()

        if self._thread_pool_executor:
            self._thread_pool_executor.shutdown()

        if self._server:
            self._server.close()
            # This is where we should wait for the server to close but don't due to the issue
            # described above.

        # Close the loop and reset the thread reference to allow starting a new server in the same
        # process e.g. when a browser-based Positron is refreshed.
        if not self.loop.is_closed():
            self.loop.close()
        self._server_thread = None

    def stop(self) -> None:
        """Notify the LSP server thread to stop from another thread."""
        if self._stop_event is None:
            logger.warning("Cannot stop the LSP server thread, it was not started")
            return

        self._stop_event.set()

    def set_debug(self, debug: bool) -> None:  # noqa: FBT001
        self._debug = debug


POSITRON = PositronJediLanguageServer(
    name="jedi-language-server",
    version="0.18.2",
    protocol_cls=PositronJediLanguageServerProtocol,
    # Provide an arbitrary not-None value for the event loop to stop `pygls.server.Server.__init__`
    # from creating a new event loop and setting it as the current loop for the current OS thread
    # when this module is imported in the main thread. This allows the kernel to control the event
    # loop for its thread. The LSP's event loop will be created in its own thread in the `start_tcp`
    # method. This may break in future versions of pygls.
    loop=object(),
)

_MAGIC_COMPLETIONS: Dict[str, Any] = {}


# Server Features
# Unfortunately we need to re-register these as Pygls Feature Management does
# not support subclassing of the LSP, and Jedi did not use the expected "ls"
# name for the LSP server parameter in the feature registration methods.


@POSITRON.feature(
    TEXT_DOCUMENT_COMPLETION,
    CompletionOptions(
        trigger_characters=[".", "'", '"', _LINE_MAGIC_PREFIX], resolve_provider=True
    ),
)
def positron_completion(
    server: PositronJediLanguageServer, params: CompletionParams
) -> Optional[CompletionList]:
    """Completion feature."""
    # pylint: disable=too-many-locals
    snippet_disable = server.initialization_options.completion.disable_snippets
    resolve_eagerly = server.initialization_options.completion.resolve_eagerly
    ignore_patterns = server.initialization_options.completion.ignore_patterns
    document = server.workspace.get_text_document(params.text_document.uri)

    # --- Start Positron ---
    # Don't complete comments or shell commands
    line = document.lines[params.position.line] if document.lines else ""
    trimmed_line = line.lstrip()
    if trimmed_line.startswith((_COMMENT_PREFIX, _SHELL_PREFIX)):
        return None

    # Use Interpreter instead of Script to include the shell's namespaces in completions
    jedi_script = _interpreter(server.project, document, server.shell)

    # --- End Positron ---

    try:
        jedi_lines = jedi_utils.line_column(params.position)
        completions_jedi_raw = jedi_script.complete(*jedi_lines)
        if not ignore_patterns:
            # A performance optimization. ignore_patterns should usually be empty;
            # this special case avoid repeated filter checks for the usual case.
            completions_jedi = (comp for comp in completions_jedi_raw)
        else:
            completions_jedi = (
                comp
                for comp in completions_jedi_raw
                if not any(i.match(comp.name) for i in ignore_patterns)
            )
        snippet_support = get_capability(
            server.client_capabilities,
            "text_document.completion.completion_item.snippet_support",
            default=False,
        )
        markup_kind = _choose_markup(server)
        is_import_context = jedi_utils.is_import(
            script_=jedi_script,
            line=jedi_lines[0],
            column=jedi_lines[1],
        )
        enable_snippets = snippet_support and not snippet_disable and not is_import_context
        char_before_cursor = pygls_utils.char_before_cursor(
            document=server.workspace.get_text_document(params.text_document.uri),
            position=params.position,
        )
        char_after_cursor = pygls_utils.char_after_cursor(
            document=server.workspace.get_text_document(params.text_document.uri),
            position=params.position,
        )
        jedi_utils.clear_completions_cache()

        # --- Start Positron ---
        _MAGIC_COMPLETIONS.clear()

        completion_items = []

        # Don't add jedi completions if completing an explicit magic command
        if not trimmed_line.startswith(_LINE_MAGIC_PREFIX):
            for completion in completions_jedi:
                jedi_completion_item = jedi_utils.lsp_completion_item(
                    completion=cast(Completion, completion),
                    char_before_cursor=char_before_cursor,
                    char_after_cursor=char_after_cursor,
                    enable_snippets=enable_snippets,
                    resolve_eagerly=resolve_eagerly,
                    markup_kind=markup_kind,
                    sort_append_text=completion.name,
                )

                # Set the most recent completion using the `label`.
                # `jedi_utils.lsp_completion_item` uses `completion.name` as the key, but
                # `completion` isn't available when accessing the most recent completions dict
                # (in `positron_completion_item_resolve`), and it may differ from the `label`.
                jedi_utils._MOST_RECENT_COMPLETIONS[jedi_completion_item.label] = cast(  # noqa: SLF001
                    Completion, completion
                )

                # If Jedi knows how to complete the expression, use its suggestion.
                new_text = completion.complete
                if new_text is not None:
                    # Using the text_edit attribute (instead of insert_text used in
                    # lsp_completion_item) notifies the client to use the text as is,
                    # which is required to complete paths across `-` symbols,
                    # since the client may treat them as word boundaries.
                    # See https://github.com/posit-dev/positron/issues/5193.
                    #
                    # Use InsertReplaceEdit instead of TextEdit since the latter ends up
                    # setting the deprecated vscode.CompletionItem.textEdit property
                    # in the client. Quarto also doesn't support the textEdit property.
                    # See https://github.com/posit-dev/positron/issues/6444.
                    jedi_completion_item.text_edit = InsertReplaceEdit(
                        new_text=new_text,
                        # Use a range that starts and ends at the cursor position to insert
                        # text at the cursor.
                        insert=Range(params.position, params.position),
                        replace=Range(params.position, params.position),
                    )
                completion_items.append(jedi_completion_item)

        # Don't add magic completions if:
        # - completing an object's attributes e.g `numpy.<cursor>`
        is_completing_attribute = "." in trimmed_line
        # - or if the trimmed line has additional whitespace characters e.g `if <cursor>`
        has_whitespace = " " in trimmed_line
        # - of if the trimmed line has a string, typically for dict completion e.g. `x['<cursor>`
        has_string = '"' in trimmed_line or "'" in trimmed_line
        exclude_magics = is_completing_attribute or has_whitespace or has_string
        if server.shell is not None and not exclude_magics:
            magic_commands = cast(
                Dict[str, Dict[str, Callable]], server.shell.magics_manager.lsmagic()
            )

            chars_before_cursor = trimmed_line[: params.position.character]

            # TODO: In future we may want to support enable_snippets and ignore_pattern options
            # for magic completions.

            # Add cell magic completion items
            cell_magic_completion_items = [
                _magic_completion_item(
                    name=name,
                    magic_type=_MagicType.cell,
                    chars_before_cursor=chars_before_cursor,
                    func=func,
                )
                for name, func in magic_commands[_MagicType.cell].items()
            ]
            completion_items.extend(cell_magic_completion_items)

            # Add line magic completion only if not completing an explicit cell magic
            if not trimmed_line.startswith(_CELL_MAGIC_PREFIX):
                line_magic_completion_items = [
                    _magic_completion_item(
                        name=name,
                        magic_type=_MagicType.line,
                        chars_before_cursor=chars_before_cursor,
                        func=func,
                    )
                    for name, func in magic_commands[_MagicType.line].items()
                ]
                completion_items.extend(line_magic_completion_items)

        # --- End Positron ---
    except ValueError:
        # Ignore LSP errors for completions from invalid line/column ranges.
        logger.info("LSP completion error", exc_info=True)
        completion_items = []

    return CompletionList(is_incomplete=False, items=completion_items) if completion_items else None


def _magic_completion_item(
    name: str,
    magic_type: _MagicType,
    chars_before_cursor: str,
    func: Callable,
) -> CompletionItem:
    """
    Create a completion item for a magic command.

    See `jedi_utils.lsp_completion_item` for reference.
    """
    # Get the appropriate prefix for the magic type
    if magic_type == _MagicType.line:
        prefix = _LINE_MAGIC_PREFIX
    elif magic_type == _MagicType.cell:
        prefix = _CELL_MAGIC_PREFIX
    else:
        raise AssertionError(f"Invalid magic type: {magic_type}")

    # Determine insert_text. This is slightly tricky since we may have to strip leading '%'s

    # 1. Find the last group of non-whitespace characters before the cursor
    m1 = re.search(r"\s*([^\s]*)$", chars_before_cursor)
    assert m1, f"Regex should always match. chars_before_cursor: {chars_before_cursor}"
    text = m1.group(1)

    # 2. Get the leading '%'s
    m2 = re.match("^(%*)", text)
    assert m2, f"Regex should always match. text: {text}"

    # 3. Pad the name with '%'s to match the expected prefix so that e.g. both `bash` and
    # `%bash` complete to `%%bash`
    count = len(m2.group(1))
    pad_count = max(0, len(prefix) - count)
    insert_text = prefix[0] * pad_count + name

    label = prefix + name

    _MAGIC_COMPLETIONS[label] = (f"{magic_type.value} magic {name}", func.__doc__)

    return CompletionItem(
        label=label,
        filter_text=name,
        kind=CompletionItemKind.Function,
        # Prefix sort_text with 'w', which ensures that it is ordered just after ordinary items
        # See jedi_language_server.jedi_utils.complete_sort_name for reference
        sort_text=f"w{name}",
        insert_text=insert_text,
        insert_text_format=InsertTextFormat.PlainText,
    )


@POSITRON.feature(COMPLETION_ITEM_RESOLVE)
def positron_completion_item_resolve(
    server: PositronJediLanguageServer, params: CompletionItem
) -> CompletionItem:
    # --- Start Positron ---
    magic_completion = _MAGIC_COMPLETIONS.get(params.label)
    if magic_completion is not None:
        params.detail, params.documentation = magic_completion
        return params
    # --- End Positron ---
    return completion_item_resolve(server, params)


@POSITRON.feature(
    TEXT_DOCUMENT_SIGNATURE_HELP,
    SignatureHelpOptions(trigger_characters=["(", ","]),
)
def positron_signature_help(
    server: PositronJediLanguageServer, params: TextDocumentPositionParams
) -> Optional[SignatureHelp]:
    return signature_help(server, params)


@POSITRON.feature(TEXT_DOCUMENT_DECLARATION)
def positron_declaration(
    server: PositronJediLanguageServer, params: TextDocumentPositionParams
) -> Optional[List[Location]]:
    return declaration(server, params)


@POSITRON.feature(TEXT_DOCUMENT_DEFINITION)
def positron_definition(
    server: PositronJediLanguageServer, params: TextDocumentPositionParams
) -> Optional[List[Location]]:
    return definition(server, params)


@POSITRON.feature(TEXT_DOCUMENT_TYPE_DEFINITION)
def positron_type_definition(
    server: PositronJediLanguageServer, params: TextDocumentPositionParams
) -> Optional[List[Location]]:
    return type_definition(server, params)


@POSITRON.feature(TEXT_DOCUMENT_DOCUMENT_HIGHLIGHT)
def positron_highlight(
    server: PositronJediLanguageServer, params: TextDocumentPositionParams
) -> Optional[List[DocumentHighlight]]:
    return highlight(server, params)


@POSITRON.thread()
@POSITRON.feature(TEXT_DOCUMENT_HOVER)
def positron_hover(
    server: PositronJediLanguageServer, params: TextDocumentPositionParams
) -> Optional[Hover]:
    try:
        return hover(server, params)
    except ValueError:
        # Ignore LSP errors for hover over invalid line/column ranges.
        logger.info("LSP hover error", exc_info=True)

    return None


@POSITRON.feature(TEXT_DOCUMENT_REFERENCES)
def positron_references(
    server: PositronJediLanguageServer, params: TextDocumentPositionParams
) -> Optional[List[Location]]:
    document = server.workspace.get_text_document(params.text_document.uri)
    # TODO: Don't use an Interpreter until we debug the corresponding test on Python <= 3.9.
    #       Not missing out on much since references don't use namespace information anyway.
    jedi_script = Script(code=document.source, path=document.path, project=server.project)
    jedi_lines = jedi_utils.line_column(params.position)
    names = jedi_script.get_references(*jedi_lines)
    locations = [
        location
        for location in (jedi_utils.lsp_location(name) for name in names)
        if location is not None
    ]
    return locations if locations else None


@POSITRON.feature(TEXT_DOCUMENT_DOCUMENT_SYMBOL)
def positron_document_symbol(
    server: PositronJediLanguageServer, params: DocumentSymbolParams
) -> Optional[Union[List[DocumentSymbol], List[SymbolInformation]]]:
    return document_symbol(server, params)


@POSITRON.feature(WORKSPACE_SYMBOL)
def positron_workspace_symbol(
    server: PositronJediLanguageServer, params: WorkspaceSymbolParams
) -> Optional[List[SymbolInformation]]:
    return workspace_symbol(server, params)


@POSITRON.feature(TEXT_DOCUMENT_RENAME)
def positron_rename(
    server: PositronJediLanguageServer, params: RenameParams
) -> Optional[WorkspaceEdit]:
    return rename(server, params)


@POSITRON.feature(_HELP_TOPIC)
def positron_help_topic_request(
    server: PositronJediLanguageServer, params: HelpTopicParams
) -> Optional[ShowHelpTopicParams]:
    """Return topic to display in Help pane."""
    document = server.workspace.get_text_document(params.text_document.uri)
    jedi_script = _interpreter(server.project, document, server.shell)
    jedi_lines = jedi_utils.line_column(params.position)
    names = jedi_script.infer(*jedi_lines)

    try:
        # if something is found, infer will pass back a list of Name objects
        # but the len is always 1
        topic = names[0].full_name
    except IndexError:
        logger.warning(f"Could not find help topic for request: {params}")
        return None
    else:
        logger.info(f"Help topic found: {topic}")
        return ShowHelpTopicParams(topic=topic)


@POSITRON.feature(
    TEXT_DOCUMENT_CODE_ACTION,
    CodeActionOptions(
        code_action_kinds=[
            CodeActionKind.RefactorInline,
            CodeActionKind.RefactorExtract,
        ],
    ),
)
def positron_code_action(
    server: PositronJediLanguageServer,  # noqa: ARG001
    params: CodeActionParams,  # noqa: ARG001
) -> Optional[List[CodeAction]]:
    # Code Actions are currently causing the kernel process to hang in certain cases, for example,
    # when the document contains `from fastai.vision.all import *`. Temporarily disable these
    # until we figure out the underlying issue.

    # try:
    #     return code_action(server, params)
    # except ValueError:
    #     # Ignore LSP errors for actions with invalid line/column ranges.
    #     logger.info("LSP codeAction error", exc_info=True)

    return None


@POSITRON.feature(WORKSPACE_DID_CHANGE_CONFIGURATION)
def positron_did_change_configuration(
    server: PositronJediLanguageServer,  # pylint: disable=unused-argument
    params: DidChangeConfigurationParams,  # pylint: disable=unused-argument
) -> None:
    return did_change_configuration(server, params)


@POSITRON.feature(TEXT_DOCUMENT_DID_SAVE)
def positron_did_save_diagnostics(
    server: PositronJediLanguageServer, params: DidSaveTextDocumentParams
) -> None:
    return did_save_diagnostics(server, params)


@POSITRON.feature(TEXT_DOCUMENT_DID_CHANGE)
def positron_did_change_diagnostics(
    server: PositronJediLanguageServer, params: DidChangeTextDocumentParams
) -> None:
    return did_change_diagnostics(server, params)


@POSITRON.feature(TEXT_DOCUMENT_DID_OPEN)
def positron_did_open_diagnostics(
    server: PositronJediLanguageServer, params: DidOpenTextDocumentParams
) -> None:
    return did_open_diagnostics(server, params)


@POSITRON.feature(TEXT_DOCUMENT_DID_CLOSE)
def positron_did_close_diagnostics(
    server: PositronJediLanguageServer, params: DidCloseTextDocumentParams
) -> None:
    return did_close_diagnostics(server, params)


@debounce(1, keyed_by="uri")
def _publish_diagnostics_debounced(server: PositronJediLanguageServer, uri: str) -> None:
    # Catch and log any exceptions. Exceptions should be handled by pygls, but the debounce
    # decorator causes the function to run in a separate thread thus a separate stack from pygls'
    # exception handler.
    try:
        _publish_diagnostics(server, uri)
    except Exception:
        logger.exception(f"Failed to publish diagnostics for uri {uri}", exc_info=True)


# Adapted from jedi_language_server/server.py::_publish_diagnostics.
def _publish_diagnostics(server: PositronJediLanguageServer, uri: str) -> None:
    """Helper function to publish diagnostics for a file."""
    # The debounce decorator delays the execution by 1 second
    # canceling notifications that happen in that interval.
    # Since this function is executed after a delay, we need to check
    # whether the document still exists
    if uri not in server.workspace.text_documents:
        return

    doc = server.workspace.get_text_document(uri)

    # Comment out magic/shell/help command lines so that they don't appear as syntax errors.
    source = "\n".join(
        (
            f"#{line}"
            if line.lstrip().startswith((_LINE_MAGIC_PREFIX, _SHELL_PREFIX, _HELP_PREFIX_OR_SUFFIX))
            or line.rstrip().endswith(_HELP_PREFIX_OR_SUFFIX)
            else line
        )
        for line in doc.lines
    )

    # Ignore all warnings during the compile, else they display in the console.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        diagnostic = jedi_utils.lsp_python_diagnostic(uri, source)

    diagnostics = [diagnostic] if diagnostic else []

    server.publish_diagnostics(uri, diagnostics)


def did_save_diagnostics(server: JediLanguageServer, params: DidSaveTextDocumentParams) -> None:
    """Actions run on textDocument/didSave: diagnostics."""
    _publish_diagnostics_debounced(server, params.text_document.uri)  # type: ignore - pyright bug


def did_change_diagnostics(server: JediLanguageServer, params: DidChangeTextDocumentParams) -> None:
    """Actions run on textDocument/didChange: diagnostics."""
    _publish_diagnostics_debounced(server, params.text_document.uri)  # type: ignore - pyright bug


def did_open_diagnostics(server: JediLanguageServer, params: DidOpenTextDocumentParams) -> None:
    """Actions run on textDocument/didOpen: diagnostics."""
    _publish_diagnostics_debounced(server, params.text_document.uri)  # type: ignore - pyright bug


def _interpreter(
    project: Optional[Project], document: TextDocument, shell: Optional["PositronShell"]
) -> Interpreter:
    """Return a `jedi.Interpreter` with a reference to the shell's user namespace."""
    namespaces: List[Dict[str, Any]] = []
    if shell is not None:
        namespaces.append(shell.user_ns)

    return Interpreter(document.source, namespaces, path=document.path, project=project)
