#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""Serves nested objects to Positron's Object Explorer, one level at a time."""

from __future__ import annotations

import itertools
import logging
import types
import uuid
from typing import TYPE_CHECKING, Any

import comm

from .access_keys import decode_access_key, encode_access_key
from .inspectors import (
    MapInspector,
    ObjectInspector,
    PositronInspector,
    _BaseCollectionInspector,
    get_inspector,
)
from .object_explorer_comm import (
    ChildrenResult,
    FormattedValue,
    FormatValueParams,
    GetChildrenParams,
    ObjectExplorerBackendMessageContent,
    ObjectExplorerBackendRequest,
    ObjectExplorerFrontendEvent,
    ObjectExplorerState,
    ObjectNode,
    ObjectNodeKind,
    SearchParams,
    SearchResult,
    SearchRow,
    SearchRowMatchKind,
)
from .positron_comm import CommMessage, PositronComm
from .utils import get_qualname
from .variables import _format_value, _summarize_variable
from .variables_comm import ClipboardFormatFormat, VariableKind

if TYPE_CHECKING:
    from collections.abc import Iterator

    from .data_explorer import DataExplorerService

logger = logging.getLogger(__name__)

# The kinds of value whose children the Object Explorer shows, and whose identity is tracked to
# detect cycles.
EXPLORABLE_KINDS = {
    VariableKind.Map.value,
    VariableKind.Collection.value,
    VariableKind.Other.value,
    VariableKind.Class.value,
}

# The most nodes a search visits before it stops early.
SEARCH_NODE_BUDGET = 200_000


def is_explorable(value: Any) -> bool:
    """Whether the Object Explorer can show a value's children."""
    if isinstance(value, types.ModuleType):
        return False
    inspector = get_inspector(value)
    return inspector.get_kind() in EXPLORABLE_KINDS and inspector.has_children()


def _is_container(value: Any) -> bool:
    """Whether a value is a container, whose identity can repeat along a path."""
    return get_inspector(value).get_kind() in EXPLORABLE_KINDS


def child_accessor(inspector: PositronInspector, key: Any) -> str | None:
    """Python code selecting the child `key` of the inspector's value, or None if there is none."""
    if isinstance(inspector, MapInspector):
        return f"[{key!r}]"
    if isinstance(inspector, _BaseCollectionInspector):
        return f"[{key}]"
    if isinstance(inspector, ObjectInspector) and isinstance(key, str) and key.isidentifier():
        return f".{key}"
    return None


def path_accessor(root_name: str, root: Any, path: list[str]) -> str | None:
    """Python code selecting the value at an access key path below a named root, if any."""
    accessor = root_name
    value = root
    for access_key in path:
        inspector = get_inspector(value)
        key = decode_access_key(access_key)
        selector = child_accessor(inspector, key)
        if selector is None:
            return None
        accessor += selector
        value = inspector.get_child(key)
    return accessor


