/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isColorThemeVisibleInPicker } from '../../browser/positronColorThemeFilter.js';

const upstreamVisualStudioLight = 'vs vscode-theme-defaults-themes-light_vs-json';
const positron2026Dark = 'vs-dark vscode-theme-defaults-themes-2026-dark-json';
const positronDark = 'vs-dark vscode-theme-defaults-themes-positron_dark-json';
const userInstalled = 'vs-dark some-publisher.cool-theme-themes-cool-json';

describe('isColorThemeVisibleInPicker', () => {
	it('hides legacy upstream entries Positron suppresses', () => {
		expect(isColorThemeVisibleInPicker(upstreamVisualStudioLight, positronDark)).toBe(false);
	});

	it('keeps the 2026 themes', () => {
		expect(isColorThemeVisibleInPicker(positron2026Dark, positronDark)).toBe(true);
	});

	it('keeps unknown user-installed themes by default', () => {
		expect(isColorThemeVisibleInPicker(userInstalled, positronDark)).toBe(true);
	});

	it('always keeps the user\'s current theme, even when blacklisted', () => {
		// Protects users who selected an upstream theme before our filter shipped.
		expect(isColorThemeVisibleInPicker(upstreamVisualStudioLight, upstreamVisualStudioLight)).toBe(true);
	});
});
