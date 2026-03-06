/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from './utils.js';
import { ANSIColor } from '../../common/ansiOutput.js';
import { resolveAnsiColor } from '../../common/ansiStyles.js';

suite('resolveAnsiColor', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps standard ANSI colors to CSS variables', () => {
		assert.strictEqual(
			resolveAnsiColor(ANSIColor.Red),
			'var(--vscode-positronConsole-ansiRed)'
		);
		assert.strictEqual(
			resolveAnsiColor(ANSIColor.BrightCyan),
			'var(--vscode-positronConsole-ansiBrightCyan)'
		);
	});

	test('passes through RGB strings as-is', () => {
		assert.strictEqual(resolveAnsiColor('#ff5f00'), '#ff5f00');
		assert.strictEqual(resolveAnsiColor('rgb(255, 0, 0)'), 'rgb(255, 0, 0)');
	});
});