class ObjectExplorerView:
    """One explored object."""

    def __init__(self, root: Any, title: str, root_accessor: str | None) -> None:
        self.root = root
        self.title = title
        self.root_accessor = root_accessor

    def get_state(self, _params: None) -> ObjectExplorerState:
        return ObjectExplorerState(title=self.title, connected=True)

    def get_root(self, _params: None) -> ObjectNode:
        node = self._node("", self.root, self.title, self.root_accessor, set())
        node.access_key = ""
        return node

    def get_children(self, params: GetChildrenParams) -> ChildrenResult:
        parent, accessor, ancestors = self.resolve(params.path)
        inspector = get_inspector(parent)
        if not inspector.has_children():
            return ChildrenResult(children=[], total=0)
        keys = itertools.islice(inspector.get_children(), params.start, params.start + params.limit)
        children = [self._child(inspector, key, accessor, ancestors)[1] for key in keys]
        return ChildrenResult(children=children, total=inspector.get_length())

    def search(self, params: SearchParams) -> SearchResult:
        needle = params.query.casefold()
        rows: list[SearchRow] = []
        # The ancestors of the node being visited, below the root, and whether each was emitted.
        pending: list[tuple[list[str], ObjectNode, list[bool]]] = []
        matches = 0
        visited = 0
        truncated = False

        def visit(value: Any, path: list[str], node: ObjectNode, ancestors: set[int]) -> bool:
            """Visit a node and its descendants; returns True when the search must stop."""
            nonlocal matches, visited, truncated
            if visited >= SEARCH_NODE_BUDGET or matches >= params.max_results:
                truncated = True
                return True
            visited += 1

            match_kind = _match_kind(value, node, needle)
            if match_kind is not None:
                for ancestor_path, ancestor_node, emitted in pending:
                    if not emitted[0]:
                        rows.append(
                            SearchRow(
                                path=ancestor_path,
                                node=ancestor_node,
                                match_kind=SearchRowMatchKind.Ancestor,
                            )
                        )
                        emitted[0] = True
                rows.append(SearchRow(path=path, node=node, match_kind=match_kind))
                matches += 1

            if len(path) >= params.max_depth or not node.has_children:
                return False

            pending.append((path, node, [match_kind is not None]))
            try:
                child_ancestors = {*ancestors, id(value)} if _is_container(value) else ancestors
                for child, child_node in self._children(value, node.accessor, child_ancestors):
                    if visit(child, [*path, child_node.access_key], child_node, child_ancestors):
                        return True
                return False
            finally:
                pending.pop()

        root_ancestors = {id(self.root)} if _is_container(self.root) else set()
        for child, child_node in self._children(self.root, self.root_accessor, root_ancestors):
            if visit(child, [child_node.access_key], child_node, root_ancestors):
                break

        return SearchResult(rows=rows, total_matches=matches, truncated=truncated)

    def format_value(self, params: FormatValueParams) -> FormattedValue:
        value, _, _ = self.resolve(params.path)
        max_length = params.max_length
        if isinstance(value, str):
            # Slice before copying, in case the string is huge.
            content = value if max_length is None else value[: max_length + 1]
        else:
            content = _format_value(value, ClipboardFormatFormat.TextPlain)
        if max_length is not None and len(content) > max_length:
            return FormattedValue(content=content[:max_length], is_truncated=True)
        return FormattedValue(content=content, is_truncated=False)

    def resolve(self, path: list[str]) -> tuple[Any, str | None, set[int]]:
        """
        Resolve the value at an access key path.

        Returns the value, its accessor, and the identities of the containers from the root to it.
        """
        value = self.root
        accessor = self.root_accessor
        ancestors = {id(value)} if _is_container(value) else set()
        for access_key in path:
            inspector = get_inspector(value)
            key = decode_access_key(access_key)
            if not inspector.has_child(key):
                raise KeyError(f"No child {access_key} in {self.title}")
            selector = child_accessor(inspector, key)
            accessor = (
                accessor + selector if accessor is not None and selector is not None else None
            )
            value = inspector.get_child(key)
            if _is_container(value):
                ancestors.add(id(value))
        return value, accessor, ancestors

    def _children(
        self, parent: Any, accessor: str | None, ancestors: set[int]
    ) -> Iterator[tuple[Any, ObjectNode]]:
        """Iterate over every child of a value as (value, node)."""
        inspector = get_inspector(parent)
        if not inspector.has_children():
            return
        for key in inspector.get_children():
            yield self._child(inspector, key, accessor, ancestors)

    def _child(
        self, inspector: PositronInspector, key: Any, accessor: str | None, ancestors: set[int]
    ) -> tuple[Any, ObjectNode]:
        """Get a child of the inspector's value, and its node."""
        try:
            value = inspector.get_child(key)
        except Exception:
            value = "Cannot get value."
        selector = child_accessor(inspector, key)
        node_accessor = (
            accessor + selector if accessor is not None and selector is not None else None
        )
        node = self._node(key, value, inspector.get_display_name(key), node_accessor, ancestors)
        return value, node

    def _node(
        self, key: Any, value: Any, display_name: str, accessor: str | None, ancestors: set[int]
    ) -> ObjectNode:
        is_cycle = _is_container(value) and id(value) in ancestors
        summary = _summarize_variable(key, value, display_name)
        if summary is None:
            # Modules are hidden from the Variables pane, but are shown here as plain values.
            return ObjectNode(
                access_key=encode_access_key(key),
                display_name=display_name,
                display_type=type(value).__name__,
                display_value=get_qualname(value),
                kind=ObjectNodeKind.Other,
                length=0,
                has_children=False,
                is_truncated=False,
                is_cycle=False,
                accessor=accessor,
            )
        return ObjectNode(
            access_key=summary.access_key,
            display_name=summary.display_name,
            display_type=summary.display_type,
            display_value=summary.display_value,
            kind=ObjectNodeKind(summary.kind.value),
            length=summary.length,
            has_children=summary.has_children and not is_cycle,
            is_truncated=summary.is_truncated,
            is_cycle=is_cycle,
            accessor=accessor,
        )


def _match_kind(value: Any, node: ObjectNode, needle: str) -> SearchRowMatchKind | None:
    """
    How a node matches a search, if it does.

    Values match only on leaves, whose display value is the value rather than a summary of their
    children. Cycles are not leaves, though they report no children. Strings match on their full
    text, since their display value may be truncated.
    """
    name_match = needle in node.display_name.casefold()
    is_leaf = not node.has_children and not node.is_cycle
    value_text = value if isinstance(value, str) else node.display_value
    value_match = is_leaf and needle in value_text.casefold()
    if name_match and value_match:
        return SearchRowMatchKind.NameAndValue
    if name_match:
        return SearchRowMatchKind.Name
    if value_match:
        return SearchRowMatchKind.Value
    return None


