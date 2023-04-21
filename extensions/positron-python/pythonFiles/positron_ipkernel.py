#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

""" Positron extensions to the iPython Kernel."""

import asyncio
import codecs
import enum
import html
import inspect
import logging
import numbers
import pickle
import pprint
import sys
import types
import uuid

from collections.abc import (
    Iterable,
    Mapping,
    MutableMapping,
    MutableSequence,
    MutableSet,
    Sequence,
    Set
)
from ipykernel.ipkernel import IPythonKernel, comm
from IPython.core.interactiveshell import InteractiveShell
from itertools import chain
from typing import Any, Optional


@enum.unique
class EnvironmentMessageType(str, enum.Enum):
    """
    Message types used in the positron.environment comm.
    """
    CLEAR = 'clear'
    CLIPBOARD_FORMAT = 'clipboard_format'
    DELETE = 'delete'
    DETAILS = 'details'
    ERROR = 'error'
    FORMATTED_VARIABLE = 'formatted_variable'
    INSPECT = 'inspect'
    LIST = 'list'
    REFRESH = 'refresh'
    UPDATE = 'update'


@enum.unique
class EnvironmentVariableKind(str, enum.Enum):
    """
    Categories of variables in the user's environment.
    """
    BOOLEAN = 'boolean'
    BYTES = 'bytes'
    COLLECTION = 'collection'
    EMPTY = 'empty'
    FUNCTION = 'function'
    MAP = 'map'
    NUMBER = 'number'
    OTHER = 'other'
    STRING = 'string'
    TABLE = 'table'


@enum.unique
class ClipboardFormat(str, enum.Enum):
    """
    Format styles for clipboard copy
    """
    HTML = 'text/html'
    PLAIN = 'text/plain'


# Note: classes below are derived from dict to satisfy ipykernel util method
# json_clean() which is used in comm message serialization
class EnvironmentVariable(dict):
    """
    Describes a variable in the user's environment.
    """

    def __init__(self,
                 display_name: str,
                 display_value: Any,
                 kind: EnvironmentVariableKind = EnvironmentVariableKind.OTHER,
                 display_type: str = None,
                 type_info: str = None,
                 access_key: str = None,
                 length: int = 0,
                 size: int = None,
                 has_children: bool = False,
                 is_truncated: bool = False):
        self['display_name'] = display_name
        self['display_value'] = display_value
        if kind is not None:
            self['kind'] = getattr(EnvironmentVariableKind, kind.upper())
        self['display_type'] = display_type
        self['type_info'] = type_info
        self['access_key'] = access_key
        self['length'] = length
        self['size'] = size
        self['has_children'] = has_children
        self['is_truncated'] = is_truncated
        # TODO: To be removed
        self['name'] = display_name
        self['value'] = display_value


class EnvironmentMessage(dict):
    """
    Base message for the positron.environment comm.
    """

    def __init__(self, msg_type):
        self['msg_type'] = getattr(EnvironmentMessageType, msg_type.upper())


class EnvironmentMessageList(EnvironmentMessage):
    """
    Message 'list' type summarizes the variables in the user's environment.
    """

    def __init__(self, variables: list, length: int = None):
        super().__init__(EnvironmentMessageType.LIST)
        self['variables'] = variables
        if length is None:
            length = len(variables)
        self['length'] = length


class EnvironmentMessageFormatted(EnvironmentMessage):
    """
    Message 'formatted_variable' type summarizes the variable
    in a text format suitable for copy and paste operations in
    the user's environment.
    """

    def __init__(self, clipboard_format: str, content: str):
        super().__init__(EnvironmentMessageType.FORMATTED_VARIABLE)
        self['format'] = clipboard_format
        self['content'] = content


class EnvironmentMessageDetails(EnvironmentMessage):
    """
    Message 'details' type summarizes the variables in the user's environment.
    """

    def __init__(self, path: str, children: list, length: int = None):
        super().__init__(EnvironmentMessageType.DETAILS)
        self['path'] = path
        self['children'] = children
        if length is None:
            length = len(children)
        self['length'] = length


class EnvironmentMessageUpdate(EnvironmentMessage):
    """
    Message 'update' type summarizes the variables that have changed in the
    user's environment since the last execution.
    """

    def __init__(self, assigned: list, removed: set):
        super().__init__(EnvironmentMessageType.UPDATE)
        self['assigned'] = assigned
        self['removed'] = removed


class EnvironmentMessageError(EnvironmentMessage):
    """
    Message 'error' type is used to report a problem to the client.
    """

    def __init__(self, message):
        super().__init__(EnvironmentMessageType.ERROR)
        self['message'] = message


