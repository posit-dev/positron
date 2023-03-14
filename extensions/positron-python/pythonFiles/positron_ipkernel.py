#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

from ipykernel.ipkernel import IPythonKernel, _get_comm_manager
import enum
import numbers
import pprint
import sys
import types


class PositronIPyKernel(IPythonKernel):
    """
    Positron extension of IPythonKernel.

    Adds additional comms to introspect the user's environment.
    """

    def __init__(self, **kwargs):
        """Initialize the kernel."""
        super().__init__(**kwargs)

        _get_comm_manager().register_target('positron.environment', self.environment_comm)

    def environment_comm(self, comm, open_msg):

        @comm.on_msg
        def _recv(msg):
            data = msg['content']['data']
            msgType = data['msg_type']
            if msgType == 'refresh':
                list_environment()
            else:
                send_error(f'Unknown message type \'{msgType}\'')

        def list_environment():

            variables = []
            for key, value in self.shell.user_ns.items():

                # Exclude hidden variables
                if key in self.shell.user_ns_hidden:
                    continue

                if isinstance(value, types.FunctionType):
                    variables.append(summarize_function(key, value))
                else:
                    variables.append(summarize_any(key, value))

            msg = EnvironmentMessageList(variables)
            comm.send(msg)

        def summarize_any(key, value):
            type_name = type(value).__name__
            try:
                kind = determine_kind(value)
                summarized_value = format_value(value)
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

        def summarize_function(key, value):
            qname = f'{type(value).__name__} {value.__qualname__}'
            size = sys.getsizeof(value)
            return EnvironmentVariable(key, qname, EnvironmentVariableKind.FUNCTION, qname, None, size)

        def format_value(value, max_width: int = 1024):
            s = pprint.pformat(value, indent=1, width=max_width, compact=True)
            # TODO: Add type aware truncation
            s = (s[:max_width] + '...') if len(s) > max_width else s
            return s

        def determine_kind(value):
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

        def send_error(message):
            msg = EnvironmentMessageError(message)
            comm.send(msg)

        # Send summary of user environment on comm initialization
        list_environment()


@enum.unique
class EnvironmentMessageType(str, enum.Enum):
    """
    Message types in the 'environment' comm.
    """
    LIST = 'list',
    REFRESH = 'refresh',
    ERROR = 'error'


@enum.unique
class EnvironmentVariableKind(str, enum.Enum):
    """
    Kinds of variables in the 'environment' comm.
    """
    STRING = 'string',
    NUMBER = 'number',
    VECTOR = 'vector',
    LIST = 'list',
    FUNCTION = 'function',
    DATAFRAME = 'dataframe'


# Note: classes derived from dict to satisfy ipykernel util json_clean()
class EnvironmentVariable(dict):
    """
    Describes an environment variable.
    """

    def __init__(self, name: str, value, kind: EnvironmentVariableKind, type_name: str, length: int, size: int):
        self['name'] = name
        self['value'] = value
        if kind is not None:
            self['kind'] = getattr(EnvironmentVariableKind, kind.upper())
        self['type_name'] = type_name
        self['length'] = length
        self['size'] = size


class EnvironmentMessage(dict):
    """
    Base message for environment comm.
    """

    def __init__(self, msg_type):
        self['msg_type'] = getattr(EnvironmentMessageType, msg_type.upper())


class EnvironmentMessageList(EnvironmentMessage):
    """
    Message 'list' type summarizes the variables of the user environment.
    """

    def __init__(self, variables: list[EnvironmentVariable]):
        super().__init__(EnvironmentMessageType.LIST)
        self['variables'] = variables


class EnvironmentMessageError(EnvironmentMessage):
    """
    Message 'error' type is used to report a problem to the client.
    """

    def __init__(self, message):
        super().__init__(EnvironmentMessageType.ERROR)
        self['message'] = message
