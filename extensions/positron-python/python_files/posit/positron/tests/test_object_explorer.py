#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
from __future__ import annotations

import dataclasses
from typing import TYPE_CHECKING, Any

import pytest

from positron.access_keys import encode_access_key
from positron.variables import _summarize_children

from .conftest import DummyComm
from .utils import dummy_rpc_request, json_rpc_request

if TYPE_CHECKING:
    from positron.object_explorer import ObjectExplorerService
    from positron.positron_ipkernel import PositronIPyKernel, PositronShell


@dataclasses.dataclass
class Point:
    x: int
    y: int


@pytest.fixture
def oe_service(kernel: PositronIPyKernel):
    service = kernel.object_explorer_service
    yield service
    service.shutdown()


def _request(service: ObjectExplorerService, comm_id: str, method: str, **params: Any) -> Any:
    """Send a request to an explorer's comm and return the result."""
    comm = service.comms[comm_id].comm
    assert isinstance(comm, DummyComm)
    comm.messages.clear()
    comm.handle_msg(json_rpc_request(method, params or None, comm_id=comm_id))
    assert len(comm.messages) == 1
    return comm.messages[0]["data"]["result"]


def _children(service: ObjectExplorerService, comm_id: str, *path: Any, start=0, limit=1000):
    encoded = [encode_access_key(key) for key in path]
    return _request(service, comm_id, "get_children", path=encoded, start=start, limit=limit)


def _names(result: dict) -> list[str]:
    return [child["display_name"] for child in result["children"]]


def _open(service: ObjectExplorerService, value: Any, name: str = "x") -> str:
    return service.register_object(
        value, name, variable_path=[encode_access_key(name)], root_accessor=name
    )


@pytest.mark.parametrize("value", [{"a": 1, "b": {"c": 2}}, [10, [20]], (10, 20), Point(1, 2)])
def test_children_match_the_variables_pane(oe_service: ObjectExplorerService, value):
    comm_id = _open(oe_service, value)

    result = _children(oe_service, comm_id)

    def fields(name, type_, value_):
        return (name, type_, value_)

    assert [
        fields(c["display_name"], c["display_type"], c["display_value"]) for c in result["children"]
    ] == [
        fields(v.display_name, v.display_type, v.display_value) for v in _summarize_children(value)
    ]
    assert result["total"] == len(result["children"])


def test_root(oe_service: ObjectExplorerService):
    comm_id = _open(oe_service, {"a": 1})

    root = _request(oe_service, comm_id, "get_root")

    assert (root["display_name"], root["display_type"], root["accessor"], root["has_children"]) == (
        "x",
        "dict [1]",
        "x",
        True,
    )


def test_paging(oe_service: ObjectExplorerService):
    comm_id = _open(oe_service, {f"k{i}": i for i in range(2500)})

    result = _children(oe_service, comm_id, start=1000, limit=1000)

    assert result["total"] == 2500
    assert len(result["children"]) == 1000
    assert (result["children"][0]["display_name"], result["children"][-1]["display_name"]) == (
        "k1000",
        "k1999",
    )


def test_cycle(oe_service: ObjectExplorerService):
    d: dict[str, Any] = {"n": 1}
    d["self"] = d
    comm_id = _open(oe_service, d)

    (child,) = [
        c for c in _children(oe_service, comm_id)["children"] if c["display_name"] == "self"
    ]

    assert (child["is_cycle"], child["has_children"]) == (True, False)


def test_accessors(oe_service: ObjectExplorerService):
    comm_id = _open(oe_service, {"a": [{"b": 1}], "p": Point(1, 2)})

    (b,) = _children(oe_service, comm_id, "a", 0)["children"]
    x, _ = _children(oe_service, comm_id, "p")["children"]

    assert (b["accessor"], x["accessor"]) == ("x['a'][0]['b']", "x['p'].x")


def test_format_value(oe_service: ObjectExplorerService):
    value = {"long": list(range(500))}
    comm_id = _open(oe_service, value)

    result = _request(oe_service, comm_id, "format_value", path=[encode_access_key("long")])

    assert result["content"] == repr(value["long"])


