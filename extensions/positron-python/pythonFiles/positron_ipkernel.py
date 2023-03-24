#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

from collections.abc import Iterable, Mapping, MutableMapping, MutableSequence, MutableSet, Sequence, Set
from ipykernel.ipkernel import IPythonKernel, _get_comm_manager
from itertools import chain
from typing import Any, Optional
import enum
import html
import inspect
import logging
import numbers
import pprint
import sys
import types


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
    TAB = 'text/tab-separated-values'


# Note: classes below are derived from dict to satisfy ipykernel util method
# json_clean() which is used in comm message serialization
class EnvironmentVariable(dict):
    """
    Describes a variable in the user's environment.
    """

    def __init__(self, name: str, value: Any, kind: Optional[EnvironmentVariableKind],
                 type_name: str = None, length: int = None, size: int = None,
                 has_children: bool = False, is_truncated: bool = False):
        self['name'] = name
        self['value'] = value
        if kind is not None:
            self['kind'] = getattr(EnvironmentVariableKind, kind.upper())
        self['type_name'] = type_name
        self['length'] = length
        self['size'] = size
        self['has_children'] = has_children
        self['is_truncated'] = is_truncated


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

    def __init__(self, variables: list[EnvironmentVariable], length: int = None):
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

    def __init__(self, path: str, children: list[EnvironmentVariable], length: int = None):
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

    def __init__(self, assigned: list[EnvironmentVariable], removed: set[str]):
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


class TableInspector:

    def get_columns(self, df) -> list[str]:
        pass

    def get_column_values(self, df, column_name) -> list[Any]:
        pass

    def shape(self, df) -> (int, int):
        pass

    def equals(self, df1, df2) -> bool:
        pass

    def copy(self, df) -> Any:
        pass

    def to_html(self, df) -> str:
        pass

    def to_tsv(self, df) -> str:
        pass


class PandasInspector(TableInspector):

    TABLE_CLASS_NAME = 'pandas.core.frame.DataFrame'

    def get_columns(self, df) -> list[str]:
        try:
            return df.columns.values.tolist()
        except:
            return []

    def get_column_values(self, df, column_name) -> list[Any]:
        try:
            return df[column_name].values.tolist()
        except:
            return []

    def shape(self, df) -> (int, int):
        return df.shape

    def equals(self, df1, df2) -> bool:
        return df1.equals(df2)

    def copy(self, df) -> Any:
        return df.copy()

    def to_html(self, df) -> str:
        return df.to_html()

    def to_tsv(self, df) -> str:
        return df.to_csv(path_or_buf=None, sep='\t')


class PolarsInspector(TableInspector):

    TABLE_CLASS_NAME = 'polars.dataframe.frame.DataFrame'

    def get_columns(self, df) -> list[str]:
        try:
            return df.columns
        except:
            return []

    def get_column_values(self, df, column_name) -> list[Any]:
        try:
            return df.get_column(column_name).to_list()
        except:
            return []

    def shape(self, df) -> (int, int):
        return df.shape

    def equals(self, df1, df2) -> bool:
        return df1.frame_equal(df2)

    def copy(self, df) -> Any:
        return df.clone()

    def to_html(self, df) -> str:
        return df._repr_html_()

    def to_tsv(self, df) -> str:
        return df.write_csv(file=None, separator='\t')


POSITRON_ENVIRONMENT_COMM = 'positron.environment'
"""The comm channel target name for Positron's Environment View"""

MAX_ITEMS = 2000
MAX_ITEM_SUMMARY_LENGTH = 1024
ITEM_SUMMARY_PRINT_WIDTH = 100

# Marker used to track if our default object was returned from a
# conditional property lookup
_OurDefault = object()