class CustomInspector:

    def get_kind(self, value) -> EnvironmentVariableKind:
        pass

    def get_child_names(self, value) -> list:
        pass

    def has_child(self, value, child_name) -> bool:
        pass

    def get_child_info(self, value, child_name) -> (str, Any):
        pass

    def get_display_value(self, value) -> str:
        pass

    def get_display_type(self, value) -> str:
        pass

    def equals(self, value1, value2) -> bool:
        pass

    def copy(self, value) -> Any:
        pass

    def to_html(self, value) -> str:
        pass

    def to_tsv(self, value) -> str:
        pass


class PandasDataFrameInspector(CustomInspector):

    CLASS_QNAME = 'pandas.core.frame.DataFrame'

    def get_kind(self, value) -> EnvironmentVariableKind:
        if value is not None:
            return EnvironmentVariableKind.TABLE
        else:
            return EnvironmentVariableKind.EMPTY

    def get_child_names(self, value) -> list:
        try:
            return value.columns.values.tolist()
        except Exception:
            return []

    def has_child(self, value, child_name) -> bool:
        return child_name in self.get_child_names(value)

    def get_child_info(self, value, child_name) -> (str, Any):
        try:
            column = value[child_name]
            display_type = type(column).__name__
            values = column.values.tolist()

            # Include size information if we have it
            if hasattr(column, 'size'):
                size = column.size
            else:
                size = len(values)

            display_type = f'{display_type} [{size}]'
        except Exception:
            logging.warning('Unable to get Pandas child: %s', child_name, exc_info=True)

        return (display_type, values)

    def get_display_value(self, value) -> str:
        type_name = type(value).__name__
        shape = value.shape
        return f'{type_name}: [{shape[0]} rows x {shape[1]} columns]'

    def get_display_type(self, value) -> str:

        display_type = type(value).__name__
        shape = value.shape
        display_type = display_type + f' [{shape[0]}x{shape[1]}]'

        return display_type

    def equals(self, value1, value2) -> bool:
        return value1.equals(value2)

    def copy(self, value) -> Any:
        return value.copy()

    def to_html(self, value) -> str:
        return value.to_html()

    def to_tsv(self, value) -> str:
        return value.to_csv(path_or_buf=None, sep='\t')

class PandasSeriesInspector(CustomInspector):

    CLASS_QNAME = 'pandas.core.series.Series'

    def get_kind(self, value) -> EnvironmentVariableKind:
        if value is not None:
            return EnvironmentVariableKind.TABLE
        else:
            return EnvironmentVariableKind.EMPTY

    def get_child_names(self, value) -> list:
        try:
            return map(str, list(range(value.size)))
        except Exception:
            return []

    def has_child(self, value, child_name) -> bool:
        return child_name in self.get_child_names(value)

    def get_child_info(self, value, child_name) -> (str, Any):
        try:
            item = value.iat[int(child_name)]
            display_type = type(item).__name__
            return (display_type, item)
        except Exception:
            logging.warning('Unable to get Series child: %s', child_name, exc_info=True)
        return ('unknown', [])

    def get_display_value(self, value) -> str:
        return str(value)

    def get_display_type(self, value) -> str:

        display_type = type(value).__name__
        length = len(value)
        display_type = display_type + f' [{length}]'

        return display_type

    def equals(self, value1, value2) -> bool:
        return value1.equals(value2)

    def copy(self, value) -> Any:
        return value.copy()

    def to_html(self, value) -> str:
        # TODO: Support HTML
        return self.to_tsv(value)

    def to_tsv(self, value) -> str:
        return value.to_csv(path_or_buf=None, sep='\t')


class PolarsInspector(CustomInspector):

    CLASS_QNAME = 'polars.dataframe.frame.DataFrame'

    def get_kind(self, value) -> EnvironmentVariableKind:
        if value is not None:
            return EnvironmentVariableKind.TABLE
        else:
            return EnvironmentVariableKind.EMPTY

    def get_child_names(self, value) -> list:
        try:
            return value.columns
        except Exception:
            return []

    def has_child(self, value, child_name) -> bool:
        return child_name in self.get_child_names(value)

    def get_child_info(self, value, child_name) -> (str, Any):
        try:
            column = value.get_column(child_name)
            display_type = type(column).__name__
            return (display_type, column.to_list())
        except Exception:
            logging.warning('Unable to get Polars child: %s', child_name, exc_info=True)
            return ('unknown', [])

    def get_display_value(self, value) -> str:
        type_name = type(value).__name__
        shape = value.shape
        return f'{type_name}: [{shape[0]} rows x {shape[1]} columns]'

    def get_display_type(self, value) -> (int, int):

        display_type = type(value).__name__
        shape = value.shape
        display_type = display_type + f' [{shape[0]}x{shape[1]}]'

        return display_type

    def equals(self, value1, value2) -> bool:
        return value1.frame_equal(value2)

    def copy(self, value) -> Any:
        return value.clone()

    def to_html(self, value) -> str:
        return value._repr_html_()

    def to_tsv(self, value) -> str:
        return value.write_csv(file=None, separator='\t')


