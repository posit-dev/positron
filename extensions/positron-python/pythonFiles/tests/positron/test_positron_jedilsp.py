from typing import Any, Dict, Optional, Tuple
from unittest.mock import Mock
from urllib.parse import unquote, urlparse

import pytest
from jedi import Project
from lsprotocol.types import Position, TextDocumentIdentifier

from positron.help import ShowTopicRequest
from positron.positron_jedilsp import HelpTopicParams, positron_help_topic_request


def mock_server(uri: str, source: str, namespace: Dict[str, Any]) -> Mock:
    document = Mock()
    document.path = unquote(urlparse(uri).path)
    document.source = source

    server = Mock()
    server.kernel.get_user_ns.return_value = namespace
    server.project = Project("")
    server.workspace.get_document.return_value = document

    return server


@pytest.mark.parametrize(
    ("source", "position", "namespace", "topic"),
    [
        # An unknown variable should not be resolved.
        ("x", (0, 0), {}, None),
        # ... but a variable in the user's namespace should resolve.
        ("x", (0, 0), {"x": 0}, "builtins.int"),
    ],
)
def test_positron_help_topic_request(
    source: str, position: Tuple[int, int], namespace: Dict[str, Any], topic: Optional[str]
) -> None:
    params = HelpTopicParams(TextDocumentIdentifier("file:///foo.py"), Position(*position))
    server = mock_server(params.text_document.uri, source, namespace)
    actual = positron_help_topic_request(server, params)
    if topic is None:
        assert actual is None
    else:
        assert actual == ShowTopicRequest(topic)
