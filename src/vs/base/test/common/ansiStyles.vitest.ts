/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ensureNoLeakedDisposables } from '../../../test/vitest/vitestUtils.js';
import { ANSIColor } from '../../common/ansiOutput.js';
import { resolveAnsiColor } from '../../common/ansiStyles.js';

describe('resolveAnsiColor', () => {
	ensureNoLeakedDisposables();

	it('maps standard ANSI colors to CSS variables', () => {
		expect(resolveAnsiColor(ANSIColor.Red)).toBe('var(--vscode-positronConsole-ansiRed)');
		expect(resolveAnsiColor(ANSIColor.BrightCyan)).toBe('var(--vscode-positronConsole-ansiBrightCyan)');
	});

	it('passes through RGB strings as-is', () => {
		expect(resolveAnsiColor('#ff5f00')).toBe('#ff5f00');
		expect(resolveAnsiColor('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
	});
});
