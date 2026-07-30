/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createPinReadCodeGenerator } from '../pinsCode.js';

suite('createPinReadCodeGenerator', () => {
	const target = { serverUrl: 'https://connect.example.com', fullName: 'julia/cars' };

	test('the default syntax is one of the offered syntaxes', () => {
		// The Convert-to-Code dialog pre-selects defaultSyntaxName from the offered list; a default
		// that isn't in the list would open the dialog on a selection the dropdown can't display.
		const gen = createPinReadCodeGenerator(target);
		assert.ok(gen.syntaxNames.includes(gen.defaultSyntaxName));
	});

	test('R reads the latest version when none is given', () => {
		const gen = createPinReadCodeGenerator(target);
		assert.deepStrictEqual(gen.generate('R'), [
			'library(pins)',
			'board <- board_connect(server = "https://connect.example.com")',
			'pin_read(board, "julia/cars")',
		]);
	});

	test('Python reads the latest version when none is given', () => {
		const gen = createPinReadCodeGenerator(target);
		assert.deepStrictEqual(gen.generate('Python'), [
			'import pins',
			'board = pins.board_connect(server_url="https://connect.example.com")',
			'board.pin_read("julia/cars")',
		]);
	});

	test('a specific version adds the version argument in each language', () => {
		const gen = createPinReadCodeGenerator({ ...target, version: '41' });
		assert.strictEqual(gen.generate('R').at(-1), 'pin_read(board, "julia/cars", version = "41")');
		assert.strictEqual(gen.generate('Python').at(-1), 'board.pin_read("julia/cars", version="41")');
	});

	test('an unknown syntax falls back to R', () => {
		const gen = createPinReadCodeGenerator(target);
		assert.deepStrictEqual(gen.generate('SQL'), gen.generate('R'));
	});
});