class NumpyNdarrayInspector(CustomInspector):

    CLASS_QNAME = 'numpy.ndarray'

    def get_kind(self, value) -> EnvironmentVariableKind:
        if value is not None:
            return EnvironmentVariableKind.TABLE
        else:
            return EnvironmentVariableKind.EMPTY

    def get_child_names(self, value) -> list:
        try:
            return map(str, list(range(len(value))))
        except Exception:
            return []

    def has_child(self, value, child_name) -> bool:
        return child_name in self.get_child_names(value)

    def get_child_info(self, value, child_name) -> (str, Any):
        try:
            child = value[int(child_name)]
            child_display_type = type(child).__name__
            return (child_display_type, child)
        except Exception:
            logging.warning('Unable to get ndarray child: %s', child_name, exc_info=True)
            return ('unknown', [])

    def get_display_value(self, value) -> str:
        return str(value)

    def get_display_type(self, value) -> str:
        display_type = type(value).__name__
        length = len(value)
        display_type = display_type + f' [{length}]'

        return display_type

    def equals(self, value1, value2) -> bool:

        # Try to use numpy's array_equal
        try:
            import numpy as np
            return np.array_equal(value1, value2)
        except Exception as err:
            logging.warning("numpy equals %s", err, exc_info=True)

        # Fallback to comparing the raw bytes
        if value1.shape != value2.shape:
            return False
        return value1.tobytes() == value2.tobytes()

    def copy(self, value) -> Any:
        return value.copy()


POSITRON_ENVIRONMENT_COMM = 'positron.environment'
"""The comm channel target_name for Positron's Environment View"""

POSITRON_PLOT_COMM = 'positron.plot'
"""The comm channel target_name for Positron's Plots View"""

MAX_ITEMS = 2000
TRUNCATE_SUMMARY_AT = 1024
SUMMARY_PRINT_WIDTH = 100

# Marker used to track if our default object was returned from a
# conditional property lookup
_OurDefault = object()

POSITON_NS_HIDDEN = {'__warningregistry__': {}}
"""Additional variables to hide from the user's namespace."""