def test_open_object_explorer_opens_another(oe_service: ObjectExplorerService):
    comm_id = _open(oe_service, {"a": 1})

    new_id = _request(oe_service, comm_id, "open_object_explorer")

    assert new_id != comm_id
    assert oe_service.views[new_id].root is oe_service.views[comm_id].root


SEARCH_FIXTURE = {"alpha": {"beta": [1, "needle", {"gamma": "needle"}]}, "delta": "haystack"}


def _search(service: ObjectExplorerService, value: Any, query: str, max_depth=10, max_results=1000):
    comm_id = _open(service, value)
    result = _request(
        service, comm_id, "search", query=query, max_depth=max_depth, max_results=max_results
    )
    rows = ["/".join(row["path"]) + ":" + row["match_kind"] for row in result["rows"]]
    return rows, result


def test_search(oe_service: ObjectExplorerService):
    rows, result = _search(oe_service, SEARCH_FIXTURE, "NEEDLE")

    alpha, beta, one, two, gamma = (encode_access_key(k) for k in ["alpha", "beta", 1, 2, "gamma"])
    assert rows == [
        f"{alpha}:ancestor",
        f"{alpha}/{beta}:ancestor",
        f"{alpha}/{beta}/{one}:value",
        f"{alpha}/{beta}/{two}:ancestor",
        f"{alpha}/{beta}/{two}/{gamma}:value",
    ]
    assert (result["total_matches"], result["truncated"]) == (2, False)


def test_search_limits(oe_service: ObjectExplorerService):
    rows, _ = _search(oe_service, SEARCH_FIXTURE, "needle", max_depth=3)
    _, truncated = _search(oe_service, SEARCH_FIXTURE, "needle", max_results=1)

    assert len(rows) == 3
    assert (truncated["total_matches"], truncated["truncated"]) == (1, True)


def test_search_matches_names_and_terminates_on_cycles(oe_service: ObjectExplorerService):
    d: dict[str, Any] = {"needle": 1, "needles": "needle"}
    d["loop"] = d

    rows, _ = _search(oe_service, d, "needle")

    assert rows == [
        f"{encode_access_key('needle')}:name",
        f"{encode_access_key('needles')}:name_and_value",
    ]


def test_update_and_delete(shell: PositronShell, oe_service: ObjectExplorerService):
    shell.run_cell("x = {'a': {'b': 1}}")
    comm_id = _open(oe_service, shell.user_ns["x"])
    nested_id = oe_service.register_object(
        shell.user_ns["x"]["a"],
        "a",
        variable_path=[encode_access_key("x"), encode_access_key("a")],
    )
    comm = oe_service.comms[comm_id].comm
    assert isinstance(comm, DummyComm)
    comm.messages.clear()

    # Reassigning keeps explorers whose path still resolves, and closes the rest.
    oe_service.handle_variable_updated("x", {"c": 2})
    assert comm.messages[-1]["data"]["method"] == "update"
    assert nested_id not in oe_service.comms

    oe_service.handle_variable_deleted("x")
    assert comm_id not in oe_service.comms


def test_view_rpc_opens_object_explorer(
    shell: PositronShell, oe_service: ObjectExplorerService, variables_comm: DummyComm
):
    shell.run_cell("d = {'a': {'b': [1, 2]}}")

    variables_comm.handle_msg(
        dummy_rpc_request("view", {"path": [encode_access_key("d"), encode_access_key("a")]})
    )

    comm_id = variables_comm.messages[-1]["data"]["result"]
    assert oe_service.views[comm_id].root_accessor == "d['a']"


@pytest.mark.parametrize("source", ["d = {'a': 1}", "d = [[1], 2]", "d = Point(1, 2)"])
def test_view_magic_opens_object_explorer(
    shell: PositronShell, oe_service: ObjectExplorerService, source: str
):
    shell.user_ns["Point"] = Point
    shell.run_cell(f"{source}\n%view d")

    (view,) = oe_service.views.values()
    assert view.root is shell.user_ns["d"]


@pytest.mark.usefixtures("oe_service")
def test_view_magic_rejects_unexplorable(shell: PositronShell, capsys):
    shell.run_cell("x = object()\n%view x")

    assert capsys.readouterr().err == "UsageError: cannot view object of type 'object'\n"
