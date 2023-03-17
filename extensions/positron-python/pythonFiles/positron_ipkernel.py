#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

from ipykernel.ipkernel import IPythonKernel, _get_comm_manager
from collections.abc import Mapping
from typing import Any, Optional
import enum
import logging
import numbers
import pprint
import sys
import types


# Marker used to track if no default was specified when popping an item from our dict
_NoDefaultSpecified = object()


class PositronDict(dict):

    """
    A custom dict used to track changed and deleted variables in the user
    namespace, allowing for partial updates to be sent to the client
    environment display after statements are executed.

    TODO: Detect modifications to collections and complex objects.
    """

    def __init__(self, other=None, **kwargs):
        super().__init__()
        self.update(other, **kwargs)
        self._positron_assigned = {}
        self._positron_removed = set()

    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        self._positron_assigned[key] = value

    def update(self, other=None, **kwargs):
        if other is not None:
            items = other
            if isinstance(other, Mapping):
                items = other.items()
            for key, value in items:
                self[key] = value
        for key, value in kwargs.items():
            self[key] = value

    def setdefault(self, key, default=None):
        result = super().setdefault(key, default)
        if result is default:
            self._positron_assigned[key] = default
        return result

    def __delitem__(self, key):
        super().__delitem__(key)
        self._positron_removed.add(key)

    def pop(self, key, default=_NoDefaultSpecified):
        result = None

        if default is _NoDefaultSpecified:
            result = super().pop(key)
        else:
            result = super().pop(key, default)

        if result is not default:
            self._positron_removed.add(key)

        return result

    def clear(self):
        super().clear()
        self._positron_reset_watch()

    def _positron_get_changes(self):
        return (self._positron_assigned.copy(), self._positron_removed.copy())

    def _positron_reset_watch(self):
        self._positron_assigned.clear()
        self._positron_removed.clear()


@enum.unique
class EnvironmentMessageType(str, enum.Enum):
    """
    Message types used in the positron.environment comm.
    """
    CLEAR = 'clear'
    DELETE = 'delete'
    ERROR = 'error'
    LIST = 'list'
    REFRESH = 'refresh'
    UPDATE = 'update'


@enum.unique
class EnvironmentVariableKind(str, enum.Enum):
    """
    Categories of variables in the user's environment.
    """
    DATAFRAME = 'dataframe'
    FUNCTION = 'function'
    LIST = 'list'
    NUMBER = 'number'
    STRING = 'string'
    VECTOR = 'vector'


# Note: classes below are derived from dict to satisfy ipykernel util method
# json_clean() which is used in comm message serialization
class EnvironmentVariable(dict):
    """
    Describes a variable in the user's environment.
    """

    def __init__(self, name: str, value: Any, kind: Optional[EnvironmentVariableKind],
                 type_name: str, length: int, size: int):
        self['name'] = name
        self['value'] = value
        if kind is not None:
            self['kind'] = getattr(EnvironmentVariableKind, kind.upper())
        self['type_name'] = type_name
        self['length'] = length
        self['size'] = size


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

    def __init__(self, variables: list[EnvironmentVariable]):
        super().__init__(EnvironmentMessageType.LIST)
        self['variables'] = variables


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


POSITRON_ENVIRONMENT_COMM = 'positron.environment'
"""The comm channel target name for Positron's Environment View"""


class PositronIPyKernel(IPythonKernel):
    """
    Positron extension of IPythonKernel.

    Adds additional comms to introspect the user's environment.
    """

    user_ns = PositronDict()
    """
    A PositronDict is used to watch for changes to user variables.
    We override it here before IPythonKernel uses it to initialize the
    actual user_ns in InteractiveShell.
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

        ns = self.shell.user_ns
        if hasattr(ns, '_positron_reset_watch'):
            ns._positron_reset_watch()

    def handle_post_execute(self) -> None:
        """
        After execution, sends an update message to the client to summarize
        the changes observed to variables in the user environment.
        """

        ns = self.shell.user_ns
        if hasattr(ns, '_positron_assigned'):
            assigned, removed = ns._positron_get_changes()
            ns._positron_reset_watch()
            self.send_update(assigned, removed)
        else:
            self.send_list()

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
                if msgType == 'refresh':
                    self.send_list()
                elif msgType == 'clear':
                    self.delete_all_vars()
                elif msgType == 'delete':
                    self.delete_vars(data.get('name', None))
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
        for key, value in ns.items():
            if key in hidden:
                continue
            try:
                # We check if value is None to avoid an issue in shell.del_var()
                # cleaning up references
                self.shell.del_var(key, value is None)
            except BaseException as err:
                # Warn if delete failed and key is still in scope
                if key in self.shell.user_ns:
                    logging.warning(f'Unable to delete variable \'{key}\'. Error: %s', err)
                pass

        # Refresh the client state to show
        self.send_list()

    def delete_vars(self, names) -> None:
        """
        Deletes the requested variables by name from the current user session.
        """

        if self.shell is None or names is None:
            return

        ns = self.shell.user_ns
        if hasattr(ns, '_positron_reset_watch'):
            ns._positron_reset_watch()

        for name in names:
            try:
                self.shell.del_var(name)
            except:
                logging.warning(f'Unable to delete variable \'{name}\'')
                pass

        if hasattr(ns, '_positron_get_changes'):
            assigned, removed = ns._positron_get_changes()
            self.send_update(assigned, removed)
        else:
            self.send_list()

    def send_update(self, assigned, removed) -> None:
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

        # If there are changes to report, send an update message
        if len(filtered_assigned) > 0 or len(filtered_removed) > 0:
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

    def send_error(self, message) -> None:
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

    def summarize_variables(self, items: Mapping, hidden: Mapping = None) -> list:
        variables = []

        for key, value in items.items():

            # Filter out hidden variables
            if hidden is not None and key in hidden:
                continue

            if isinstance(value, types.FunctionType):
                variables.append(self.summarize_function(key, value))
            else:
                variables.append(self.summarize_any(key, value))

        return variables

    def summarize_any(self, key, value) -> EnvironmentVariable:
        type_name = type(value).__name__
        try:
            kind = self.determine_kind(value)
            summarized_value = self.format_value(value)
            length = None
            if hasattr(value, '__len__'):
                try:
                    length = len(value)
                except:
                    pass
            size = sys.getsizeof(value)
            return EnvironmentVariable(key, summarized_value, kind, type_name, length, size)
        except:
            return EnvironmentVariable(key, type_name, None)

    def summarize_function(self, key, value) -> EnvironmentVariable:
        qname = f'{type(value).__name__} {value.__qualname__}'
        size = sys.getsizeof(value)
        return EnvironmentVariable(key, qname, EnvironmentVariableKind.FUNCTION, qname, None, size)

    def format_value(self, value, max_width: int = 1024) -> str:
        s = pprint.pformat(value, indent=1, width=max_width, compact=True)
        # TODO: Add type aware truncation
        s = (s[:max_width] + '...') if len(s) > max_width else s
        return s

    def determine_kind(self, value) -> str:
        if isinstance(value, str):
            return EnvironmentVariableKind.STRING
        elif isinstance(value, numbers.Number):
            return EnvironmentVariableKind.NUMBER
        elif isinstance(value, (list, set, frozenset, tuple, range)):
            return EnvironmentVariableKind.LIST
        elif isinstance(value, types.FunctionType):
            return EnvironmentVariableKind.FUNCTION
        else:
            return None
