from typing import Any, Dict, Callable, List, Optional, Tuple
from unittest.mock import Mock

import pytest
from IPython.terminal.interactiveshell import TerminalInteractiveShell
from jedi import Project
from positron.positron_ipkernel import PositronIPyKernel
from pygls.workspace.text_document import TextDocument
from lsprotocol.types import (
    CompletionParams,
    MarkupKind,
    Position,
    TextDocumentIdentifier,
)

from positron.help import ShowTopicRequest
from positron.positron_jedilsp import (
    HelpTopicParams,
    positron_completion,
    positron_help_topic_request,
)


@pytest.fixture
def mock_server(kernel: PositronIPyKernel) -> Callable[[str, str], Mock]:
    """
    Minimum interface for a pylgs server to support LSP unit tests.
    """

    # Return a function that returns a mock server rather than an instantiated mock server,
    # since uri and source change between tests.
    def inner(uri: str, source: str) -> Mock:
        server = Mock()
        server.client_capabilities.text_document.completion.completion_item.documentation_format = (
            list(MarkupKind)
        )
        server.initialization_options.completion.disable_snippets = False
        server.initialization_options.completion.resolve_eagerly = False
        server.initialization_options.completion.ignore_patterns = []
        server.kernel = kernel
        server.project = Project("")
        server.workspace.get_document.return_value = TextDocument(uri, source)

        return server

    return inner


@pytest.mark.parametrize(
    ("source", "position", "namespace", "expected_topic"),
    [
        # An unknown variable should not be resolved.
        ("x", (0, 0), {}, None),
        # ... but a variable in the user's namespace should resolve.
        ("x", (0, 0), {"x": 0}, "builtins.int"),
    ],
)
def test_positron_help_topic_request(
    mock_server: Mock,
    shell: TerminalInteractiveShell,
    source: str,
    position: Tuple[int, int],
    namespace: Dict[str, Any],
    expected_topic: Optional[str],
) -> None:
    shell.user_ns.update(namespace)

    params = HelpTopicParams(TextDocumentIdentifier("file:///foo.py"), Position(*position))
    server = mock_server(params.text_document.uri, source)

    topic = positron_help_topic_request(server, params)

    if expected_topic is None:
        assert topic is None
    else:
        assert topic == ShowTopicRequest(expected_topic)


@pytest.mark.parametrize(
    ("source", "position", "namespace", "expected_completions"),
    [
        # When completions match a variable defined in the source _and_ a variable in the user's namespace,
        # prefer the namespace variable.
        ('x = {"a": 0}\nx["', (1, 3), {"x": {"b": 0}}, ['"b"']),
    ],
)
def test_positron_completion(
    mock_server: Mock,
    shell: TerminalInteractiveShell,
    source: str,
    position: Tuple[int, int],
    namespace: Dict[str, Any],
    expected_completions: List[str],
) -> None:
    shell.user_ns.update(namespace)

    params = CompletionParams(TextDocumentIdentifier("file:///foo.py"), Position(*position))
    server = mock_server(params.text_document.uri, source)

    completion_list = positron_completion(server, params)

    assert completion_list is not None, "No completions returned"

    # TODO: This is actually a bug, we shouldn't be returning magic completions when completing dict keys.
    completions = [item for item in completion_list.items if not item.label.startswith("%")]

    completion_labels = [item.label for item in completions]
    assert completion_labels == expected_completions, "Unexpected completion labels"
