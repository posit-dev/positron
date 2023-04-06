"""Positron extenstions to the Jedi Language Server."""
import asyncio
import os
import sys

# Add the lib path to our sys path so jedi_language_server can find its references
EXTENSION_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(EXTENSION_ROOT, "pythonFiles", "lib", "jedilsp"))

from ipykernel import kernelapp
from positron_ipkernel import PositronIPyKernel
from jedi_language_server.server import (
    JediLanguageServer,
    JediLanguageServerProtocol,
    code_action,
    completion_item_resolve,
    did_close_diagnostics,
    did_change_diagnostics,
    did_open_diagnostics,
    did_save_diagnostics,
    document_symbol,
    definition,
    highlight,
    hover,
    references,
    rename,
    signature_help,
    type_definition,
    workspace_symbol,
    _choose_markup
)
from jedi_language_server import (
    jedi_utils,
    pygls_utils
)
from jedi.api import Interpreter
from lsprotocol.types import (
    CodeActionOptions,
    CompletionItem,
    CodeAction,
    CodeActionKind,
    CodeActionParams,
    CompletionList,
    CompletionOptions,
    CompletionParams,
    DidChangeTextDocumentParams,
    DidCloseTextDocumentParams,
    DidOpenTextDocumentParams,
    DidSaveTextDocumentParams,
    DocumentHighlight,
    DocumentSymbol,
    DocumentSymbolParams,
    Hover,
    Location,
    RenameParams,
    SignatureHelp,
    SignatureHelpOptions,
    SymbolInformation,
    TextDocumentPositionParams,
    WorkspaceEdit,
    WorkspaceSymbolParams,
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
    WORKSPACE_SYMBOL
)
from pygls.capabilities import get_capability
from pygls.feature_manager import has_ls_param_or_annotation
from threading import Event
from typing import Any, Callable, List, Optional, TypeVar, Union

F = TypeVar('F', bound=Callable)

class PositronJediLanguageServer(JediLanguageServer):
    """Positron extenstion to the Jedi language server."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)

    def feature(self, feature_name: str, options: Optional[Any] = None) -> Callable[[F], F]:

        def decorator(f):

            # Unfortunately Jedi doesn't handle subclassing of the LSP, so we
            # need to detect and reject features we did not register.
            if not has_ls_param_or_annotation(f, type(self)):
                return None

            """(Re-)register a feature with the LSP."""
            if feature_name in self.lsp.fm.features:
                del self.lsp.fm.features[feature_name]
            if feature_name in self.lsp.fm.feature_options:
                del self.lsp.fm.feature_options[feature_name]

            return self.lsp.fm.feature(feature_name, options)(f)

        return decorator

    def start(self, lsp_host, lsp_port) -> None:
        """
        Starts IPyKernel and the Jedi LSP in parallel. This arrangement allows
        us to share the active namespaces of the IPyKernel's interpreter with
        the Jedi LSP for enhanced completions.
        """
        loop = asyncio.get_event_loop()
        try:
            asyncio.ensure_future(self.start_ipykernel())
            asyncio.ensure_future(self.start_jedi(lsp_host, lsp_port))
            loop.run_forever()
        except KeyboardInterrupt:
            pass
        finally:
            loop.close()

    async def start_jedi(self, lsp_host, lsp_port):
        """Starts Jedi LSP as a TCP server using existing asyncio loop."""
        self._stop_event = Event()
        loop = asyncio.get_event_loop()
        self._server = await loop.create_server(self.lsp, lsp_host, lsp_port)
        await self._server.serve_forever()

    async def start_ipykernel(self) -> None:
        """Starts Positron's IPyKernel as the interpreter for our console."""
        app = kernelapp.IPKernelApp.instance(kernel_class=PositronIPyKernel)
        app.initialize()
        # Register the kernel for enhanced LSP completions
        global KERNEL
        KERNEL = app.kernel
        app.kernel.start()


POSITRON = PositronJediLanguageServer(
    name="jedi-language-server",
    version="0.18.2",
    protocol_cls=JediLanguageServerProtocol,
)


KERNEL: PositronIPyKernel = None

# Server Features
# Unfortunately we need to re-register these as Pygls Feature Management does
# not support subclassing of the LSP, and Jedi did not use the expected "ls"
# name for the LSP server parameter in the feature registration methods.

@POSITRON.feature(
    TEXT_DOCUMENT_COMPLETION,
    CompletionOptions(
        trigger_characters=[".", "'", '"'], resolve_provider=True
    ),
)
def positron_completion(server: PositronJediLanguageServer, params: CompletionParams) -> Optional[CompletionList]:
    """
    Completion feature.
    """
    # pylint: disable=too-many-locals
    snippet_disable = server.initialization_options.completion.disable_snippets
    resolve_eagerly = server.initialization_options.completion.resolve_eagerly
    ignore_patterns = server.initialization_options.completion.ignore_patterns
    document = server.workspace.get_document(params.text_document.uri)

    # --- Start Positron ---
    # Unfortunately we need to override this entire method to add the kernel
    # interpreter namespace to the list of jedi completions.

    # Get a reference to the kernel's namespace for enhanced completions
    namespaces = []
    global KERNEL
    if KERNEL is not None:
        ns = KERNEL.get_user_ns()
        namespaces.append(ns)

    # Use Interpreter() to include the kernel namespaces in completions
    jedi_script = Interpreter(document.source, namespaces, path=document.path, project=server.project)
    # --- End Positron ---

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
    enable_snippets = (
        snippet_support and not snippet_disable and not is_import_context
    )
    char_before_cursor = pygls_utils.char_before_cursor(
        document=server.workspace.get_document(params.text_document.uri),
        position=params.position,
    )
    jedi_utils.clear_completions_cache()
    # number of characters in the string representation of the total number of
    # completions returned by jedi.
    total_completion_chars = len(str(len(completions_jedi_raw)))
    completion_items = [
        jedi_utils.lsp_completion_item(
            completion=completion,
            char_before_cursor=char_before_cursor,
            enable_snippets=enable_snippets,
            resolve_eagerly=resolve_eagerly,
            markup_kind=markup_kind,
            sort_append_text=str(count).zfill(total_completion_chars),
        )
        for count, completion in enumerate(completions_jedi)
    ]
    return (
        CompletionList(is_incomplete=False, items=completion_items)
        if completion_items
        else None
    )


@POSITRON.feature(COMPLETION_ITEM_RESOLVE)
def positron_completion_item_resolve(
    server: JediLanguageServer, params: CompletionItem
) -> CompletionItem:
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
    return hover(server, params)


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
    return code_action(server, params)


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
