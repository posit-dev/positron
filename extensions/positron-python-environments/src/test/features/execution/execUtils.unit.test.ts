import * as assert from 'assert';
import { quoteArgs, quoteStringIfNecessary } from '../../../features/execution/execUtils';

suite('Execution Utils Tests', () => {
    suite('quoteStringIfNecessary', () => {
        test('should not quote string without spaces', () => {
            const input = 'simplestring';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, 'simplestring');
        });

        test('should not quote string without spaces containing special characters', () => {
            const input = 'path/to/file.txt';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, 'path/to/file.txt');
        });

        test('should quote string with spaces', () => {
            const input = 'string with spaces';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, '"string with spaces"');
        });

        test('should quote path with spaces', () => {
            const input = 'C:\\Program Files\\Python';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, '"C:\\Program Files\\Python"');
        });

        test('should not double-quote already quoted string', () => {
            const input = '"already quoted"';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, '"already quoted"');
        });

        test('should not double-quote already quoted string with spaces', () => {
            const input = '"string with spaces"';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, '"string with spaces"');
        });

        test('should quote string with space that is partially quoted', () => {
            const input = '"partially quoted';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, '""partially quoted"');
        });

        test('should quote string with space that ends with quote', () => {
            const input = 'partially quoted"';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, '"partially quoted""');
        });

        test('should handle empty string', () => {
            const input = '';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, '');
        });

        test('should handle string with only spaces', () => {
            const input = '   ';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, '"   "');
        });

        test('should handle string with leading space', () => {
            const input = ' leading';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, '" leading"');
        });

        test('should handle string with trailing space', () => {
            const input = 'trailing ';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, '"trailing "');
        });

        test('should handle string with multiple spaces', () => {
            const input = 'multiple   spaces   here';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, '"multiple   spaces   here"');
        });

        test('should not quote single character without space', () => {
            const input = 'a';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, 'a');
        });

        test('should handle dash and hyphen characters without spaces', () => {
            const input = '--flag-name';
            const result = quoteStringIfNecessary(input);
            assert.strictEqual(result, '--flag-name');
        });
    });

    suite('quoteArgs', () => {
        test('should return empty array for empty input', () => {
            const input: string[] = [];
            const result = quoteArgs(input);
            assert.deepStrictEqual(result, []);
        });

        test('should not quote args without spaces', () => {
            const input = ['arg1', 'arg2', 'arg3'];
            const result = quoteArgs(input);
            assert.deepStrictEqual(result, ['arg1', 'arg2', 'arg3']);
        });

        test('should quote args with spaces', () => {
            const input = ['arg with spaces', 'another arg'];
            const result = quoteArgs(input);
            assert.deepStrictEqual(result, ['"arg with spaces"', '"another arg"']);
        });

        test('should handle mixed args with and without spaces', () => {
            const input = ['simplearg', 'arg with spaces', 'anotherarg'];
            const result = quoteArgs(input);
            assert.deepStrictEqual(result, ['simplearg', '"arg with spaces"', 'anotherarg']);
        });

        test('should not double-quote already quoted args', () => {
            const input = ['"already quoted"', 'normal'];
            const result = quoteArgs(input);
            assert.deepStrictEqual(result, ['"already quoted"', 'normal']);
        });

        test('should handle array with single element', () => {
            const input = ['single element with space'];
            const result = quoteArgs(input);
            assert.deepStrictEqual(result, ['"single element with space"']);
        });

        test('should handle paths correctly', () => {
            const input = ['C:\\Program Files\\Python', '/usr/bin/python', 'simple'];
            const result = quoteArgs(input);
            assert.deepStrictEqual(result, ['"C:\\Program Files\\Python"', '/usr/bin/python', 'simple']);
        });

        test('should handle command line flags and values', () => {
            const input = ['--flag', 'value with spaces', '-f', 'normalvalue'];
            const result = quoteArgs(input);
            assert.deepStrictEqual(result, ['--flag', '"value with spaces"', '-f', 'normalvalue']);
        });

        test('should handle empty strings in array', () => {
            const input = ['', 'arg1', ''];
            const result = quoteArgs(input);
            assert.deepStrictEqual(result, ['', 'arg1', '']);
        });

        test('should preserve order of arguments', () => {
            const input = ['first', 'second with space', 'third', 'fourth with space'];
            const result = quoteArgs(input);
            assert.deepStrictEqual(result, ['first', '"second with space"', 'third', '"fourth with space"']);
        });
    });
});