class PositronIPyKernel(IPythonKernel):
    """
    Positron extension of IPythonKernel.

    Adds additional comms to introspect the user's environment.
    """

    def __init__(self, **kwargs):
        """Initializes Positron's IPython kernel."""
        super().__init__(**kwargs)
        self.env_comm = None
        self.comm_manager.register_target(POSITRON_ENVIRONMENT_COMM, self.environment_comm)
        self.shell.events.register('pre_execute', self.handle_pre_execute)
        self.shell.events.register('post_execute', self.handle_post_execute)
        self.get_user_ns_hidden().update(POSITON_NS_HIDDEN)
        # Register a display publisher hook to intercept display_data messages
        # and establish a comm channel with the frontend.
        self.display_pub_hook = PositronDisplayPublisherHook()
        self.shell.display_pub.register_hook(self.display_pub_hook)

    def do_shutdown(self, restart) -> dict:
        """
        Handle kernel shutdown.
        """
        result = super().do_shutdown(restart)
        self.display_pub_hook.shutdown()
        return result

    def environment_comm(self, comm, open_msg) -> None:
        """
        Setup positron.environment comm to receive messages.
        """

        self.env_comm = comm

        @comm.on_msg
        def _recv(msg):
            """
            Message handler for the positron.environment comm.
            """

            data = msg['content']['data']

            msgType = data.get('msg_type', None)
            if msgType == EnvironmentMessageType.REFRESH:
                self.send_list()

            elif msgType == EnvironmentMessageType.INSPECT:
                path = data.get('path', None)
                self.inspect_var(path)

            elif msgType == EnvironmentMessageType.CLIPBOARD_FORMAT:
                path = data.get('path', None)
                clipboard_format = data.get('format', ClipboardFormat.PLAIN)
                self.send_formatted_var(path, clipboard_format)

            elif msgType == EnvironmentMessageType.CLEAR:
                self.delete_all_vars(msg)

            elif msgType == EnvironmentMessageType.DELETE:
                names = data.get('names', [])
                self.delete_vars(names, msg)

            else:
                self.send_error(f'Unknown message type \'{msgType}\'')

        # Send summary of user environment on comm initialization
        self.send_list()

    def handle_pre_execute(self) -> None:
        """
        Prior to execution, reset the user environment watch state.
        """
        try:
            self.snapshot_user_ns()
        except Exception:
            logging.warning('Failed to snapshot user namespace', exc_info=True)

    def handle_post_execute(self) -> None:
        """
        After execution, sends an update message to the client to summarize
        the changes observed to variables in the user environment.
        """

        try:
            # Try to detect the changes made since the last execution
            assigned, removed = self.compare_user_ns()

            # Ensure the number of changes does not exceed our maximum items
            if len(assigned) < MAX_ITEMS and len(removed) < MAX_ITEMS:
                self.send_update(assigned, removed)
            else:
                # Otherwise, just refresh the client state
                self.send_list()
        except Exception as err:
            logging.warning(err, exc_info=True)

    def get_user_ns(self) -> dict:
        return self.shell.user_ns

    def get_user_ns_hidden(self) -> dict:
        return self.shell.user_ns_hidden

    def snapshot_user_ns(self) -> None:
        """
        Caches a shallow copy snapshot of the user's environment
        before execution.
        """
        ns = self.get_user_ns()
        hidden = self.get_user_ns_hidden()
        snapshot = ns.copy()

        # TODO: Determine snapshot strategy for nested objects
        for key, value in ns.items():

            if key in hidden:
                continue

            if isinstance(value, (MutableMapping, MutableSequence, MutableSet)):
                snapshot[key] = value.copy()
            elif self.is_inspectable(value):
                inspector = self.get_inspector(value)
                snapshot[key] = inspector.copy(value)

        # Save the snapshot in the hidden namespace to compare against
        # after an operation or execution is performed
        hidden['__positron_cache'] = snapshot

    def compare_user_ns(self) -> (dict, set):

        after = self.get_user_ns()
        hidden = self.get_user_ns_hidden()
        snapshot = hidden.get('__positron_cache', {})

        assigned = {}
        removed = set()

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

                    # If the value has a custom inspector, compare using
                    # the inspector's special equals() method
                    if self.is_inspectable(v1) or self.is_inspectable(v2):
                        inspector1 = self.get_inspector(v1)
                        inspector2 = self.get_inspector(v2)
                        if inspector1 != inspector2 or not inspector2.equals(v1, v2):
                            assigned[key] = v2

                    # Otherwise, check if key's value is no longer
                    # the same after exection
                    elif v1 != v2 and key not in assigned:
                        assigned[key] = v2

            except Exception as err:
                logging.warning("v1: %s, v2: %s, err: %s", type(v1), type(v2), err, exc_info=True)

        # Clear the snapshot
        hidden['__positron_cache'] = {}
        return assigned, removed

    def delete_all_vars(self, parent) -> None:
        """
        Deletes all of the variables in the current user session.
        """
        loop = asyncio.get_event_loop()
        asyncio.run_coroutine_threadsafe(self._soft_reset(parent), loop)

    async def _soft_reset(self, parent) -> dict:
        """
        Use %reset with the soft switch to delete all user defined
        variables from the environment.
        """
        # Run the %reset magic to clear user variables
        command = '%reset -f -s'
        coro = await self.do_execute(command, False, False)

         # Publish an input to inform clients of the "delete all" operation
        try:
            self._publish_execute_input(command, parent, self.execution_count - 1)
        except Exception:
            pass

        # Refresh the client state
        self.send_list()

        return coro

    def delete_vars(self, names: Iterable, parent) -> None:
        """
        Deletes the requested variables by name from the current user session.
        """

        if names is None:
            return

        self.snapshot_user_ns()

        for name in names:
            try:
                self.del_var(name)
            except Exception:
                logging.warning(f'Unable to delete variable \'{name}\'')
                pass

        assigned, removed = self.compare_user_ns()

        # Publish an input to inform clients of the variables that were deleted
        if len(removed) > 0:
            command = 'del ' + ', '.join(removed)
            try:
                self._publish_execute_input(command, parent, self.execution_count - 1)
            except Exception:
                pass

        self.send_update(assigned, removed)

    def del_var(self, name: str, by_name: bool = False) -> None:
        """
        Deletes the requested variable by name from the current user session.
        """
        self.shell.del_var(name, by_name)

    def find_var(self, path: Iterable, context: Any) -> (bool, Any):
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

        # Walk the given path segment by segment
        for segment in path:

            # Check for membership as a property
            name = str(segment)
            is_known = hasattr(context, name)
            if is_known:
                value = getattr(context, name, None)

            elif self.is_inspectable(context):
                inspector = self.get_inspector(context)
                is_known = inspector.has_child(context, name)
                if is_known:
                    display_type, value = inspector.get_child_info(context, name)

            # Check for membership by dict key
            elif isinstance(context, Mapping):
                value = context.get(name, _OurDefault)
                if value is _OurDefault:
                    is_known = False
                else:
                    is_known = True

            # Check for membership by collection index
            elif isinstance(context, (list, set, frozenset, tuple, range)):
                try:
                    value = context[int(name)]
                    is_known = True
                except Exception:
                    logging.warning(f'Unable to find variable at \'{path}\'', exc_info=True)
                    is_known = False

            # Subsequent segment starts from the value
            context = value

            # But we stop if the path segment was unknown
            if not is_known:
                break

        return is_known, value

    def inspect_var(self, path: Iterable) -> None:
        """
        Describes the variable at the requested path in the current user session.
        """

        if path is None:
            return

        context = self.get_user_ns()
        is_known, value = self.find_var(path, context)

        if is_known:
            self.send_details(path, value)
        else:
            message = f'Cannot find variable at \'{path}\' to inspect'
            self.send_error(message)

    def send_formatted_var(self, path: Iterable,
                           clipboard_format: ClipboardFormat = ClipboardFormat.PLAIN) -> None:
        """
        Formats the variable at the requested path in the current user session
        using the requested clipboard format and sends the result through the
        environment comm to the client.
        """

        if path is None:
            return

        context = self.get_user_ns()
        is_known, value = self.find_var(path, context)

        if is_known:
            content = self.format_value(value, clipboard_format)
            msg = EnvironmentMessageFormatted(clipboard_format, content)
            self.send_message(msg)
        else:
            message = f'Cannot find variable at \'{path}\' to format'
            self.send_error(message)

    def send_details(self, path: Iterable, context: Any = None):
        """
        Sends a detailed list of children of the value (or just the value
        itself, if is a leaf node on the path) as a message through the
        environment comm to the client.

        For example:
        {
            "data": {
                "msg_type": "details",
                "path": ["myobject", "myproperty"],
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
            ...
        }
        """

        children = []
        if isinstance(context, Mapping):
            # Treat dictionary items as children
            children.extend(self.summarize_variables(context))

        elif self.is_inspectable(context):
            inspector = self.get_inspector(context)
            for child_name in inspector.get_child_names(context):
                child_display_type, child_value = inspector.get_child_info(context, child_name)
                summary = self.summarize_variable(child_name, child_value)
                if summary is not None:
                    summary['display_type'] = child_display_type
                    children.append(summary)

        elif isinstance(context, (list, set, frozenset, tuple)):
            # Treat collection items as children, with the index as the name
            for i, item in enumerate(context):

                if len(children) >= MAX_ITEMS:
                    break

                summary = self.summarize_variable(i, item)
                if summary is not None:
                    children.append(summary)

        else:
            # Otherwise, treat as a simple value at given path
            summary = self.summarize_variable('', context)
            if summary is not None:
                children.append(summary)
            # TODO: Handle scalar objects with a specific message type

        msg = EnvironmentMessageDetails(path, children)
        self.send_message(msg)

    def send_update(self, assigned: Mapping, removed: Iterable) -> None:
        """
        Sends the list of variables in the current user session through the environment comm
        to the client.

        For example:
        {
            "data": {
                "msg_type": "update",
                "assigned": [{
                    "name": "newvar1",
                    "value": "Hello",
                    "kind": "string"
                }],
                "removed": ["oldvar1", "oldvar2"]
            }
            ...
        }
        """

        hidden = self.get_user_ns_hidden()

        # Filter out hidden assigned variables
        filtered_assigned = self.summarize_variables(assigned, hidden)

        # Filter out hidden removed variables
        filtered_removed = set()
        for name in removed:
            if hidden is not None and name in hidden:
                continue
            filtered_removed.add(name)

        msg = EnvironmentMessageUpdate(filtered_assigned, filtered_removed)
        self.send_message(msg)

    def send_list(self) -> None:
        """
        Sends a list message summarizing the variables of the current user session through the
        environment comm to the client.

        For example:
        {
            "data": {
                "msg_type": "list",
                "variables": {
                    "name": "mygreeting",
                    "value": "Hello",
                    "kind": "string"
                }
            }
            ...
        }
        """

        ns = self.get_user_ns()
        hidden = self.get_user_ns_hidden()
        filtered_variables = self.summarize_variables(ns, hidden)

        msg = EnvironmentMessageList(filtered_variables)
        self.send_message(msg)

    def send_error(self, message: str) -> None:
        """
        Send an error message through the envirvonment comm to the client.

        For example:
        {
            "data": {
                "msg_type": "error",
                "message": "The error message"
            }
            ...
        }
        """

        msg = EnvironmentMessageError(message)
        self.send_message(msg)

    def send_message(self, msg: EnvironmentMessage) -> None:
        """
        Send a message through the environment comm to the client.
        """

        if self.env_comm is None:
            logging.warning('Cannot send message, environment comm is not open')
            return

        self.env_comm.send(msg)

    def summarize_variables(self, variables: Mapping, hidden: Mapping = None,
                            max_items: int = MAX_ITEMS) -> list:
        summaries = []

        for key, value in variables.items():

            # Filter out hidden variables
            if hidden is not None and key in hidden:
                continue

            # Ensure the number of items summarized is within our
            # max limit
            if len(summaries) >= max_items:
                break

            summary = self.summarize_variable(key, value)
            if summary is not None:
                summaries.append(summary)

        return summaries

    def summarize_variable(self, key, value) -> EnvironmentVariable:

        kind = self.get_kind(value)

        if kind is not None:
            return self.summarize_any(key, value, kind)

        return None

    def summarize_any(self, key, value, kind) -> EnvironmentVariable:

        display_name = str(key)
        try:
            length = self.get_length(value)
            size = sys.getsizeof(value)
            has_children = length > 0
            is_truncated = False

            # Determine the short display type for the variable, including
            # the length, if applicable
            display_type = self.get_display_type(value, length)
            type_info = self.get_qualname(value)

            # Apply type-specific formatting
            if kind == EnvironmentVariableKind.STRING:
                # For string summaries, avoid pprint as it wraps strings into line chunks
                display_value, is_truncated = self.summarize_value(value, None)
                display_value = repr(display_value)
                has_children = False

            elif kind == EnvironmentVariableKind.TABLE:
                # Tables are summarized by their dimensions
                inspector = self.get_inspector(value)
                display_value = inspector.get_display_value(value)
                is_truncated = True

            elif kind == EnvironmentVariableKind.FUNCTION:
                # Functions are summarized by their signature
                display_value = self.format_function_summary(value)
                has_children = False

            elif kind == EnvironmentVariableKind.BYTES:
                # For bytes, even though they have a length, we don't set them
                # as having children
                display_value, is_truncated = self.summarize_value(value, None)
                has_children = False

            elif kind == EnvironmentVariableKind.COLLECTION:
                display_value, is_truncated = self.summarize_value(value)
                # For ranges, we don't visualize the children as they're
                # implied as a contiguous set of integers in a range
                if isinstance(value, range):
                    has_children = False
            else:
                display_value, is_truncated = self.summarize_value(value)

            return EnvironmentVariable(display_name=display_name,
                                       display_value=display_value,
                                       display_type=display_type,
                                       kind=kind,
                                       type_info=type_info,
                                       access_key=display_name,
                                       length=length,
                                       size=size,
                                       has_children=has_children,
                                       is_truncated=is_truncated)
        except Exception as err:
            logging.warning(err, exc_info=True)
            return EnvironmentVariable(display_name=display_name,
                                       display_value=self.get_qualname(value),
                                       kind=kind)

    def format_function_summary(self, value) -> str:
        if callable(value):
            sig = inspect.signature(value)
        else:
            sig = '()'
        return f'{value.__qualname__}{sig}'

    def summarize_value(self, value, print_width: int = SUMMARY_PRINT_WIDTH,
                        truncate_at: int = TRUNCATE_SUMMARY_AT) -> (str, bool):

        if print_width is not None:
            s = pprint.pformat(value, width=print_width, compact=True)
        else:
            s = str(value)

        # TODO: Add type aware truncation
        return self.truncate_string(s, truncate_at)

    def truncate_string(self, value: str, max: int = TRUNCATE_SUMMARY_AT) -> (str, bool):
        if self.get_length(value) > max:
            return (value[:max], True)
        else:
            return (value, False)

    def format_value(self, value, clipboard_format: ClipboardFormat) -> str:

        if clipboard_format == ClipboardFormat.HTML:

            if self.is_inspectable(value):
                inspector = self.get_inspector(value)
                return inspector.to_html(value)
            else:
                return html.escape(str(value))

        elif clipboard_format == ClipboardFormat.PLAIN:

            if self.is_inspectable(value):
                inspector = self.get_inspector(value)
                return inspector.to_tsv(value)

        return str(value)

    def get_length(self, value) -> int:
        length = 0
        if hasattr(value, '__len__'):
            try:
                length = len(value)
            except Exception:
                pass
        return length

    def get_display_type(self, value: Any, length: int = 0) -> str:
        if value is not None:
            type_name = type(value).__name__

            if isinstance(value, str):
                # For strings, which are sequences, we suppress showing
                # the length in the type display
                return type_name
            elif self.is_inspectable(value):
                inspector = self.get_inspector(value)
                return inspector.get_display_type(value)
            elif isinstance(value, Set):
                return f'{type_name} {{{length}}}'
            elif isinstance(value, tuple):
                return f'{type_name} ({length})'
            elif isinstance(value, (Sequence, Mapping)):
                return f'{type_name} [{length}]'
            elif length > 0:
                return f'{type_name} [{length}]'

            return type_name
        else:
            return 'NoneType'

    def get_qualname(self, value) -> str:
        """
        Utility to manually construct a qualified type name as
        __qualname__ does not work for all types
        """
        if value is not None:
            t = type(value)
            module = t.__module__
            name = t.__name__
            if module is not None and module != 'builtins':
                return f'{module}.{name}'
            else:
                return name

        return 'None'

    def get_kind(self, value) -> str:
        if isinstance(value, str):
            return EnvironmentVariableKind.STRING
        elif isinstance(value, bool):
            return EnvironmentVariableKind.BOOLEAN
        elif isinstance(value, numbers.Number):
            return EnvironmentVariableKind.NUMBER
        elif self.is_inspectable(value):
            inspector = self.get_inspector(value)
            return inspector.get_kind(value)
        elif isinstance(value, Mapping):
            return EnvironmentVariableKind.MAP
        elif isinstance(value, (bytes, bytearray, memoryview)):
            return EnvironmentVariableKind.BYTES
        elif isinstance(value, (Sequence, Set)):
            return EnvironmentVariableKind.COLLECTION
        elif isinstance(value, (types.FunctionType, types.MethodType)):
            return EnvironmentVariableKind.FUNCTION
        elif isinstance(value, types.ModuleType):
            return None  # Hide module types for now
        elif value is not None:
            return EnvironmentVariableKind.OTHER
        else:
            return EnvironmentVariableKind.EMPTY

    CUSTOM_INSPECTORS = {PandasDataFrameInspector.CLASS_QNAME: PandasDataFrameInspector(),
                         PandasSeriesInspector.CLASS_QNAME: PandasSeriesInspector(),
                         PolarsInspector.CLASS_QNAME: PolarsInspector(),
                         NumpyNdarrayInspector.CLASS_QNAME: NumpyNdarrayInspector()}

    def is_inspectable(self, value) -> bool:
        qualname = self.get_qualname(value)
        if qualname in self.CUSTOM_INSPECTORS.keys():
            return True
        return False

    def get_inspector(self, value) -> CustomInspector:
        qualname = self.get_qualname(value)
        return self.CUSTOM_INSPECTORS.get(qualname, None)


