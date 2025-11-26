/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { codePointOffsetFromUtf16Index, JupyterPositronPosition, JupyterPositronRange, JupyterPositronLocation } from '../jupyter/TypesConverters';

suite('TypesConverters', () => {
	suite('codePointOffsetFromUtf16Index', () => {
		test('Empty string', () => {
			assert.strictEqual(codePointOffsetFromUtf16Index('', 0), 0);
			assert.strictEqual(codePointOffsetFromUtf16Index('', 5), 0);
		});

		test('Negative index', () => {
			assert.strictEqual(codePointOffsetFromUtf16Index('hello', -1), 0);
			assert.strictEqual(codePointOffsetFromUtf16Index('hello', -10), 0);
		});

		test('Zero index', () => {
			assert.strictEqual(codePointOffsetFromUtf16Index('hello', 0), 0);
			assert.strictEqual(codePointOffsetFromUtf16Index('😀', 0), 0);
		});

		test('ASCII text', () => {
			const text = 'hello';
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 0), 0);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 1), 1);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 2), 2);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 3), 3);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 4), 4);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 5), 5);
		});

		test('Index beyond string length', () => {
			const text = 'hi';
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 10), 2);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 100), 2);
		});

		test('Single emoji', () => {
			const text = '😀';
			// '😀' is 2 UTF-16 units, 1 code point
			assert.strictEqual(text.length, 2, 'UTF-16 length should be 2');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 0), 0);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 1), 0, 'Index at high surrogate should not count emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 2), 1, 'Index after emoji should count it');
		});

		test('Emoji at start', () => {
			const text = '😀abc';
			// '😀' = 2 units, then 3 ASCII chars
			assert.strictEqual(text.length, 5);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 0), 0);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 1), 0, 'Middle of emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 2), 1, 'After emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 3), 2, 'After emoji + 1 char');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 4), 3);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 5), 4);
		});

		test('Emoji at end', () => {
			const text = 'abc😀';
			assert.strictEqual(text.length, 5);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 0), 0);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 1), 1);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 2), 2);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 3), 3, 'Before emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 4), 3, 'Middle of emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 5), 4, 'After emoji');
		});

		test('Emoji in middle', () => {
			const text = 'a😀b';
			assert.strictEqual(text.length, 4);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 0), 0);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 1), 1, 'After a');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 2), 1, 'Middle of emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 3), 2, 'After emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 4), 3, 'After b');
		});

		test('Multiple emojis', () => {
			const text = '😀😁😂';
			// Each emoji is 2 UTF-16 units
			assert.strictEqual(text.length, 6);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 0), 0);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 1), 0, 'Middle of first emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 2), 1, 'After first emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 3), 1, 'Middle of second emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 4), 2, 'After second emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 5), 2, 'Middle of third emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 6), 3, 'After third emoji');
		});

		test('Mixed ASCII and emojis', () => {
			const text = 'Hi😀!';
			// H=1, i=1, 😀=2, !=1 => 5 UTF-16 units, 4 code points
			assert.strictEqual(text.length, 5);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 0), 0);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 1), 1);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 2), 2, 'After "Hi"');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 3), 2, 'Middle of emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 4), 3, 'After emoji');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 5), 4, 'After !');
		});

		test('Non-BMP characters (Chinese)', () => {
			// U+20000 is a CJK Ideograph Extension B character (surrogate pair)
			const text = '\u{20000}ab';
			assert.strictEqual(text.length, 4, '2 for surrogate pair + 2 ASCII');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 0), 0);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 1), 0, 'Middle of surrogate pair');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 2), 1, 'After surrogate pair');
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 3), 2);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 4), 3);
		});

		test('BMP special characters', () => {
			// These are within BMP (1 UTF-16 unit each)
			const text = '€£¥';
			assert.strictEqual(text.length, 3);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 0), 0);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 1), 1);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 2), 2);
			assert.strictEqual(codePointOffsetFromUtf16Index(text, 3), 3);
		});
	});

	suite('JupyterPositronPosition', () => {
		test('ASCII text at line start', () => {
			const position = new vscode.Position(0, 0);
			const text = 'hello world';
			const result = JupyterPositronPosition.from(position, text);

			assert.strictEqual(result.line, 0);
			assert.strictEqual(result.character, 0);
		});

		test('ASCII text mid-line', () => {
			const position = new vscode.Position(0, 5);
			const text = 'hello world';
			const result = JupyterPositronPosition.from(position, text);

			assert.strictEqual(result.line, 0);
			assert.strictEqual(result.character, 5);
		});

		test('Line number is preserved', () => {
			const position = new vscode.Position(10, 5);
			const text = 'hello';
			const result = JupyterPositronPosition.from(position, text);

			assert.strictEqual(result.line, 10);
			assert.strictEqual(result.character, 5);
		});

		test('Text with emoji - position after emoji', () => {
			const position = new vscode.Position(0, 2);
			const text = '😀a';
			const result = JupyterPositronPosition.from(position, text);

			assert.strictEqual(result.line, 0);
			assert.strictEqual(result.character, 1, 'Should count emoji as 1 code point');
		});

		test('Text with emoji - position in middle of emoji', () => {
			const position = new vscode.Position(0, 1);
			const text = '😀a';
			const result = JupyterPositronPosition.from(position, text);

			assert.strictEqual(result.line, 0);
			assert.strictEqual(result.character, 0, 'Should not count partial emoji');
		});

		test('Text with multiple emojis', () => {
			const position = new vscode.Position(0, 4);
			const text = '😀😁ab';
			const result = JupyterPositronPosition.from(position, text);

			assert.strictEqual(result.line, 0);
			assert.strictEqual(result.character, 2, 'Should count 2 emojis as 2 code points');
		});
	});

	suite('JupyterPositronRange', () => {
		test('ASCII text range', () => {
			const range = new vscode.Range(
				new vscode.Position(0, 0),
				new vscode.Position(0, 5)
			);
			const text = 'hello world';
			const result = JupyterPositronRange.from(range, text);

			assert.strictEqual(result.start.line, 0);
			assert.strictEqual(result.start.character, 0);
			assert.strictEqual(result.end.line, 0);
			assert.strictEqual(result.end.character, 5);
		});

		test('Range with emoji', () => {
			const range = new vscode.Range(
				new vscode.Position(0, 0),
				new vscode.Position(0, 4)
			);
			const text = '😀😁';
			const result = JupyterPositronRange.from(range, text);

			assert.strictEqual(result.start.line, 0);
			assert.strictEqual(result.start.character, 0);
			assert.strictEqual(result.end.line, 0);
			assert.strictEqual(result.end.character, 2, 'Should count 2 emojis as 2 code points');
		});

		test('Multi-line range', () => {
			const range = new vscode.Range(
				new vscode.Position(1, 2),
				new vscode.Position(3, 4)
			);
			const text = 'test';
			const result = JupyterPositronRange.from(range, text);

			assert.strictEqual(result.start.line, 1);
			assert.strictEqual(result.start.character, 2);
			assert.strictEqual(result.end.line, 3);
			assert.strictEqual(result.end.character, 4);
		});
	});

	suite('JupyterPositronLocation', () => {

		test('Location with file URI', () => {
			const uri = vscode.Uri.file('/path/to/file.txt');
			const range = new vscode.Range(
				new vscode.Position(0, 0),
				new vscode.Position(0, 5)
			);
			const location = new vscode.Location(uri, range);
			const text = 'hello';
			const result = JupyterPositronLocation.from(location, text);

			assert.ok(result.uri.includes('file'));
			assert.ok(result.uri.includes('file.txt'));
			assert.strictEqual(result.range.start.line, 0);
			assert.strictEqual(result.range.start.character, 0);
			assert.strictEqual(result.range.end.line, 0);
			assert.strictEqual(result.range.end.character, 5);
		});

		test('Location with emoji in text', () => {
			const uri = vscode.Uri.file('/test.txt');
			const range = new vscode.Range(
				new vscode.Position(0, 0),
				new vscode.Position(0, 3)
			);
			const location = new vscode.Location(uri, range);
			const text = '😀a';
			const result = JupyterPositronLocation.from(location, text);

			assert.ok(result.uri.includes('test.txt'));
			assert.strictEqual(result.range.start.line, 0);
			assert.strictEqual(result.range.start.character, 0);
			assert.strictEqual(result.range.end.line, 0);
			assert.strictEqual(result.range.end.character, 2, 'Should count emoji + a as 2 code points');
		});
	});
});
