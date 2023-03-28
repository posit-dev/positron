#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import inspect
import math
import pprint
import random
import string
import sys
import types
import unittest
from positron_ipkernel import PositronIPyKernel, EnvironmentVariable, TRUNCATE_SUMMARY_AT, SUMMARY_PRINT_WIDTH


class TestPositronIPKernel(unittest.TestCase):
    """
    Unit tests for the Positron IPython Kernel.

    These tests focus on the serialization of the different kinds of Python
    variables that would be displayed in the Environment Pane.
    """

    IPK = None

    @classmethod
    def setUpClass(cls):
        TestPositronIPKernel.IPK = PositronIPyKernel()

    @classmethod
    def tearDownClass(cls):
        TestPositronIPKernel.IPK = None

    def setUp(self):
        self.kernel = TestPositronIPKernel.IPK

    #
    # Helper Methods
    #

    def compare_summary(self, result, expected):
        self.assertEqual(result['display_name'], expected['display_name'])
        self.assertEqual(result['display_value'], expected['display_value'])
        self.assertEqual(result['kind'], expected['kind'])
        self.assertEqual(result['display_type'], expected['display_type'])
        self.assertEqual(result['length'], expected['length'])
        self.assertEqual(result['has_children'], expected['has_children'])
        self.assertEqual(result['is_truncated'], expected['is_truncated'])
        if expected['size'] is not None:
            self.assertEqual(result['size'], expected['size'])
        else:
            self.assertIsNotNone(result['size'])

    #
    # Test Booleans
    #

    BOOL_CASES: set[bytes] = set([True, False])

    def test_booleans(self):

        cases = self.BOOL_CASES

        for i, case in enumerate(cases):
            expected = EnvironmentVariable(f'xBool{i}', str(case), 'boolean', 'bool', 0)

            key, value = f'xBool{i}', case
            result = self.kernel.summarize_variable(key, value)

            self.compare_summary(result, expected)

    #
    # Test Strings
    #

    STRING_CASES: set[str] = set(['',                                          # Empty String
                                  'Hello, world!',                             # Basic String
                                  '    ',                                      # Whitespace String
                                  'First\nSecond\nThird',                      # Multiline String
                                  'This has a Windows linebreak\r\n',          # Windows Linebreak String
                                  ' Space Before\tTab Between\tSpace After ',  # Trailing Whitespace String
                                  'É una bella città',                         # Accented String
                                  'こんにちは',                                  # Japanese String
                                  'עֶמֶק',                                       # RTL String
                                  'ʇxǝʇ',                                      # Upsidedown String
                                  '😅😁'])                                      # Emoji String

    def test_strings(self):

        cases = self.STRING_CASES

        for i, case in enumerate(cases):
            length = len(case)
            display_type = f'str [{length}]'
            expected = EnvironmentVariable(f'xStr{i}', repr(case), 'string', display_type, length)

            key, value = f'xStr{i}', case
            result = self.kernel.summarize_variable(key, value)

            self.compare_summary(result, expected)

    def test_string_long_truncated(self):

        long_string = ''.join(random.choices(string.ascii_letters, k=(TRUNCATE_SUMMARY_AT + 10)))
        length = len(long_string)
        expected_value = f'\'{long_string[:TRUNCATE_SUMMARY_AT]}\''
        expected = EnvironmentVariable('xStrT', expected_value, 'string',
                                       f'str [{length}]', length, None, False, True)

        key, value = 'xStrT', long_string
        result = self.kernel.summarize_variable(key, value)

        self.compare_summary(result, expected)

    #
    # Test Numbers
    #

    # Python 3 ints are unbounded, but we include a few large numbers
    # for basic test cases
    INT_CASES: set[int] = set([-sys.maxsize * 100, -sys.maxsize, -1, 0, 1,
                               sys.maxsize, sys.maxsize * 100])

    def test_number_ints(self):

        cases = self.INT_CASES

        for i, case in enumerate(cases):
            expected = EnvironmentVariable(f'xInt{i}', str(case), 'number', 'int', 0)

            key, value = f'xInt{i}', case
            result = self.kernel.summarize_variable(key, value)

            self.compare_summary(result, expected)

    FLOAT_CASES: set[float] = set([float('-inf'), -sys.float_info.max, -1.0, -sys.float_info.min,
                                  float('nan'), 0.0, sys.float_info.min, 1.0, math.pi,
                                  sys.float_info.max, float('inf')])

    def test_number_floats(self):

        cases = self.FLOAT_CASES

        for i, case in enumerate(cases):
            expected = EnvironmentVariable(f'xFloat{i}', str(case), 'number', 'float', 0)

            key, value = f'xFloat{i}', case
            result = self.kernel.summarize_variable(key, value)

            self.compare_summary(result, expected)

    COMPLEX_CASES: set[complex] = set([complex(-1.0, 100.1), complex(-1.0, 0.0), complex(0, 0),
                                       complex(1.0, 0.0), complex(1.0, 100.1)])

    def test_number_complex(self):

        cases = self.COMPLEX_CASES

        for i, case in enumerate(cases):
            expected = EnvironmentVariable(f'xComplex{i}', str(case), 'number', 'complex', 0)

            key, value = f'xComplex{i}', case
            result = self.kernel.summarize_variable(key, value)

            self.compare_summary(result, expected)

    #
    # Test Bytes
    #

    BYTES_CASES: set[bytes] = set([b'', b'\x00', b'caff\\xe8'])

    def test_bytes_literals(self):

        cases = self.BYTES_CASES

        for i, case in enumerate(cases):
            length = len(case)
            expected = EnvironmentVariable(f'xBytes{i}', str(case), 'bytes', f'bytes [{length}]', length)

            key, value = f'xBytes{i}', case
            result = self.kernel.summarize_variable(key, value)

            self.compare_summary(result, expected)

    BYTEARRAY_CASES: list[bytes] = list([bytearray(), bytearray(0), bytearray(1), bytearray(b'\x41\x42\x43')])

    def test_bytearrays(self):

        cases = self.BYTEARRAY_CASES

        for i, case in enumerate(cases):
            length = len(case)
            expected = EnvironmentVariable(f'xBytearray{i}', str(case), 'bytes',
                                           f'bytearray [{length}]', length)

            key, value = f'xBytearray{i}', case
            result = self.kernel.summarize_variable(key, value)

            self.compare_summary(result, expected)

    def test_bytearray_truncated(self):

        case = bytearray(TRUNCATE_SUMMARY_AT * 2)
        length = len(case)
        expected = EnvironmentVariable('xBytearrayT', str(case)[:TRUNCATE_SUMMARY_AT],
                                       'bytes', f'bytearray [{length}]', length, None, False, True)

        key, value = 'xBytearrayT', case
        result = self.kernel.summarize_variable(key, value)

        self.compare_summary(result, expected)

    def test_memoryview(self):

        byte_array = bytearray('東京', 'utf-8')
        case = memoryview(byte_array)
        length = len(case)
        expected = EnvironmentVariable('xMemoryview', str(case),
                                       'bytes', f'memoryview [{length}]', length)

        key, value = 'xMemoryview', case
        result = self.kernel.summarize_variable(key, value)

        self.compare_summary(result, expected)

    #
    # Test Empty
    #

    def test_none(self):

        case = None
        expected = EnvironmentVariable('xNone', 'None', 'empty', 'NoneType', 0)

        key, value = 'xNone', case
        result = self.kernel.summarize_variable(key, value)

        self.compare_summary(result, expected)

    #
    # Test Collections
    #

    def test_set(self):

        cases = [set(),
                 set([None]),
                 set(self.BOOL_CASES),
                 set(self.INT_CASES),
                 set(self.FLOAT_CASES),
                 set(self.COMPLEX_CASES),
                 set(self.BYTES_CASES),
                 set(self.STRING_CASES)]
        for i, case in enumerate(cases):

            length = len(case)
            expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
            expected = EnvironmentVariable(f'xSet{i}', expected_value, 'collection',
                                           f'set {{{length}}}',
                                           length, None, length > 0)

            key, value = f'xSet{i}', case
            result = self.kernel.summarize_variable(key, value)

            self.compare_summary(result, expected)

    def test_set_truncated(self):

        case = set(list(range(TRUNCATE_SUMMARY_AT * 2)))
        length = len(case)
        expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
        expected = EnvironmentVariable('xSetT', expected_value[:TRUNCATE_SUMMARY_AT],
                                       'collection', f'set {{{length}}}', length, None, True, True)

        key, value = 'xSetT', case
        result = self.kernel.summarize_variable(key, value)

        self.compare_summary(result, expected)

    def test_list(self):

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

            length = len(case)
            expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
            expected = EnvironmentVariable(f'xList{i}', expected_value, 'collection',
                                           f'list [{length}]', length, None, length > 0)

            key, value = f'xList{i}', case
            result = self.kernel.summarize_variable(key, value)

            self.compare_summary(result, expected)

    def test_list_truncated(self):

        case = list(range(TRUNCATE_SUMMARY_AT * 2))
        length = len(case)
        expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
        expected = EnvironmentVariable('xListT', expected_value[:TRUNCATE_SUMMARY_AT],
                                       'collection', f'list [{length}]', length, None, True, True)

        key, value = 'xListT', case
        result = self.kernel.summarize_variable(key, value)

        self.compare_summary(result, expected)

    def test_list_cycle(self):

        case = list([1, 2])
        case.append(case)
        length = len(case)
        expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
        expected = EnvironmentVariable('xListCycle', expected_value[:TRUNCATE_SUMMARY_AT],
                                       'collection', f'list [{length}]', length, None, True)

        key, value = 'xListCycle', case
        result = self.kernel.summarize_variable(key, value)

        self.compare_summary(result, expected)

    def test_ranges(self):

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
            length = len(case)
            expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
            expected = EnvironmentVariable(f'xRange{i}', expected_value, 'collection',
                                           f'range [{length}]', length)

            key, value = f'xRange{i}', case
            result = self.kernel.summarize_variable(key, value)

            self.compare_summary(result, expected)

    #
    # Test Maps
    #

    def test_maps(self):

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

            length = len(case)
            expected_value = pprint.pformat(case, width=SUMMARY_PRINT_WIDTH, compact=True)
            expected = EnvironmentVariable(f'xDict{i}', expected_value, 'map',
                                           f'dict [{length}]', length, None, length > 0)

            key, value = f'xDict{i}', case
            result = self.kernel.summarize_variable(key, value)

            self.compare_summary(result, expected)

    #
    # Test Functions
    #

    def test_functions(self):
        helper = HelperClass()
        cases = [lambda: None,        # No argument lambda function
                 lambda x: x,         # Single argument lambda function
                 lambda x, y: x + y,  # Multiple argument lambda function
                 helper.fn_no_args,   # No argument method
                 helper.fn_one_arg,   # Single argument method with single return type
                 helper.fn_two_args]  # Multiple argument method with tuple return type
        for i, case in enumerate(cases):

            expected_value = f'{case.__qualname__}{inspect.signature(case)}'
            expected_type = 'function'
            if (isinstance(case, types.MethodType)):
                expected_type = 'method'
            expected = EnvironmentVariable(f'xFn{i}', expected_value, 'function', expected_type)

            key, value = f'xFn{i}', case
            result = self.kernel.summarize_variable(key, value)

            self.compare_summary(result, expected)


class HelperClass:
    """
    A helper class for testing method functions.
    """
    def fn_no_args(self):
        return 'No args'

    def fn_one_arg(self, x: str) -> str:
        return f'One arg {x}'

    def fn_two_args(self, x: int, y: int) -> (int, int):
        return (x, y)


if __name__ == '__main__':
    unittest.main()  # pragma: no cover
