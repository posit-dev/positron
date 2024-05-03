"""
Inspectors are totally decoupled from the variables pane and
all other Positron (and even non-Positron) components.
They solve the general problem of providing a consistent interface
over a variety types from popular Python libraries.
"""

#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#
from __future__ import annotations

import asyncio
import logging
import time
import types
from collections.abc import Iterable, Mapping
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Set, Tuple

from comm.base_comm import BaseComm

from .access_keys import decode_access_key, encode_access_key
from .inspectors import CopyError, get_inspector
from .positron_comm import CommMessage, JsonRpcErrorCode, PositronComm
from .utils import JsonData, JsonRecord, cancel_tasks, create_task, get_qualname
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
    VariablesBackendMessageContent,
    VariablesFrontendEvent,
    ViewRequest,
)

if TYPE_CHECKING:
    from .positron_ipkernel import PositronIPyKernel

logger = logging.getLogger(__name__)

# Maximum number of children to show in an object's expanded view.
MAX_CHILDREN: int = 100

# Maximum number of items to send in an update event. If exceeded, a
# full refresh is sent instead.
MAX_ITEMS: int = 10000

# Budget for number of "units" of work to allow for namespace change
# detection. The costs are defined in inspectors.py
MAX_SNAPSHOT_COMPARISON_BUDGET: int = 10_000_000


def _resolve_value_from_path(context: Any, path: Iterable[str]) -> Any:
    """
    Use inspectors to possibly resolve nested value from context
    """
    is_known = False
    value = None
    for access_key in path:
        # Check for membership via inspector
        inspector = get_inspector(context)
        key = decode_access_key(access_key)
        is_known = inspector.has_child(key)
        if is_known:
            value = inspector.get_child(key)

        # Subsequent segment starts from the value
        context = value

        # But we stop if the path segment was unknown
        if not is_known:
            break
    return is_known, value


