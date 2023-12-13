"""Positron extensions to the Jedi Language Server."""

import asyncio
import enum
import logging
import os
import re
import sys
import threading
from functools import lru_cache
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Type, Union, cast

# Add the lib path to our sys path so jedi_language_server can find its references
EXTENSION_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(EXTENSION_ROOT, "pythonFiles", "lib", "jedilsp"))

import attrs
from comm.base_comm import BaseComm
from jedi.api import Interpreter, Project
from jedi_language_server import jedi_utils, pygls_utils
from jedi_language_server.server import (
    JediLanguageServer,
    JediLanguageServerProtocol,
    _choose_markup,
    completion_item_resolve,
    definition,
    did_change_configuration,
    did_close_diagnostics,
    document_symbol,
    highlight,
    hover,
    references,
    rename,
    signature_help,
    type_definition,
    workspace_symbol,
)
from lsprotocol.types import (
    COMPLETION_ITEM_RESOLVE,
    TEXT_DOCUMENT_CODE_ACTION,
    TEXT_DOCUMENT_COMPLETION,
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
    InsertTextFormat,
    Location,
    Position,
    MarkupContent,
    MarkupKind,
    RenameParams,
    SignatureHelp,
    SignatureHelpOptions,
    SymbolInformation,
    TextDocumentIdentifier,
    TextDocumentPositionParams,
    WorkspaceEdit,
    WorkspaceSymbolParams,
)
from pygls.capabilities import get_capability
from pygls.feature_manager import has_ls_param_or_annotation
from pygls.workspace.text_document import TextDocument


from .help import ShowTopicRequest
from .jedi import PositronInterpreter, get_python_object
from .inspectors import get_inspector, BaseTableInspector, BaseColumnInspector

if TYPE_CHECKING:
    from .positron_ipkernel import PositronIPyKernel


logger = logging.getLogger(__name__)

_LINE_MAGIC_PREFIX = "%"
_CELL_MAGIC_PREFIX = "%%"
_HELP_TOPIC = "positron/textDocument/helpTopic"


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


class PositronJediLanguageServerProtocol(JediLanguageServerProtocol):
    @lru_cache()
    def get_message_type(self, method: str) -> Optional[Type]:
        # Overriden to include custom Positron LSP messages.
        # Doing so ensures that the corresponding feature function receives `params` of the correct type.
        if method == _HELP_TOPIC:
            return HelpTopicRequest
        return super().get_message_type(method)


class PositronJediLanguageServer(JediLanguageServer):
    """Positron extension to the Jedi language server."""

    loop: asyncio.AbstractEventLoop
    lsp: PositronJediLanguageServerProtocol  # type: ignore reportIncompatibleVariableOverride

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)

        # LSP comm used to notify the frontend when the server is ready
        self._comm: Optional[BaseComm] = None

        # Reference to an IPyKernel set on server start
        self.kernel: Optional["PositronIPyKernel"] = None

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

        # Set the event loop's debug mode.
        self.loop.set_debug(self._debug)

        # Use our event loop as the thread's main event loop.
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

    def start(
        self, lsp_host: str, lsp_port: int, kernel: "PositronIPyKernel", comm: BaseComm
    ) -> None:
        """
        Start the LSP with a reference to Positron's IPyKernel to enhance
        completions with awareness of live variables from user's namespace.
        """
        # Give the LSP server access to the LSP comm to notify the frontend when the server is ready
        self._comm = comm

        # Give the LSP server access to the kernel to enhance completions with live variables
        self.kernel = kernel

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
        # forever in >=3.12. See: https://github.com/python/cpython/issues/79033 for more.
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

        # Reset the loop and thread reference to allow starting a new server in the same process,
        # e.g. when a browser-based Positron is refreshed.
        if not self.loop.is_closed():
            self.loop.close()

        self.loop = asyncio.new_event_loop()
        self._server_thread = None

    def stop(self) -> None:
        """Notify the LSP server thread to stop from another thread."""
        if self._stop_event is None:
            logger.warning("Cannot stop the LSP server thread, it was not started")
            return

        self._stop_event.set()

    def set_debug(self, debug: bool) -> None:
        self._debug = debug


POSITRON = PositronJediLanguageServer(
    name="jedi-language-server",
    version="0.18.2",
    protocol_cls=PositronJediLanguageServerProtocol,
    # Provide an event loop, else the pygls Server base class sets its own event loop as the main
    # event loop, which we use to run the kernel.
    loop=asyncio.new_event_loop(),
)

_MAGIC_COMPLETIONS: Dict[str, Any] = {}


# Server Features
# Unfortunately we need to re-register these as Pygls Feature Management does
# not support subclassing of the LSP, and Jedi did not use the expected "ls"
# name for the LSP server parameter in the feature registration methods.


