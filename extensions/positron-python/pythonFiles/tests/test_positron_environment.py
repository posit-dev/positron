#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import inspect
import math
import os
import pprint
import random
import string
import sys
import types

import pytest

# append project parent to the path so that we can import the positron module
current = os.path.dirname(os.path.realpath(__file__))
parent = os.path.dirname(current)
sys.path.append(parent)

from positron import (
    SUMMARY_PRINT_WIDTH,
    TRUNCATE_SUMMARY_AT,
    EnvironmentService,
    EnvironmentVariable,
)


class TestEnvironmentService:
    """
    Unit tests for the Positron Environment Service Comm.

    These tests focus on the serialization of the different kinds of Python
    variables that would be displayed in the Environment Pane.
    """

    @pytest.fixture(scope='class', autouse=True)
    def env_service(self) -> EnvironmentService:
        return EnvironmentService(None)

    #
    # Helper Methods
    #

    def compare_summary(self, result, expected):
        assert result['display_name'] == expected['display_name']
        assert result['display_value'] == expected['display_value']
        assert result['kind'] == expected['kind']
        assert result['type_info'] == expected['type_info']
        assert result['display_type'] == expected['display_type']
        assert result['access_key'] == expected['access_key']
        assert result['length'] == expected['length']
        assert result['has_children'] == expected['has_children']
        assert result['has_viewer'] == expected['has_viewer']
        assert result['is_truncated'] == expected['is_truncated']
        if expected['size'] is not None:
            assert result['size'] == expected['size']
        else:
            assert result['size'] is not None

    #
    # Test Booleans
    #

    BOOL_CASES: set[bytes] = set([True, False])

    def test_booleans(self, env_service):

        cases = self.BOOL_CASES

        for i, case in enumerate(cases):
            display_name = f'xBool{i}'
            expected = EnvironmentVariable(display_name, str(case), 'boolean', 'bool', 'bool',
                                           display_name, 0)

            key, value = display_name, case
            result = env_service._summarize_variable(key, value)

            self.compare_summary(result, expected)

    #
    # Test Strings
    #

    STRING_CASES: set[str] = set(['',                                          # Empty String
                                  'Hello, world!',                             # Basic String
                                  '    ',                                      # Whitespace String
                                  'First\nSecond\nThird',                      # Multiline String
                                  'This has a Windows linebreak\r\n',          # Windows Linebreak
                                  ' Space Before\tTab Between\tSpace After ',  # Trailing Whitespace
                                  'É una bella città',                         # Accented String
                                  'こんにちは',                                  # Japanese String
                                  'עֶמֶק',                                       # RTL String
                                  'ʇxǝʇ',                                      # Upsidedown String
                                  '😅😁'])                                      # Emoji String

    def test_strings(self, env_service):

        cases = self.STRING_CASES

        for i, case in enumerate(cases):
            display_name = f'xStr{i}'
            length = len(case)
            expected = EnvironmentVariable(display_name, repr(case), 'string', 'str', 'str',
                                           display_name, length)

            key, value = display_name, case
            result = env_service._summarize_variable(key, value)

            self.compare_summary(result, expected)

    def test_string_long_truncated(self, env_service):

        display_name = 'xStrT'
        long_string = ''.join(random.choices(string.ascii_letters, k=(TRUNCATE_SUMMARY_AT + 10)))
        length = len(long_string)
        expected_value = f'\'{long_string[:TRUNCATE_SUMMARY_AT]}\''
        expected = EnvironmentVariable(display_name, expected_value, 'string', 'str', 'str',
                                       display_name, length, None, False, False, True)

        key, value = display_name, long_string
        result = env_service._summarize_variable(key, value)

        self.compare_summary(result, expected)

    #
    # Test Numbers
    #

    # Python 3 ints are unbounded, but we include a few large numbers
    # for basic test cases
    INT_CASES: set[int] = set([-sys.maxsize * 100, -sys.maxsize, -1, 0, 1,
                               sys.maxsize, sys.maxsize * 100])

    def test_number_ints(self, env_service):

        cases = self.INT_CASES

        for i, case in enumerate(cases):
            display_name = f'xInt{i}'
            expected = EnvironmentVariable(display_name, str(case), 'number', 'int', 'int',
                                           display_name, 0)

            key, value = display_name, case
            result = env_service._summarize_variable(key, value)

            self.compare_summary(result, expected)

    FLOAT_CASES: set[float] = set([float('-inf'), -sys.float_info.max, -1.0, -sys.float_info.min,
                                  float('nan'), 0.0, sys.float_info.min, 1.0, math.pi,
                                  sys.float_info.max, float('inf')])

    def test_number_floats(self, env_service):

        cases = self.FLOAT_CASES

        for i, case in enumerate(cases):
            display_name = f'xFloat{i}'
            expected = EnvironmentVariable(display_name, str(case), 'number', 'float', 'float',
                                           display_name, 0)

            key, value = display_name, case
            result = env_service._summarize_variable(key, value)

            self.compare_summary(result, expected)

    COMPLEX_CASES: set[complex] = set([complex(-1.0, 100.1), complex(-1.0, 0.0), complex(0, 0),
                                       complex(1.0, 0.0), complex(1.0, 100.1)])

    def test_number_complex(self, env_service):

        cases = self.COMPLEX_CASES

        for i, case in enumerate(cases):
            display_name = f'xComplex{i}'
            expected = EnvironmentVariable(display_name, str(case), 'number', 'complex', 'complex',
                                           display_name, 0)

            key, value = display_name, case
            result = env_service._summarize_variable(key, value)

            self.compare_summary(result, expected)

    #
    # Test Bytes
    #

    BYTES_CASES: set[bytes] = set([b'', b'\x00', b'caff\\xe8'])

    def test_bytes_literals(self, env_service):

        cases = self.BYTES_CASES

        for i, case in enumerate(cases):
            display_name = f'xBytes{i}'
            length = len(case)
            expected = EnvironmentVariable(display_name, str(case), 'bytes', f'bytes [{length}]',
                                           'bytes', display_name, length)

            key, value = display_name, case
            result = env_service._summarize_variable(key, value)

            self.compare_summary(result, expected)

    BYTEARRAY_CASES: list[bytes] = list([bytearray(),
                                         bytearray(0),
                                         bytearray(1),
                                         bytearray(b'\x41\x42\x43')])

    def test_bytearrays(self, env_service):

        cases = self.BYTEARRAY_CASES

        for i, case in enumerate(cases):
            display_name = f'xBytearray{i}'
            length = len(case)
            expected = EnvironmentVariable(display_name, str(case), 'bytes',
                                           f'bytearray [{length}]', 'bytearray',
                                           display_name, length)

            key, value = display_name, case
            result = env_service._summarize_variable(key, value)

            self.compare_summary(result, expected)

    def test_bytearray_truncated(self, env_service):

        display_name = 'xBytearrayT'
        case = bytearray(TRUNCATE_SUMMARY_AT * 2)
        length = len(case)
        expected = EnvironmentVariable(display_name, str(case)[:TRUNCATE_SUMMARY_AT], 'bytes',
                                       f'bytearray [{length}]', 'bytearray', display_name,
                                       length, None, False, False, True)

        key, value = display_name, case
        result = env_service._summarize_variable(key, value)

        self.compare_summary(result, expected)

    def test_memoryview(self, env_service):

        display_name = 'xMemoryview'
        byte_array = bytearray('東京', 'utf-8')
        case = memoryview(byte_array)
        length = len(case)
        expected = EnvironmentVariable(display_name, str(case),
                                       'bytes', f'memoryview [{length}]', 'memoryview',
                                       display_name, length)

        key, value = display_name, case
        result = env_service._summarize_variable(key, value)

        self.compare_summary(result, expected)

    #
    # Test Empty
    #

    def test_none(self, env_service):

        display_name = 'xNone'
        case = None
        expected = EnvironmentVariable(display_name, 'None', 'empty', 'NoneType', 'None',
                                       display_name, 0)

        key, value = display_name, case
        result = env_service._summarize_variable(key, value)

        self.compare_summary(result, expected)

    #
    # Test Collections
    #

    def test_set(self, env_service):

        cases = [set(),
                 set([None]),
                 set(self.BOOL_CASES),
                 set(self.INT_CASES),
                 set(self.FLOAT_CASES),
                 set(self.COMPLEX_CASES),
                 set(self.BYTES_CASES),
                 set(self.STRING_CASES)]
        for i, case in enumerate(cases):

            display_name = f'xSet{i}'
            length = len(case)
            expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
            expected = EnvironmentVariable(display_name, expected_value, 'collection',
                                           f'set {{{length}}}', 'set', display_name,
                                           length, None, length > 0)

            key, value = display_name, case
            result = env_service._summarize_variable(key, value)

            self.compare_summary(result, expected)

    def test_set_truncated(self, env_service):

        display_name = 'xSetT'
        case = set(list(range(TRUNCATE_SUMMARY_AT * 2)))
        length = len(case)
        expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
        expected = EnvironmentVariable(display_name, expected_value[:TRUNCATE_SUMMARY_AT],
                                       'collection', f'set {{{length}}}', 'set', display_name,
                                       length, None, True, False, True)

        key, value = display_name, case
        result = env_service._summarize_variable(key, value)

        self.compare_summary(result, expected)

    def test_list(self, env_service):

        cases = [list(),
                 list([None]),
                 list(self.BOOL_CASES),
                 list(self.INT_CASES),
                 list(self.FLOAT_CASES),
                 list(self.COMPLEX_CASES),
                 list(self.BYTES_CASES),
                 list(self.BYTEARRAY_CASES),
                 list(self.STRING_CASES)]
        for i, case in enumerate(cases):

            display_name = f'xList{i}'
            length = len(case)
            expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
            expected = EnvironmentVariable(display_name, expected_value, 'collection',
                                           f'list [{length}]', 'list', display_name,
                                           length, None, length > 0)

            key, value = f'xList{i}', case
            result = env_service._summarize_variable(key, value)

            self.compare_summary(result, expected)

    def test_list_truncated(self, env_service):

        display_name = 'xListT'
        case = list(range(TRUNCATE_SUMMARY_AT * 2))
        length = len(case)
        expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
        expected = EnvironmentVariable(display_name, expected_value[:TRUNCATE_SUMMARY_AT],
                                       'collection', f'list [{length}]', 'list', display_name,
                                       length, None, True, False, True)

        key, value = display_name, case
        result = env_service._summarize_variable(key, value)

        self.compare_summary(result, expected)

    def test_list_cycle(self, env_service):

        display_name = 'xListCycle'
        case = list([1, 2])
        case.append(case)
        length = len(case)
        expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
        expected = EnvironmentVariable(display_name, expected_value[:TRUNCATE_SUMMARY_AT],
                                       'collection', f'list [{length}]', 'list', display_name,
                                       length, None, True)

        key, value = display_name, case
        result = env_service._summarize_variable(key, value)

        self.compare_summary(result, expected)

    def test_ranges(self, env_service):

        cases = [range(0),            # Empty Range
                 range(1),            # Range with positive start, 1 element
                 range(-1, 0),        # Range with negative start, 1 element
                 range(-2, 3),        # Range with negative start, positive stop
                 range(10, 21, 2),    # Range with positive start, positive stop, and positive step
                 range(20, 9, -2),    # Range with positive start, positive stop, and negative step
                 range(2, -10, -2),   # Range with positive start, negative stop, and negative step
                 range(-20, -9, 2),   # Range with negative start, negative stop, and positive step
                 range(-10, 3, 2),    # Range with negative start, positive stop, and positive step
                 range(1, 5000)]      # Large Range (compact display, does not show elements)
        for i, case in enumerate(cases):
            display_name = f'xRange{i}'
            length = len(case)
            expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
            expected = EnvironmentVariable(display_name, expected_value, 'collection',
                                           f'range [{length}]', 'range', display_name, length)

            key, value = display_name, case
            result = env_service._summarize_variable(key, value)

            self.compare_summary(result, expected)

    #
    # Test Maps
    #

    def test_maps(self, env_service):

        cases = [{},                                  # empty dict
                 {'': None},                          # empty key
                 {10: "Ten"},                         # int key
                 {'A': True},                         # bool value
                 {'B': 1},                            # int value
                 {'C': -1.01},                        # float value
                 {'D': complex(1, 2)},                # complex value
                 {'E': 'Echo'},                       # str value
                 {'F': b'Foxtrot'},                   # bytes value
                 {'G': bytearray(b'\x41\x42\x43')},   # byterray value
                 {'H': (1, 2, 3)},                    # tuple value
                 {'I': [1, 2, 3]},                    # list value
                 {'J': {1, 2, 3}},                    # set value
                 {'K': range(3)},                     # range value
                 {'L': {'L1': 1, 'L2': 2, 'L3': 3}}]  # nested dict value
        for i, case in enumerate(cases):

            display_name = f'xDict{i}'
            length = len(case)
            expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
            expected = EnvironmentVariable(display_name, expected_value, 'map',
                                           f'dict [{length}]', 'dict', display_name,
                                           length, None, length > 0)

            key, value = display_name, case
            result = env_service._summarize_variable(key, value)

            self.compare_summary(result, expected)

    #
    # Test Functions
    #

    def test_functions(self, env_service):
        helper = HelperClass()
        cases = [lambda: None,        # No argument lambda function
                 lambda x: x,         # Single argument lambda function
                 lambda x, y: x + y,  # Multiple argument lambda function
                 helper.fn_no_args,   # No argument method
                 helper.fn_one_arg,   # Single argument method with single return type
                 helper.fn_two_args]  # Multiple argument method with tuple return type
        for i, case in enumerate(cases):

            display_name = f'xFn{i}'
            expected_value = f'{case.__qualname__}{inspect.signature(case)}'
            expected_type = 'function'
            if (isinstance(case, types.MethodType)):
                expected_type = 'method'
            expected = EnvironmentVariable(display_name, expected_value, 'function', expected_type,
                                           expected_type, display_name)

            key, value = display_name, case
            result = env_service._summarize_variable(key, value)

            self.compare_summary(result, expected)


class HelperClass:
    """
    A helper class for testing method functions.
    """
    def fn_no_args(self, env_service):
        return 'No args'

    def fn_one_arg(self, x: str) -> str:
        return f'One arg {x}'

    def fn_two_args(self, x: int, y: int) -> (int, int):
        return (x, y)
