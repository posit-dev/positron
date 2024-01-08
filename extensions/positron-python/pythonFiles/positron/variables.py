#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#
from __future__ import annotations

import enum
import logging
import types
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Set, Union

from comm.base_comm import BaseComm

from .dataviewer import DataViewerService
from .inspectors import MAX_ITEMS, decode_access_key, get_inspector
from .positron_comm import JsonRpcErrorCode, PositronComm
from .utils import JsonData, get_qualname
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
    VariablesEvent,
    VariablesRequest,
    ViewRequest,
)

if TYPE_CHECKING:
    from .positron_ipkernel import PositronIPyKernel

logger = logging.getLogger(__name__)


class VariablesService:
    def __init__(self, kernel: PositronIPyKernel, dataviewer_service: DataViewerService) -> None:
        self.kernel = kernel
        self.dataviewer_service = dataviewer_service

        self._comm: Optional[PositronComm] = None

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
            method = VariablesRequest(data.get("method", None))
        except ValueError:
            self._send_error(
                JsonRpcErrorCode.METHOD_NOT_FOUND, f"Unknown method '{data.get('method')}'"
            )
            return

        if method == VariablesRequest.List:
            try:
                request = ListRequest(**data)
                self._send_list()
            except TypeError as exception:
                self._send_error(
                    JsonRpcErrorCode.INVALID_REQUEST,
                    message=f"Invalid list request {data}: {exception}",
                )

        elif method == VariablesRequest.Clear:
            try:
                request = ClearRequest(**data)
                self._delete_all_vars(msg)
            except TypeError as exception:
                self._send_error(
                    JsonRpcErrorCode.INVALID_REQUEST,
                    message=f"Invalid clear request {data}: {exception}",
                )

        elif method == VariablesRequest.Delete:
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

        elif method == VariablesRequest.Inspect:
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

        elif method == VariablesRequest.ClipboardFormat:
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

        elif method == VariablesRequest.View:
            try:
                request = ViewRequest(**data)
                if request.params.path is None:
                    self._missing_param_error("path")
                else:
                    self._view_var(request.params.path)
            except TypeError as exception:
                self._send_error(
                    JsonRpcErrorCode.INVALID_REQUEST,
                    message=f"Invalid view request {data}: {exception}",
                )

        else:
            self._send_error(JsonRpcErrorCode.METHOD_NOT_FOUND, f"Unknown method '{method}'")

    def _missing_param_error(self, param: str) -> None:
        self._send_error(JsonRpcErrorCode.INVALID_PARAMS, f"Missing parameter '{param}'")

    def send_update(self, assigned: Mapping[str, Any], removed: Set[str]) -> None:
        """
        Sends the list of variables that have changed in the current user session through the
        variables comm to the client.
        """
        # Ensure the number of changes does not exceed our maximum items
        if len(assigned) < MAX_ITEMS and len(removed) < MAX_ITEMS:
            self._send_update(assigned, removed)
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
        variables = self.kernel.get_filtered_vars()
        inspector = get_inspector(variables)
        filtered_variables = inspector.summarize_children(variables, _summarize_variable)

        msg = RefreshParams(variables=filtered_variables, length=len(filtered_variables), version=0)
        self._send_event(VariablesEvent.Refresh.value, asdict(msg))

    def shutdown(self) -> None:
        if self._comm is not None:
            try:
                self._comm.close()
            except Exception:
                pass

    # -- Private Methods --

    def _send_update(self, assigned: Mapping[str, Any], removed: Set[str]) -> None:
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
        variables = self.kernel.get_filtered_vars(assigned)
        inspector = get_inspector(variables)
        filtered_assigned = inspector.summarize_children(variables, _summarize_variable)

        # Filter out hidden removed variables
        filtered_removed = self.kernel.get_filtered_var_names(removed)

        if filtered_assigned or filtered_removed:
            msg = UpdateParams(
                assigned=filtered_assigned, removed=sorted(filtered_removed), version=0
            )
            self._send_event(VariablesEvent.Update.value, asdict(msg))

    def _list_all_vars(self) -> List[Variable]:
        variables = self.kernel.get_filtered_vars()
        inspector = get_inspector(variables)
        return inspector.summarize_children(variables, _summarize_variable)

    def _send_list(self) -> None:
        filtered_variables = self._list_all_vars()
        msg = VariableList(variables=filtered_variables, length=len(filtered_variables), version=0)
        self._send_result(asdict(msg))

    def _delete_all_vars(self, parent: Dict[str, Any]) -> None:
        """
        Deletes all of the variables in the current user session.

        Args:
            parent:
                A dict providing the parent context for the response,
                e.g. the client message requesting the clear operation
        """
        self.kernel.delete_all_vars(parent)
        self._send_result({})

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

        assigned, removed = self.kernel.delete_vars(names, parent)
        self._send_result(sorted(removed))
        self._send_update(assigned, removed)

    def _inspect_var(self, path: List[str]) -> None:
        """
        Describes the variable at the requested path in the current user session.

        Args:
            path:
                A list of names describing the path to the variable.
        """

        is_known, value = self.kernel.find_var(path)
        if is_known:
            self._send_details(path, value)
        else:
            self._send_error(
                JsonRpcErrorCode.INVALID_PARAMS, f"Cannot find variable at '{path}' to inspect"
            )

    def _view_var(self, path: List[str]) -> None:
        """
        Opens a viewer comm for the variable at the requested path in the
        current user session.
        """
        if path is None:
            return

        is_known, value = self.kernel.find_var(path)
        if is_known:
            inspector = get_inspector(value)
            # Use the leaf segment to get the title
            access_key = path[-1]
            title = str(decode_access_key(access_key))
            dataset = inspector.to_dataset(value, title)
            self.dataviewer_service.register_dataset(dataset)
            self._send_result({})
        else:
            self._send_error(
                JsonRpcErrorCode.INVALID_PARAMS, f"Cannot find variable at '{path}' to view"
            )

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

        is_known, value = self.kernel.find_var(path)
        if is_known:
            content = _format_value(value, clipboard_format)
            msg = FormattedVariable(content=content)
            self._send_result(asdict(msg))
        else:
            self._send_error(
                JsonRpcErrorCode.INVALID_PARAMS, f"Cannot find variable at '{path}' to format"
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