@POSITRON.feature(
    TEXT_DOCUMENT_COMPLETION,
    CompletionOptions(trigger_characters=[".", "'", '"', "%"], resolve_provider=True),
)
def positron_completion(
    server: PositronJediLanguageServer, params: CompletionParams
) -> Optional[CompletionList]:
    """
    Completion feature.
    """
    # pylint: disable=too-many-locals
    snippet_disable = server.initialization_options.completion.disable_snippets
    resolve_eagerly = server.initialization_options.completion.resolve_eagerly
    ignore_patterns = server.initialization_options.completion.ignore_patterns
    document = server.workspace.get_document(params.text_document.uri)

    # --- Start Positron ---
    # Don't complete comments or shell commands
    line = document.lines[params.position.line] if document.lines else ""
    trimmed_line = line.lstrip()
    if trimmed_line.startswith(("#", "!")):
        return None

    # Use Interpreter instead of Script to include the kernel namespaces in completions
    jedi_script = interpreter(server.project, document, server.kernel)

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
            False,
        )
        markup_kind = _choose_markup(server)
        is_import_context = jedi_utils.is_import(
            script_=jedi_script,
            line=jedi_lines[0],
            column=jedi_lines[1],
        )
        enable_snippets = snippet_support and not snippet_disable and not is_import_context
        char_before_cursor = pygls_utils.char_before_cursor(
            document=server.workspace.get_document(params.text_document.uri),
            position=params.position,
        )
        jedi_utils.clear_completions_cache()

        # --- Start Positron ---
        _MAGIC_COMPLETIONS.clear()

        completion_items = []

        # Don't add jedi completions if completing an explicit magic command
        if not trimmed_line.startswith(_LINE_MAGIC_PREFIX):
            jedi_completion_items = [
                jedi_utils.lsp_completion_item(
                    completion=completion,
                    char_before_cursor=char_before_cursor,
                    enable_snippets=enable_snippets,
                    resolve_eagerly=resolve_eagerly,
                    markup_kind=markup_kind,
                    sort_append_text=completion.name,
                )
                for completion in completions_jedi
            ]
            completion_items.extend(jedi_completion_items)

        # Don't add magic completions if:
        # - completing an object's attributes e.g `numpy.<cursor>`
        is_completing_attribute = "." in trimmed_line
        # - or if the trimmed line has additional whitespace characters e.g `if <cursor>`
        has_whitespace = " " in trimmed_line
        # - of if the trimmed line has a string, typically for dict completion e.g. `x['<cursor>`
        has_string = '"' in trimmed_line or "'" in trimmed_line
        exclude_magics = is_completing_attribute or has_whitespace or has_string
        if server.kernel is not None and not exclude_magics:
            magic_commands = cast(
                Dict[str, Dict[str, Callable]], server.kernel.shell.magics_manager.lsmagic()
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
        # Prefix sort_text with 'v', which ensures that it is ordered as an ordinary item
        # See jedi_language_server.jedi_utils.complete_sort_name for reference
        sort_text=f"v{name}",
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

    # Try to include extra information for objects in the user's namespace e.g. dataframes and columns.
    completion = jedi_utils._MOST_RECENT_COMPLETIONS[params.label]
    obj, is_found = get_python_object(completion)
    if is_found:
        inspector = get_inspector(obj)
        if isinstance(inspector, (BaseColumnInspector, BaseTableInspector)):
            params.detail = inspector.get_display_type(obj)

            markup_kind = _choose_markup(server)
            # TODO: We may want to use get_display_value when we update inspectors to return
            # multiline display values once Positron supports it.
            doc = str(obj)
            if markup_kind == MarkupKind.Markdown:
                doc = f"```text\n{doc}\n```"
            params.documentation = MarkupContent(kind=markup_kind, value=doc)
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
    return references(server, params)


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
) -> Optional[ShowTopicRequest]:
    """Return topic to display in Help pane"""
    document = server.workspace.get_document(params.text_document.uri)
    jedi_script = interpreter(server.project, document, server.kernel)
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
        return ShowTopicRequest(topic=topic)


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
    server: PositronJediLanguageServer, params: CodeActionParams
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


# Copied from jedi_language_server/server.py to handle exceptions. Exceptions should be handled by
# pygls, but the debounce decorator causes the function to run in a separate thread thus a separate
# stack from pygls' exception handler.
@jedi_utils.debounce(1, keyed_by="uri")
def _publish_diagnostics(server: JediLanguageServer, uri: str) -> None:
    """Helper function to publish diagnostics for a file."""
    # The debounce decorator delays the execution by 1 second
    # canceling notifications that happen in that interval.
    # Since this function is executed after a delay, we need to check
    # whether the document still exists
    if uri not in server.workspace.documents:
        return

    doc = server.workspace.get_document(uri)

    # --- Start Positron ---
    try:
        diagnostic = jedi_utils.lsp_python_diagnostic(uri, doc.source)
    except Exception:
        logger.exception(f"Failed to publish diagnostics for uri {uri}", exc_info=True)
        diagnostic = None
    # --- End Positron ---

    diagnostics = [diagnostic] if diagnostic else []

    server.publish_diagnostics(uri, diagnostics)


def did_save_diagnostics(server: JediLanguageServer, params: DidSaveTextDocumentParams) -> None:
    """Actions run on textDocument/didSave: diagnostics."""
    _publish_diagnostics(server, params.text_document.uri)


def did_change_diagnostics(server: JediLanguageServer, params: DidChangeTextDocumentParams) -> None:
    """Actions run on textDocument/didChange: diagnostics."""
    _publish_diagnostics(server, params.text_document.uri)


def did_open_diagnostics(server: JediLanguageServer, params: DidOpenTextDocumentParams) -> None:
    """Actions run on textDocument/didOpen: diagnostics."""
    _publish_diagnostics(server, params.text_document.uri)


def interpreter(
    project: Optional[Project], document: TextDocument, kernel: Optional["PositronIPyKernel"]
) -> Interpreter:
    """
    Return a `jedi.Interpreter` with a reference to the kernel's user namespace.
    """
    namespaces: List[Dict[str, Any]] = []
    if kernel is not None:
        namespaces.append(kernel.get_user_ns())

    return PositronInterpreter(document.source, namespaces, path=document.path, project=project)