class PlotClientMessageImage(dict):
    """
    A message used to send rendered plot output.

    Members:

        data: The data for the plot image, as a base64-encoded string. We need
        to send the plot data as a string because the underlying image file
        exists only on the machine running the language runtime process.

        mime_type: The MIME type of the image data, e.g. `image/png`. This is
        used determine how to display the image in the UI.
    """
    def __init__(self, data: str, mime_type: str):
        self['msg_type'] = 'image'
        self['data'] = data
        self['mime_type'] = mime_type


class PlotClientMessageError(dict):
    """
    A message used to send an error message.

    Members:

        message: The error message.
    """
    def __init__(self, message: str):
        self['msg_type'] = 'error'
        self['message'] = message


# Matplotlib Default Figure Size
DEFAULT_WIDTH_IN = 6.4
DEFAULT_HEIGHT_IN = 4.8
BASE_DPI = 96


class PositronDisplayPublisherHook:

    def __init__(self):
        self.comms = {}
        self.figures = {}

    def __call__(self, msg, *args, **kwargs) -> Optional[dict]:

        if msg['msg_type'] == 'display_data':

            # Try to pickle the current figure
            pickled = self.pickle_current_figure()
            if pickled is not None:
                id = str(uuid.uuid4())
                self.figures[id] = pickled

                # Create a new comm for each plot figure to allow the client
                # to request modifications, e.g. render at a new size
                self.create_comm(id)

                # Returning None stops the display_data message being sent via
                # the iopub channel
                return None

        return msg

    def create_comm(self, comm_id: str) -> None:
        plot_comm = comm.create_comm(target_name=POSITRON_PLOT_COMM, comm_id=comm_id)
        self.comms[comm_id] = plot_comm
        plot_comm.on_msg(self.receive_message)

    # Add a callback for received messages.
    def receive_message(self, msg) -> None:
        comm_id = msg['content']['comm_id']
        data = msg['content']['data']
        msg_type = data.get('msg_type', None)

        if msg_type != 'render':
            return

        figure_comm = self.comms.get(comm_id, None)
        if figure_comm is None:
            logging.warning(f'Plot figure comm {comm_id} not found')
            return

        pickled = self.figures.get(comm_id, None)
        if pickled is None:
            figure_comm.send(PlotClientMessageError(f'Figure {comm_id} not found'))
            return

        width_px = data.get('width', 0)
        height_px = data.get('height', 0)
        pixel_ratio = data.get('pixel_ratio', 1)

        if width_px != 0 and height_px != 0:
            format_dict, md_dict = self.resize_pickled_figure(pickled, width_px, height_px, pixel_ratio)
            data = format_dict['image/png']
            msg_data = PlotClientMessageImage(data, 'image/png')
            figure_comm.send(data=msg_data, metadata=md_dict)

    def pickle_current_figure(self) -> str:

        pickled = None

        # Delay importing matplotlib until the kernel and shell has been initialized
        # otherwise the graphics backend will be reset to the gui
        import matplotlib.pyplot as plt

        # We turn off interactive mode before accessing the plot context
        was_interactive = plt.isinteractive()
        plt.ioff()

        # Pickle the current figure
        figure = plt.gcf()
        if figure is not None and not self.is_figure_empty(figure):
            pickled = codecs.encode(pickle.dumps(figure), "base64").decode()

        if was_interactive:
            plt.ion()

        return pickled

    def resize_pickled_figure(self,
                              pickled: str,
                              new_width_px: int = 614,
                              new_height_px: int = 460,
                              pixel_ratio: float = 1.0,
                              formats: list = ['image/png']) -> (dict, dict):

        # Delay importing matplotlib until the kernel and shell has been
        # initialized otherwise the graphics backend will be reset to the gui
        import matplotlib.pyplot as plt

        # Turn off interactive mode before, including before unpickling a
        # figures (otherwise it will cause and endless loop of plot changes)
        was_interactive = plt.isinteractive()
        plt.ioff()

        figure = pickle.loads(codecs.decode(pickled.encode(), "base64"))

        # Adjust the DPI based on pixel_ratio to accommodate high
        # resolution displays...
        dpi = BASE_DPI * pixel_ratio
        figure.set_dpi(dpi)

        # ... but use base DPI to convert to inch based dimensions.
        width_in, height_in = figure.get_size_inches()
        new_width_in = new_width_px / BASE_DPI
        new_height_in = new_height_px / BASE_DPI

        # Try to determine if the figure had an explicit width or height set.
        if width_in == DEFAULT_WIDTH_IN and height_in == DEFAULT_HEIGHT_IN:
            # If default values are still set, apply new size, even if this
            # resets the aspect ratio
            width_in = new_width_in
            height_in = new_height_in
        else:
            # Preserve the existing aspect ratio, constraining the scale
            # based on the shorter dimension
            if width_in < height_in:
                height_in = height_in * (new_width_in / width_in)
                width_in = new_width_in
            else:
                width_in = width_in * (new_height_in / height_in)
                height_in = new_height_in

        figure.set_size_inches(width_in, height_in)

        format = InteractiveShell.instance().display_formatter.format
        format_dict, md_dict = format(figure, include=formats, exclude=[])

        plt.close(figure)

        if was_interactive:
            plt.ion()

        return (format_dict, md_dict)

    def is_figure_empty(self, figure):

        children = figure.get_children()
        if len(children) < 1:
            return True

        for child in children:
            if child.get_visible():
                return False

        return True

    def shutdown(self) -> None:
        for figure_comm in self.comms.values():
            try:
                figure_comm.close()
            except Exception:
                pass
        self.comms.clear()
        self.figures.clear()