class ObjectExplorerService:
    """Opens and serves object explorer comms."""

    def __init__(self, comm_target: str, data_explorer_service: DataExplorerService) -> None:
        self.comm_target = comm_target
        self.data_explorer_service = data_explorer_service
        self.comms: dict[str, PositronComm] = {}
        self.views: dict[str, ObjectExplorerView] = {}
        # The variable path each explorer was opened on, if any.
        self.comm_id_to_path: dict[str, tuple[str, ...]] = {}

    def is_supported(self, value: Any) -> bool:
        return is_explorable(value)

    def register_object(
        self,
        value: Any,
        title: str,
        variable_path: list[str] | None = None,
        *,
        root_accessor: str | None = None,
        inline_only: bool = False,
    ) -> str:
        """
        Open an object explorer comm on a value.

        Parameters
        ----------
        value : Any
            The value to explore.
        title : str
            The title of the explorer.
        variable_path : list[str], default None
            The access key path of the variable the value was read from, if any. Explorers on a
            variable are updated when it is reassigned and closed when it is deleted.
        root_accessor : str, default None
            Python code that evaluates to the value, used to build accessors for its children.
        inline_only : bool, default False
            Whether the explorer is shown inline only, rather than in an editor.

        Returns
        -------
        comm_id : str
            The ID of the new comm.
        """
        if not is_explorable(value):
            raise TypeError(type(value))

        comm_id = str(uuid.uuid4())
        data: dict[str, Any] = {"title": title, "inline_only": inline_only}
        if variable_path is not None:
            data["variable_path"] = variable_path
        base_comm = comm.create_comm(target_name=self.comm_target, comm_id=comm_id, data=data)
        base_comm.on_close(lambda _msg: self._close_explorer(comm_id))

        wrapped_comm = PositronComm(base_comm)
        wrapped_comm.on_msg(self.handle_msg, ObjectExplorerBackendMessageContent)
        self.comms[comm_id] = wrapped_comm
        self.views[comm_id] = ObjectExplorerView(value, title, root_accessor)
        if variable_path is not None:
            self.comm_id_to_path[comm_id] = tuple(variable_path)
        return comm_id

    def handle_msg(self, msg: CommMessage[ObjectExplorerBackendMessageContent], _raw_msg) -> None:
        """Handle a request from the frontend."""
        comm_id = msg.content.comm_id
        request = msg.content.data
        view = self.views[comm_id]

        if request.method == ObjectExplorerBackendRequest.OpenObjectExplorer:
            path = self.comm_id_to_path.get(comm_id)
            result = self.register_object(
                view.root,
                view.title,
                list(path) if path is not None else None,
                root_accessor=view.root_accessor,
            )
        elif request.method == ObjectExplorerBackendRequest.ViewTable:
            result = self._view_table(comm_id, request.params.path, request.params.title)
        else:
            result = getattr(view, request.method.value)(getattr(request, "params", None)).dict()
        self.comms[comm_id].send_result(result)

    def _view_table(self, comm_id: str, path: list[str], title: str) -> str:
        """Open a data explorer on the table at a path, returning its comm id."""
        value, _, _ = self.views[comm_id].resolve(path)
        root_path = self.comm_id_to_path.get(comm_id)
        variable_path = [*root_path, *path] if root_path is not None else None
        return self.data_explorer_service.register_table(value, title, variable_path=variable_path)

    def variable_has_active_explorers(self, name: str) -> bool:
        return any(True for _ in self._comm_ids_for_variable(name))

    def handle_variable_updated(self, name: str, value: Any) -> None:
        """Point the explorers on a variable at its new value, or close those that can't be."""
        for comm_id in list(self._comm_ids_for_variable(name)):
            path = self.comm_id_to_path[comm_id]
            new_root = value
            for access_key in path[1:]:
                inspector = get_inspector(new_root)
                key = decode_access_key(access_key)
                if not inspector.has_child(key):
                    new_root = None
                    break
                new_root = inspector.get_child(key)
            if new_root is None or not is_explorable(new_root):
                self._close_explorer(comm_id)
            else:
                self.views[comm_id].root = new_root
                self.comms[comm_id].send_event(ObjectExplorerFrontendEvent.Update.value, {})

    def handle_variable_deleted(self, name: str) -> None:
        for comm_id in list(self._comm_ids_for_variable(name)):
            self._close_explorer(comm_id)

    def shutdown(self) -> None:
        for comm_id in list(self.comms):
            self._close_explorer(comm_id)

    def _comm_ids_for_variable(self, name: str) -> Iterator[str]:
        for comm_id, path in self.comm_id_to_path.items():
            if len(path) > 0 and decode_access_key(path[0]) == name:
                yield comm_id

    def _close_explorer(self, comm_id: str) -> None:
        """Close an explorer's comm and forget it. Idempotent."""
        wrapped_comm = self.comms.pop(comm_id, None)
        self.views.pop(comm_id, None)
        self.comm_id_to_path.pop(comm_id, None)
        if wrapped_comm is not None:
            try:
                wrapped_comm.close()
            except Exception as err:
                logger.warning(err, exc_info=True)
