#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#
from __future__ import annotations

import asyncio
import logging
import types
from collections.abc import Iterable, Mapping
from dataclasses import asdict
from itertools import chain
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Set, Tuple

from comm.base_comm import BaseComm

from .inspectors import MAX_ITEMS, decode_access_key, get_inspector
from .positron_comm import JsonRpcErrorCode, PositronComm
from .utils import JsonData, cancel_tasks, create_task, get_qualname
from .variables_comm import (
    ClearRequest,
    ClipboardFormatFormat,
    ClipboardFormatRequest,
    DeleteRequest,
    FormattedVariable,
    InspectedVariable,
    InspectRequest,
    ListRequest,
    RefreshParams,
    UpdateParams,
    Variable,
    VariableKind,
    VariableList,
    VariablesFrontendEvent,
    VariablesBackendRequest,
    ViewRequest,
)

if TYPE_CHECKING:
    from .positron_ipkernel import PositronIPyKernel

logger = logging.getLogger(__name__)


class VariablesService:
    def __init__(self, kernel: PositronIPyKernel) -> None:
        self.kernel = kernel

        self._comm: Optional[PositronComm] = None

        # Hold strong references to pending tasks to prevent them from being garbage collected
        self._pending_tasks: Set[asyncio.Task] = set()

        self._snapshot: Optional[Dict[str, Any]] = None

    def on_comm_open(self, comm: BaseComm, msg: Dict[str, Any]) -> None:
        """
        Setup positron.variables comm to receive messages.
        """
        self._comm = PositronComm(comm)
        comm.on_msg(self._handle_rpc)

        # Send list on comm initialization
        self.send_refresh_event()

    def _handle_rpc(self, msg: Dict[str, Any]) -> None:
        """
        Handle messages received from the client via the positron.variables comm.
        """
        data = msg["content"]["data"]

        try:
            method = VariablesBackendRequest(data.get("method", None))
        except ValueError:
            self._send_error(
                JsonRpcErrorCode.METHOD_NOT_FOUND,
                f"Unknown method '{data.get('method')}'",
            )
            return

        if method == VariablesBackendRequest.List:
            try:
                request = ListRequest(**data)
                self._send_list()
            except TypeError as exception:
                self._send_error(
                    JsonRpcErrorCode.INVALID_REQUEST,
                    message=f"Invalid list request {data}: {exception}",
                )

        elif method == VariablesBackendRequest.Clear:
            try:
                request = ClearRequest(**data)
                self._delete_all_vars(msg)
            except TypeError as exception:
                self._send_error(
                    JsonRpcErrorCode.INVALID_REQUEST,
                    message=f"Invalid clear request {data}: {exception}",
                )

        elif method == VariablesBackendRequest.Delete:
            try:
                request = DeleteRequest(**data)
                if request.params.names is None:
                    self._missing_param_error("names")
                else:
                    self._delete_vars(request.params.names, msg)
            except TypeError as exception:
                self._send_error(
                    JsonRpcErrorCode.INVALID_REQUEST,
                    message=f"Invalid delete request {data}: {exception}",
                )

        elif method == VariablesBackendRequest.Inspect:
            try:
                request = InspectRequest(**data)
                if request.params.path is None:
                    self._missing_param_error("path")
                else:
                    self._inspect_var(request.params.path)
            except TypeError as exception:
                self._send_error(
                    JsonRpcErrorCode.INVALID_REQUEST,
                    message=f"Invalid inspect request {data}: {exception}",
                )

        elif method == VariablesBackendRequest.ClipboardFormat:
            try:
                request = ClipboardFormatRequest(**data)
                if request.params.path is None:
                    self._missing_param_error("path")
                else:
                    self._send_formatted_var(request.params.path, request.params.format)
            except TypeError as exception:
                self._send_error(
                    JsonRpcErrorCode.INVALID_REQUEST,
                    message=f"Invalid clipboard format request {data}: {exception}",
                )

        elif method == VariablesBackendRequest.View:
            try:
                request = ViewRequest(**data)
                if request.params.path is None:
                    self._missing_param_error("path")
                else:
                    self._open_data_tool(request.params.path)
            except TypeError as exception:
                self._send_error(
                    JsonRpcErrorCode.INVALID_REQUEST,
                    message=f"Invalid view request {data}: {exception}",
                )

        else:
            self._send_error(JsonRpcErrorCode.METHOD_NOT_FOUND, f"Unknown method '{method}'")

    def _missing_param_error(self, param: str) -> None:
        self._send_error(JsonRpcErrorCode.INVALID_PARAMS, f"Missing parameter '{param}'")

    def _send_update(self, assigned: Mapping[str, Any], removed: Set[str]) -> None:
        """
        Sends the list of variables that have changed in the current user session through the
        variables comm to the client.
        """
        # Ensure the number of changes does not exceed our maximum items
        if len(assigned) < MAX_ITEMS and len(removed) < MAX_ITEMS:
            self.__send_update(assigned, removed)
        else:
            # Otherwise, just refresh the client state
            self.send_refresh_event()

    def send_refresh_event(self) -> None:
        """
        Sends a refresh message summarizing the variables of the current user
        session through the variables comm to the client.

        For example:
        {
            "data": {
                "method": "refresh",
                "variables": [{
                    "display_name": "mygreeting",
                    "display_value": "Hello",
                    "kind": "string"
                }]
            }
            ...
        }
        """
        variables = self._get_filtered_vars()
        inspector = get_inspector(variables)
        filtered_variables = inspector.summarize_children(variables, _summarize_variable)

        msg = RefreshParams(
            variables=filtered_variables,
            length=len(filtered_variables),
            version=0,
        )
        self._send_event(VariablesFrontendEvent.Refresh.value, asdict(msg))

    async def shutdown(self) -> None:
        # Cancel and await pending tasks
        await cancel_tasks(self._pending_tasks)

        if self._comm is not None:
            try:
                self._comm.close()
            except Exception:
                pass

    def poll_variables(self) -> None:
        # First check pre_execute snapshot exists
        if self._snapshot is None:
            return

        try:
            # Try to detect the changes made since the last execution
            assigned, removed = self._compare_user_ns()
            self._send_update(assigned, removed)
        except Exception as err:
            logger.warning(err, exc_info=True)

    def snapshot_user_ns(self) -> None:
        """
        Caches a shallow copy snapshot of the user's environment
        before execution and stores it in the hidden namespace.
        """
        ns = self._get_user_ns()
        hidden = self._get_user_ns_hidden()
        self._snapshot = ns.copy()

        # TODO: Determine snapshot strategy for nested objects
        for key, value in ns.items():
            if key in hidden:
                continue

            inspector = get_inspector(value)
            if inspector.is_snapshottable(value):
                self._snapshot[key] = inspector.copy(value)

    def _compare_user_ns(self) -> Tuple[Dict[str, Any], Set[str]]:
        """
        Attempts to detect changes to variables in the user's environment.

        Returns:
            A tuple (dict, set) containing a dict of variables that were modified
            (added or updated) and a set of variables that were removed.
        """
        assert self._snapshot is not None

        assigned = {}
        removed = set()
        after = self._get_user_ns()
        hidden = self._get_user_ns_hidden()

        # Check if a snapshot exists
        snapshot = self._snapshot
        if snapshot is None:
            return assigned, removed

        # Find assigned and removed variables
        for key in chain(snapshot.keys(), after.keys()):
            try:
                if key in hidden:
                    continue

                if key in snapshot and key not in after:
                    # Key was removed
                    removed.add(key)

                elif key not in snapshot and key in after:
                    # Key was added
                    assigned[key] = after[key]

                elif key in snapshot and key in after:
                    v1 = snapshot[key]
                    v2 = after[key]
                    inspector1 = get_inspector(v1)
                    inspector2 = get_inspector(v2)

                    # If type changes or if key's values is no longer
                    # the same after exection
                    if type(inspector1) is not type(inspector2) or not inspector2.equals(v1, v2):
                        assigned[key] = v2

            except Exception as err:
                logger.warning("err: %s", err, exc_info=True)

        return assigned, removed

    def _get_user_ns(self) -> Dict[str, Any]:
        return self.kernel.shell.user_ns or {}

    def _get_user_ns_hidden(self) -> Dict[str, Any]:
        return self.kernel.shell.user_ns_hidden or {}

    # -- Private Methods --

    def _get_filtered_vars(self, variables: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        """
        Returns:
            A filtered dict of the variables, excluding hidden variables. If variables
            is None, the current user namespace in the environment is used.
        """
        hidden = self._get_user_ns_hidden()

        if variables is None:
            variables = self._get_user_ns()

        filtered_variables = {}
        for key, value in variables.items():
            if key not in hidden:
                filtered_variables[key] = value
        return filtered_variables

    def _get_filtered_var_names(self, names: Iterable[str]) -> Set[str]:
        """
        Returns:
            A filtered set of variable names, excluding hidden variables.
        """
        hidden = self._get_user_ns_hidden()

        # Filter out hidden variables
        filtered_names = set()
        for name in names:
            if name in hidden:
                continue
            filtered_names.add(name)
        return filtered_names

    def _find_var(self, path: Iterable[str]) -> Tuple[bool, Any]:
        """
        Finds the variable at the requested path in the current user session.

        Args:
            path: A list of path segments that will be traversed to find
              the requested variable.
            context: The context from which to start the search.

        Returns:
            A tuple (bool, Any) containing a boolean indicating whether the
            variable was found, as well as the value of the variable, if found.
        """

        if path is None:
            return False, None

        is_known = False
        value = None
        context = self._get_user_ns()

        # Walk the given path segment by segment
        for access_key in path:
            # Check for membership via inspector
            inspector = get_inspector(context)
            is_known = inspector.has_child(context, access_key)
            if is_known:
                value = inspector.get_child(context, access_key)

            # Subsequent segment starts from the value
            context = value

            # But we stop if the path segment was unknown
            if not is_known:
                break

        return is_known, value

    def __delete_vars(self, names: Iterable[str], parent: Dict[str, Any]) -> Tuple[dict, set]:
        """
        Deletes the requested variables by name from the current user session.
        """
        if names is None:
            return ({}, set())

        self.snapshot_user_ns()

        for name in names:
            try:
                self.kernel.shell.del_var(name, False)
            except Exception:
                logger.warning(f"Unable to delete variable '{name}'")
                pass

        assigned, removed = self._compare_user_ns()

        # Publish an input to inform clients of the variables that were deleted
        if len(removed) > 0:
            code = "del " + ", ".join(removed)
            self.kernel.publish_execute_input(code, parent)

        return (assigned, removed)

    def __send_update(self, assigned: Mapping[str, Any], removed: Set[str]) -> None:
        """
        Sends updates to the list of variables in the current user session
        through the variables comm to the client.

        For example:
        {
            "data": {
                "method": "refresh",
                "params: {
                    "assigned": [{
                        "display_name": "newvar1",
                        "display_value": "Hello",
                        "kind": "string"
                    }],
                    "removed": ["oldvar1", "oldvar2"]
                }
            }
            ...
        }
        """
        # Filter out hidden assigned variables
        variables = self._get_filtered_vars(assigned)
        inspector = get_inspector(variables)
        filtered_assigned = inspector.summarize_children(variables, _summarize_variable)

        # Filter out hidden removed variables
        filtered_removed = self._get_filtered_var_names(removed)

        if filtered_assigned or filtered_removed:
            msg = UpdateParams(
                assigned=filtered_assigned,
                removed=sorted(filtered_removed),
                version=0,
            )
            self._send_event(VariablesFrontendEvent.Update.value, asdict(msg))

    def _list_all_vars(self) -> List[Variable]:
        variables = self._get_filtered_vars()
        inspector = get_inspector(variables)
        return inspector.summarize_children(variables, _summarize_variable)

    def _send_list(self) -> None:
        filtered_variables = self._list_all_vars()
        msg = VariableList(
            variables=filtered_variables,
            length=len(filtered_variables),
            version=0,
        )
        self._send_result(asdict(msg))

    def _delete_all_vars(self, parent: Dict[str, Any]) -> None:
        """
        Deletes all of the variables in the current user session.

        Args:
            parent:
                A dict providing the parent context for the response,
                e.g. the client message requesting the clear operation
        """
        create_task(self._soft_reset(parent), self._pending_tasks)

        # Notify the frontend that the request is complete.
        # Note that this must be received before the update/refresh event from the async task.
        self._send_result({})

    async def _soft_reset(self, parent: Dict[str, Any]) -> None:
        """
        Use %reset with the soft switch to delete all user defined
        variables from the environment.
        """
        # Run the %reset magic to clear user variables
        code = "%reset -sf"
        await self.kernel.do_execute(code, silent=False, store_history=False)

        # Publish an input to inform clients of the "delete all" operation
        self.kernel.publish_execute_input(code, parent)

        # Refresh the client state
        self.send_refresh_event()

    def _delete_vars(self, names: Iterable[str], parent: Dict[str, Any]) -> None:
        """
        Deletes the requested variables by name from the current user session.

        Args:
            names:
                A list of variable names to delete
            parent:
                A dict providing the parent context for the response,
                e.g. the client message requesting the delete operation
        """
        if names is None:
            return

        assigned, removed = self.__delete_vars(names, parent)
        self._send_result(sorted(removed))

    def _inspect_var(self, path: List[str]) -> None:
        """
        Describes the variable at the requested path in the current user session.

        Args:
            path:
                A list of names describing the path to the variable.
        """

        is_known, value = self._find_var(path)
        if is_known:
            self._send_details(path, value)
        else:
            self._send_error(
                JsonRpcErrorCode.INVALID_PARAMS,
                f"Cannot find variable at '{path}' to inspect",
            )

    def _open_data_tool(self, path: List[str]) -> None:
        """Opens a DataTool comm for the variable at the requested
        path in the current user session.

        """
        if path is None:
            return

        is_known, value = self._find_var(path)
        if not is_known:
            return self._send_error(
                JsonRpcErrorCode.INVALID_PARAMS,
                f"Cannot find variable at '{path}' to view",
            )

        inspector = get_inspector(value)

        # Use the leaf segment to get the title
        access_key = path[-1]

        if not inspector.is_tabular(value):
            # The front end should never get this far with a request
            raise TypeError(f"Type {type(value)} is not supported by DataTool.")

        title = str(decode_access_key(access_key))
        self.kernel.datatool_service.register_table(value, title)
        self._send_result({})

    def _send_event(self, name: str, payload: Dict[str, JsonData]) -> None:
        """
        Send an event payload to the client.
        """
        if self._comm is not None:
            self._comm.send_event(name, payload)
        else:
            logger.warning(f"Cannot send {name} event: comm is not open")

    def _send_error(self, code: JsonRpcErrorCode, message: str) -> None:
        """
        Send an error message to the client.
        """
        if self._comm is not None:
            self._comm.send_error(code, message)
        else:
            logger.warning(f"Cannot send error {message} (code {code}): comm is not open)")

    def _send_result(self, data: JsonData = None) -> None:
        """
        Send an RPC result value to the client.
        """
        if self._comm is not None:
            self._comm.send_result(data)
        else:
            logger.warning(f"Cannot send RPC result: {data}: comm is not open")

    def _send_formatted_var(
        self,
        path: List[str],
        clipboard_format: ClipboardFormatFormat = ClipboardFormatFormat.TextPlain,
    ) -> None:
        """
        Formats the variable at the requested path in the current user session
        using the requested clipboard format and sends the result through the
        variables comm to the client.

        Args:
            path:
                A list of names describing the path to the variable.
            clipboard_format:
                The format to use for the clipboard copy, described as a mime type.
                Defaults to "text/plain".
        """
        if path is None:
            return

        is_known, value = self._find_var(path)
        if is_known:
            content = _format_value(value, clipboard_format)
            msg = FormattedVariable(content=content)
            self._send_result(asdict(msg))
        else:
            self._send_error(
                JsonRpcErrorCode.INVALID_PARAMS,
                f"Cannot find variable at '{path}' to format",
            )

    def _send_details(self, path: List[str], value: Any = None):
        """
        Sends a detailed list of children of the value (or just the value
        itself, if is a leaf node on the path) as a message through the
        variables comm to the client.

        For example:
        {
            "data": {
                "result": {
                    "children": [{
                        "display_name": "property1",
                        "display_value": "Hello",
                        "kind": "string",
                        "display_type": "str"
                    },{
                        "display_name": "property2",
                        "display_value": "123",
                        "kind": "number"
                        "display_type": "int"
                    }]
                }
            }
            ...
        }

        Args:
            path:
                A list of names describing the path to the variable.
            value:
                The variable's value to summarize.
        """

        children = []
        inspector = get_inspector(value)
        if inspector.has_children(value):
            children = inspector.summarize_children(value, _summarize_variable)
        else:
            # Otherwise, treat as a simple value at given path
            summary = _summarize_variable("", value)
            if summary is not None:
                children.append(summary)
            # TODO: Handle scalar objects with a specific message type

        msg = InspectedVariable(children=children, length=len(children))
        self._send_result(asdict(msg))


def _summarize_variable(key: Any, value: Any) -> Optional[Variable]:
    """
    Summarizes the given variable into a Variable object.

    Args:
        key:
            The actual key of the variable in its parent object, used as an input to determine the
            variable's string access key.
        value:
            The variable's value.

    Returns:
        An Variable summary, or None if the variable should be skipped.
    """
    # Hide module types for now
    if isinstance(value, types.ModuleType):
        return None

    try:
        # Use an inspector to summarize the value
        ins = get_inspector(value)

        display_name = ins.get_display_name(key)
        kind_str = ins.get_kind(value)
        kind = VariableKind(kind_str)
        display_value, is_truncated = ins.get_display_value(value)
        display_type = ins.get_display_type(value)
        type_info = ins.get_type_info(value)
        access_key = ins.get_access_key(key)
        length = ins.get_length(value)
        size = ins.get_size(value)
        has_children = ins.has_children(value)
        has_viewer = ins.has_viewer(value)

        return Variable(
            display_name=display_name,
            display_value=display_value,
            display_type=display_type,
            kind=kind,
            type_info=type_info,
            access_key=access_key,
            length=length,
            size=size,
            has_children=has_children,
            has_viewer=has_viewer,
            is_truncated=is_truncated,
        )

    except Exception as err:
        logger.warning(err, exc_info=True)
        return Variable(
            display_name=str(key),
            display_value=get_qualname(value),
            display_type="",
            kind=VariableKind.Other,
            type_info="",
            access_key="",
            length=0,
            size=0,
            has_children=False,
            has_viewer=False,
            is_truncated=False,
        )


def _format_value(value: Any, clipboard_format: ClipboardFormatFormat) -> str:
    """
    Formats the given value using the requested clipboard format.
    """
    inspector = get_inspector(value)

    if clipboard_format == ClipboardFormatFormat.TextHtml:
        return inspector.to_html(value)
    else:
        return inspector.to_plaintext(value)