class VariablesService:
    def __init__(self, kernel: PositronIPyKernel) -> None:
        self.kernel = kernel

        self._comm: Optional[PositronComm] = None

        # Hold strong references to pending tasks to prevent them from being garbage collected
        self._pending_tasks: Set[asyncio.Task] = set()

        self._snapshot: Optional[Dict[str, Any]] = None

    def on_comm_open(self, comm: BaseComm, msg: JsonRecord) -> None:
        """
        Setup positron.variables comm to receive messages.
        """
        self._comm = PositronComm(comm)
        self._comm.on_msg(self.handle_msg, VariablesBackendMessageContent)

        # Send list on comm initialization
        self.send_refresh_event()

    def handle_msg(
        self,
        msg: CommMessage[VariablesBackendMessageContent],
        raw_msg: JsonRecord,
    ) -> None:
        """
        Handle messages received from the client via the positron.variables comm.
        """
        request = msg.content.data

        if isinstance(request, ListRequest):
            self._send_list()

        elif isinstance(request, ClearRequest):
            self._delete_all_vars(raw_msg)

        elif isinstance(request, DeleteRequest):
            self._delete_vars(request.params.names, raw_msg)

        elif isinstance(request, InspectRequest):
            self._inspect_var(request.params.path)

        elif isinstance(request, ClipboardFormatRequest):
            self._send_formatted_var(request.params.path, request.params.format)

        elif isinstance(request, ViewRequest):
            self._perform_view_action(request.params.path)

        else:
            logger.warning(f"Unhandled request: {request}")

    def _send_update(self, assigned: Mapping[str, Any], removed: Set[str]) -> None:
        """
        Sends the list of variables that have changed in the current
        user session through the variables comm to the client.

        TODO: Fix below docstring, see positron#2319

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
        # Look for any assigned or removed variables that are active
        # in the data explorer service
        exp_service = self.kernel.data_explorer_service
        con_service = self.kernel.connections_service
        for name in removed:
            if exp_service.variable_has_active_explorers(name):
                exp_service.handle_variable_deleted(name)

            if con_service.variable_has_active_connection(name):
                con_service.handle_variable_deleted(name)

        for name, value in assigned.items():
            if exp_service.variable_has_active_explorers(name):
                exp_service.handle_variable_updated(name, value)

            if con_service.variable_has_active_connection(name):
                con_service.handle_variable_updated(name, value)

        # Ensure the number of changes does not exceed our maximum items
        if len(assigned) > MAX_ITEMS or len(removed) > MAX_ITEMS:
            return self.send_refresh_event()

        # Filter out hidden assigned variables
        variables = self._get_filtered_vars(assigned)
        filtered_assigned = _summarize_children(variables, MAX_ITEMS)

        # Filter out hidden removed variables and encode access keys
        hidden = self._get_user_ns_hidden()
        filtered_removed = [
            encode_access_key(name) for name in sorted(removed) if name not in hidden
        ]

        if filtered_assigned or filtered_removed:
            msg = UpdateParams(
                assigned=filtered_assigned,
                removed=filtered_removed,
                version=0,
            )
            self._send_event(VariablesFrontendEvent.Update.value, msg.dict())

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
        filtered_variables = _summarize_children(variables, MAX_ITEMS)

        msg = RefreshParams(
            variables=filtered_variables,
            length=len(filtered_variables),
            version=0,
        )
        self._send_event(VariablesFrontendEvent.Refresh.value, msg.dict())

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
        Creates a conservative "snapshot" of the user namespace to
        enable variable change detection without having to do a full
        refresh of the variables view any time the user executes
        code. Because many objects (any mutable Python collection, or
        some data structures like pandas, NumPy, or PyTorch objects)
        require a deep copy to support change detection, we only
        copy-and-compare such objects up to a certain limit to keep
        the execution overhead to a minimum when namespaces get large
        or contain many large mutable objects.
        """
        ns = self._get_user_ns()
        hidden = self._get_user_ns_hidden()

        # Variables which are immutable and thus can be compared by
        # reference
        immutable_vars = {}

        # Mutable variables which fall within the limit of
        # "reasonable" expense for a copy and deep comparison after
        # code execution.
        mutable_vars_copied = {}

        # Names of mutable variables that are excluded from the change
        # detection logic either because the cost is too large or
        # cannot be estimated easily (for example, any collection
        # containing arbitrary Python objects may be arbitrarily
        # expensive to deepcopy and do comparisons on)
        mutable_vars_excluded = {}

        comparison_cost = 0

        start = time.time()

        for key, value in ns.items():
            if key in hidden:
                continue

            inspector = get_inspector(value)

            if inspector.is_mutable():
                cost = inspector.get_comparison_cost()
                if comparison_cost + cost > MAX_SNAPSHOT_COMPARISON_BUDGET:
                    mutable_vars_excluded[key] = value
                else:
                    comparison_cost += cost
                    try:
                        mutable_vars_copied[key] = inspector.copy()
                    except CopyError:
                        # when a variable is mutable, but not copiable we can't
                        # detect changes on it
                        mutable_vars_excluded[key] = value
            else:
                immutable_vars[key] = value

        self._snapshot = {
            "immutable": immutable_vars,
            "mutable_copied": mutable_vars_copied,
            "mutable_excluded": mutable_vars_excluded,
        }
        elapsed = time.time() - start
        logger.debug(f"Snapshotting namespace took {elapsed:.4f} seconds")

        copied = repr(list(self._snapshot["mutable_copied"].keys()))
        logger.debug(f"Variables copied: {copied}")

    def _compare_user_ns(self) -> Tuple[Dict[str, Any], Set[str]]:
        """
        Attempts to detect changes to variables in the user's environment.

        Returns
        -------
        A tuple (dict, set) containing a dict of variables that
        were modified (added or updated) and a set of variables
        that were removed.
        """
        assigned = {}
        removed = set()

        if self._snapshot is None:
            return assigned, removed

        after = self._get_user_ns()
        hidden = self._get_user_ns_hidden()

        snapshot = self._snapshot

        def _compare_immutable(v1, v2):
            # For immutable objects we can compare object references
            return v1 is not v2

        def _compare_mutable(v1, v2):
            inspector1 = get_inspector(v1)
            inspector2 = get_inspector(v2)

            return type(inspector1) is not type(inspector2) or not inspector1.equals(v2)

        def _compare_always_different(v1, v2):
            return True

        all_snapshot_keys = set()

        def _check_ns_subset(ns_subset, are_different_func):
            all_snapshot_keys.update(ns_subset.keys())

            for key, value in ns_subset.items():
                try:
                    if key in hidden:
                        continue

                    if key not in after:
                        # Key was removed
                        removed.add(key)
                    elif are_different_func(value, after[key]):
                        assigned[key] = after[key]
                except Exception as err:
                    logger.warning("err: %s", err, exc_info=True)
                    raise

        start = time.time()

        _check_ns_subset(snapshot["immutable"], _compare_immutable)
        _check_ns_subset(snapshot["mutable_copied"], _compare_mutable)
        _check_ns_subset(snapshot["mutable_excluded"], _compare_always_different)

        for key, value in after.items():
            if key in hidden:
                continue

            if key not in all_snapshot_keys:
                assigned[key] = value

        elapsed = time.time() - start
        logger.debug(f"Detecting namespace changes took {elapsed:.4f} seconds")

        return assigned, removed

    def _get_user_ns(self) -> Dict[str, Any]:
        return self.kernel.shell.user_ns or {}

    def _get_user_ns_hidden(self) -> Dict[str, Any]:
        return self.kernel.shell.user_ns_hidden or {}

    # -- Private Methods --

    def _get_filtered_vars(self, variables: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        """
        Returns
        -------
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

    def _find_var(self, path: Iterable[str]) -> Tuple[bool, Any]:
        """
        Finds the variable at the requested path in the current user session.

        Parameters
        ----------
        path : Iterable[str]
            A list of path segments that will be traversed to find the requested variable.

        Returns
        -------
        A tuple (bool, Any) containing a boolean indicating whether the variable was found, as well
        as the value of the variable, if found.
        """

        if path is None:
            return False, None

        return _resolve_value_from_path(self._get_user_ns(), path)

    def _list_all_vars(self) -> List[Variable]:
        variables = self._get_filtered_vars()
        return _summarize_children(variables, MAX_ITEMS)

    def _send_list(self) -> None:
        filtered_variables = self._list_all_vars()
        msg = VariableList(
            variables=filtered_variables,
            length=len(filtered_variables),
            version=0,
        )
        self._send_result(msg.dict())

    def _delete_all_vars(self, parent: Dict[str, Any]) -> None:
        """
        Deletes all of the variables in the current user session.

        Parameters
        ----------
        parent :  Dict[str, Any]
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

        Parameters
        ----------
        names :  Iterable[str]
            A list of variable names to delete
        parent : Dict[str, Any]
            A dict providing the parent context for the response,
            e.g. the client message requesting the delete operation
        """
        if names is None:
            return

        self.snapshot_user_ns()

        for name in names:
            try:
                self.kernel.shell.del_var(name, False)
            except Exception:
                logger.warning(f"Unable to delete variable '{name}'")
                pass

        _, removed = self._compare_user_ns()

        # Publish an input to inform clients of the variables that were deleted
        if len(removed) > 0:
            code = "del " + ", ".join(removed)
            self.kernel.publish_execute_input(code, parent)

        # Look for any removed variables that are active in the data
        # explorer service
        exp_service = self.kernel.data_explorer_service
        for name in removed:
            if exp_service.variable_has_active_explorers(name):
                exp_service.handle_variable_deleted(name)

        self._send_result([encode_access_key(name) for name in sorted(removed)])

    def _inspect_var(self, path: List[str]) -> None:
        """
        Describes the variable at the requested path in the current user session.

        Parameters
        ----------
        path : List[str]
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

    def _perform_view_action(self, path: List[str]) -> None:
        """
        Performs the view action depending of the variable type.
        """

        if path is None:
            return

        is_known, value = self._find_var(path)
        if not is_known:
            return self._send_error(
                JsonRpcErrorCode.INVALID_PARAMS,
                f"Cannot find variable at '{path}' to view",
            )

        if self.kernel.connections_service.object_is_supported(value):
            self._open_connections_pane(path, value)
        else:
            self._open_data_explorer(path, value)

    def _open_data_explorer(self, path: List[str], value: Any) -> None:
        """Opens a DataExplorer comm for the variable at the requested
        path in the current user session.
        """
        # Use the leaf segment to get the title
        access_key = path[-1]

        title = str(decode_access_key(access_key))
        self.kernel.data_explorer_service.register_table(value, title, variable_path=path)
        self._send_result({})

    def _open_connections_pane(self, path: List[str], value: Any) -> None:
        """Opens a Connections comm for the variable at the requested
        path in the current user session.
        """
        self.kernel.connections_service.register_connection(value, variable_path=path)
        self._send_result({})

    def _send_event(self, name: str, payload: JsonRecord) -> None:
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

        Parameters
        ----------
        path : List[str]
            A list of names describing the path to the variable.
        clipboard_format : ClipboardFormatFormat
            The format to use for the clipboard copy, described as a mime type.
            Defaults to "text/plain".
        """
        if path is None:
            return

        is_known, value = self._find_var(path)
        if is_known:
            content = _format_value(value, clipboard_format)
            msg = FormattedVariable(content=content)
            self._send_result(msg.dict())
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

        Parameters
        ----------
        path : List[str]
            A list of names describing the path to the variable.
        value : Any
            The variable's value to summarize.
        """

        children = []
        inspector = get_inspector(value)
        if inspector.has_children():
            children = _summarize_children(value)
        else:
            # Otherwise, treat as a simple value at given path
            summary = _summarize_variable("", value)
            if summary is not None:
                children.append(summary)
            # TODO: Handle scalar objects with a specific message type

        msg = InspectedVariable(children=children, length=len(children))
        self._send_result(msg.dict())


def _summarize_variable(key: Any, value: Any) -> Optional[Variable]:
    """
    Summarizes the given variable into a Variable object.

    Parameters
    ----------
    key : Any
        The actual key of the variable in its parent object, used as an input to determine the
        variable's string access key.
    value : Any
        The variable's value.


    Returns
    -------
    A Variable summary, or None if the variable should be skipped.
    """
    # Hide module types for now
    if isinstance(value, types.ModuleType):
        return None

    try:
        # Use an inspector to summarize the value
        ins = get_inspector(value)

        display_name = ins.get_display_name(key)
        kind_str = ins.get_kind()
        kind = VariableKind(kind_str)
        display_value, is_truncated = ins.get_display_value()
        display_type = ins.get_display_type()
        type_info = ins.get_type_info()
        access_key = encode_access_key(key)
        length = ins.get_length()
        size = ins.get_size()
        has_children = ins.has_children()
        has_viewer = ins.has_viewer()

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


def _summarize_children(parent: Any, limit: int = MAX_CHILDREN) -> List[Variable]:
    inspector = get_inspector(parent)
    children = inspector.get_children()
    summaries = []
    for child in children:
        if len(summaries) >= limit:
            break
        try:
            value = inspector.get_child(child)
        except Exception:
            value = "Cannot get value."
        summary = _summarize_variable(child, value)
        if summary is not None:
            summaries.append(summary)
    return summaries


def _format_value(value: Any, clipboard_format: ClipboardFormatFormat) -> str:
    """
    Formats the given value using the requested clipboard format.
    """
    inspector = get_inspector(value)

    if clipboard_format == ClipboardFormatFormat.TextHtml:
        return inspector.to_html()
    else:
        return inspector.to_plaintext()