class PositronIPyKernel(IPythonKernel):
    """
    Positron extension of IPythonKernel.

    Adds additional comms to introspect the user's environment.
    """

    def __init__(self, **kwargs):
        """Initializes Positron's IPython kernel."""
        super().__init__(**kwargs)
        self.env_comm = None
        _get_comm_manager().register_target(POSITRON_ENVIRONMENT_COMM, self.environment_comm)
        self.shell.events.register('pre_execute', self.handle_pre_execute)
        self.shell.events.register('post_execute', self.handle_post_execute)

    def handle_pre_execute(self) -> None:
        """
        Prior to execution, reset the user environment watch state.
        """
        try:
            self.snapshot_user_ns()
        except Exception:
            logging.error('Failed to snapshot user namespace', exc_info=True)

    def snapshot_user_ns(self) -> None:
        """
        Caches a shallow copy snapshot of the user's environment
        before execution.
        """
        ns = self.shell.user_ns
        snapshot = ns.copy()

        # TODO: Determine snapshot strategy for nested objects
        for key, value in ns.items():
            if isinstance(value, (MutableMapping, MutableSequence, MutableSet)):
                snapshot[key] = value.copy()
            elif self.is_table(value):
                inspector = self.get_table_inspector(value)
                snapshot[key] = inspector.copy(value)

        # Save the snapshot in the hidden namespace to compare against
        # after an operation or execution is performed
        self.shell.user_ns_hidden['__positron_cache'] = snapshot

    def compare_user_ns(self) -> (dict, set[str]):

        after = self.shell.user_ns
        snapshot = self.shell.user_ns_hidden.get('__positron_cache', {})

        # Find assigned and removed variables
        assigned = {}
        removed = set()
        hidden = self.shell.user_ns_hidden

        try:
            for key in chain(snapshot.keys(), after.keys()):
                if key in hidden:
                    continue

                if key in snapshot and key not in after:
                    # Key was removed
                    removed.add(key)
                elif key not in snapshot and key in after:
                    # Key was added
                    assigned[key] = after[key]
                elif key in snapshot and key in after:
                    # If the value is a table, compare using a
                    # special equals() method
                    if self.is_table(after[key]):
                        t1 = snapshot[key]
                        t2 = after[key]
                        inspector = self.get_table_inspector(t1)
                        if not inspector.equals(t1, t2):
                            assigned[key] = after[key]
                    # Check if key's value changed after execution
                    elif snapshot[key] != after[key] and key not in assigned:
                        assigned[key] = after[key]
        except Exception as err:
            logging.warning(err, exc_info=True)

        # Clear the snapshot
        self.shell.user_ns_hidden['__positron_cache'] = {}
        return assigned, removed

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
            if msgType is not None:

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
                    self.delete_all_vars()

                elif msgType == EnvironmentMessageType.DELETE:
                    names = data.get('names', [])
                    self.delete_vars(names)

                else:
                    self.send_error(f'Unknown message type \'{msgType}\'')
            else:
                self.send_error('Could not determine message type')

        # Send summary of user environment on comm initialization
        self.send_list()

    def delete_all_vars(self) -> None:
        """
        Deletes all of the variables in the current user session.
        """

        if self.shell is None:
            return

        ns = self.shell.user_ns.copy()
        hidden = self.shell.user_ns_hidden.copy()

        # Delete all non-hidden variables
        for key, value in ns.items():
            if key in hidden:
                continue

            try:
                # We check if value is None to avoid an issue in shell.del_var()
                # cleaning up references
                self.shell.del_var(key, value is None)
            except Exception as err:
                # Warn if delete failed and key is still in scope
                if key in self.shell.user_ns:
                    logging.warning(f'Unable to delete variable \'{key}\'. Error: %s', err)
                pass

        # Refresh the client state
        self.send_list()

    def delete_vars(self, names: Iterable) -> None:
        """
        Deletes the requested variables by name from the current user session.
        """

        if self.shell is None or names is None:
            return

        self.snapshot_user_ns()

        for name in names:
            try:
                self.shell.del_var(name)
            except:
                logging.warning(f'Unable to delete variable \'{name}\'')
                pass

        assigned, removed = self.compare_user_ns()
        self.send_update(assigned, removed)

    def find_var(self, path: Iterable, context: Any) -> (bool, Any):
        """
        Finds the variable at the requested path in the current user session.
        """

        if path is None:
            return False, None

        is_known = False
        value = None

        # Walk the given path segment by segment
        for segment in path:

            # Check for membership as a property
            is_known = hasattr(context, segment)
            if is_known:
                value = getattr(context, segment, None)

            # Check for membership by dict key
            elif isinstance(context, Mapping):
                value = context.get(segment, _OurDefault)
                if value is _OurDefault:
                    is_known = False
                else:
                    is_known = True

            # Check for membership by collection index
            elif isinstance(context, (list, set, frozenset, tuple, range)):
                try:
                    value = context[int(segment)]
                    is_known = True
                except Exception:
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

        if self.shell is None or path is None:
            return

        context = self.shell.user_ns
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

        if self.shell is None or path is None:
            return

        context = self.shell.user_ns
        is_known, value = self.find_var(path, context)

        if is_known:
            content = self.format_value(value, clipboard_format)
            msg = EnvironmentMessageFormatted(clipboard_format, content)
            self.env_comm.send(msg)
        else:
            message = f'Cannot find variable at \'{path}\' to format'
            self.send_error(message)

    def send_details(self, path: Iterable, context: Any = None):
        """
        Sends the list of children (or the value itself if none) of the value
        through the environment comm to the client.

        For example:
        {
            "data": {
                "msg_type": "details",
                "path": ["myobject", "myproperty"],
                "children": [{
                    "name": "property1",
                    "value": "Hello",
                    "kind": "string"
                },{
                    "name": "property2",
                    "value": 123,
                    "kind": "number"
                }]
            }
            ...
        }
        """

        if self.env_comm is None or self.shell is None:
            return

        children = []
        if isinstance(context, Mapping):
            # Treat dictionary items as children
            children.extend(self.summarize_variables(context))

        elif self.is_table(context):
            # Treat table column series as children
            inspector = self.get_table_inspector(context)
            for column_name in inspector.get_columns(context):
                values = inspector.get_column_values(context, column_name)
                summary = self.summarize_variable(column_name, values)
                if summary is not None:
                    children.append(summary)

        elif isinstance(context, (list, set, frozenset, tuple)):
            # Treat collection items as children, with the index as the name
            for i, item in enumerate(context):
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
        self.env_comm.send(msg)

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

        if self.env_comm is None or self.shell is None:
            return

        hidden = self.shell.user_ns_hidden

        # Filter out hidden assigned variables
        filtered_assigned = self.summarize_variables(assigned, hidden)

        # Filter out hidden removed variables
        filtered_removed = set()
        for name in removed:
            if hidden is not None and name in hidden:
                continue
            filtered_removed.add(name)

        msg = EnvironmentMessageUpdate(filtered_assigned, filtered_removed)
        self.env_comm.send(msg)

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

        if self.env_comm is None or self.shell is None:
            return

        ns = self.shell.user_ns
        hidden = self.shell.user_ns_hidden
        filtered_variables = self.summarize_variables(ns, hidden)

        msg = EnvironmentMessageList(filtered_variables)
        self.env_comm.send(msg)

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

        if self.env_comm is None:
            return

        msg = EnvironmentMessageError(message)
        self.env_comm.send(msg)

    def summarize_variables(self, variables: Mapping, hidden: Mapping = None,
                            max_items: int = MAX_ITEMS) -> list:
        summaries = []
        i = 0

        for key, value in variables.items():

            # Filter out hidden variables
            if hidden is not None and key in hidden:
                continue

            # Ensure the number of items summarized is within our
            # max limit
            if i >= max_items:
                break

            summary = self.summarize_variable(key, value)
            if summary is not None:
                summaries.append(summary)

            i += 1

        return summaries

    def summarize_variable(self, key, value) -> EnvironmentVariable:

        kind = self.get_kind(value)

        if kind is not None:
            return self.summarize_any(key, value, kind)

        return None

    def summarize_any(self, key, value, kind) -> EnvironmentVariable:

        type_name = self.get_qualname(value)
        try:
            summarized_value = type_name
            length = self.get_length(value)
            size = sys.getsizeof(value)
            has_children = length > 0
            is_truncated = False

            # Apply type-specific formatting
            if kind == EnvironmentVariableKind.STRING:
                # For string summaries, avoid pprint as it wraps strings into line chunks
                summarized_value, is_truncated = self.truncate_string(value)
                summarized_value = repr(summarized_value)
                has_children = False

            elif kind == EnvironmentVariableKind.TABLE:
                # Tables are summarized by their dimensions
                summarized_value = self.format_table_summary(value)
                is_truncated = True

            elif kind == EnvironmentVariableKind.FUNCTION:
                # Functions are summarized by their signature
                summarized_value = self.format_function_summary(value)
                has_children = False

            elif kind == EnvironmentVariableKind.BYTES:
                # For bytes, even though they have a length, we don't set them
                # as having children
                summarized_value, is_truncated = self.summarize_value(value)
                has_children = False

            else:
                summarized_value, is_truncated = self.summarize_value(value)

            return EnvironmentVariable(key, summarized_value, kind,
                                       type_name, length, size, has_children, is_truncated)
        except Exception as err:
            logging.warning(err)
            return EnvironmentVariable(key, type_name, None)

    def format_table_summary(self, value) -> str:

        try:
            # Calculate DataFrame dimentions in rows x cols
            inspector = self.get_table_inspector(value)
            shape = inspector.shape(value)
            if shape is None:
                shape = (0, 0)

            summarized_value = 'DataFrame: '
            if self.get_length(shape) == 2:
                summarized_value = summarized_value + f'[{shape[0]} rows x {shape[1]} columns]'

            return summarized_value

        except Exception as err:
            logging.warning(err)
            return None

    def format_function_summary(self, value) -> str:
        if callable(value):
            sig = inspect.signature(value)
        else:
            sig = '()'
        return f'{value.__qualname__}{sig}'

    def summarize_value(self, value, width: int = ITEM_SUMMARY_PRINT_WIDTH) -> (str, bool):
        s = pprint.pformat(value, indent=1, width=width, compact=True)
        # TODO: Add type aware truncation
        return self.truncate_string(s)

    def truncate_string(self, value: str, max: int = MAX_ITEM_SUMMARY_LENGTH) -> (str, bool):
        if len(value) > max:
            return (value[:max], True)
        else:
            return (value, False)

    def format_value(self, value, clipboard_format: ClipboardFormat) -> str:

        if clipboard_format == ClipboardFormat.HTML:

            if self.is_table(value):
                inspector = self.get_table_inspector(value)
                return inspector.to_html(value)
            else:
                return html.escape(str(value))

        elif clipboard_format == ClipboardFormat.TAB:

            if self.is_table(value):
                inspector = self.get_table_inspector(value)
                return inspector.to_tsv(value)

        return str(value)

    def get_length(self, value) -> int:
        length = 0
        if hasattr(value, '__len__'):
            try:
                length = len(value)
            except:
                pass
        return length

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
        elif isinstance(value, numbers.Number):
            return EnvironmentVariableKind.NUMBER
        elif isinstance(value, bool):
            return EnvironmentVariableKind.BOOLEAN
        elif self.is_table(value):
            return EnvironmentVariableKind.TABLE
        elif isinstance(value, Mapping):
            return EnvironmentVariableKind.MAP
        elif isinstance(value, (bytes, bytearray, memoryview)):
            return EnvironmentVariableKind.BYTES
        elif isinstance(value, (Sequence, Set)):
            return EnvironmentVariableKind.COLLECTION
        elif isinstance(value, types.FunctionType):
            return EnvironmentVariableKind.FUNCTION
        elif isinstance(value, types.ModuleType):
            return None  # Hide module types for now
        elif value is not None:
            return EnvironmentVariableKind.OTHER
        else:
            return EnvironmentVariableKind.EMPTY

    TABLE_INSPECTORS = {PandasInspector.TABLE_CLASS_NAME: PandasInspector(),
                        PolarsInspector.TABLE_CLASS_NAME: PolarsInspector()}

    def is_table(self, value) -> bool:
        qualname = self.get_qualname(value)
        if qualname in self.TABLE_INSPECTORS.keys():
            return True
        return False

    def get_table_inspector(self, value) -> TableInspector:
        qualname = self.get_qualname(value)
        return self.TABLE_INSPECTORS.get(qualname, None)
