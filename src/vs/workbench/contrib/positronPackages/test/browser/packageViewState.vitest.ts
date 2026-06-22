/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { derivePackageViewState } from '../../browser/packageViewState.js';

function pkg(overrides: Partial<ILanguageRuntimePackage> = {}): ILanguageRuntimePackage {
	return {
		id: 'dplyr', name: 'dplyr', displayName: 'dplyr', version: '1.1.2',
		url: 'https://dplyr.tidyverse.org', ...overrides,
	};
}

describe('derivePackageViewState', () => {
	it('installed + current + active: uninstall, help, website; actions enabled', () => {
		expect(derivePackageViewState(pkg(), { installed: true, sessionAlive: true, isActive: true }))
			.toMatchInlineSnapshot(`
				{
				  "actions": [
				    "uninstall",
				    "help",
				    "website",
				  ],
				  "actionsEnabled": true,
				  "installState": "current",
				  "showNotActiveHint": false,
				}
			`);
	});

	it('installed + outdated + active: update, uninstall, help, website', () => {
		const state = derivePackageViewState(
			pkg({ outdated: true, latestVersion: '1.1.4' }),
			{ installed: true, sessionAlive: true, isActive: true });
		expect(state.installState).toBe('outdated');
		expect(state.actions).toEqual(['update', 'uninstall', 'help', 'website']);
		expect(state.actionsEnabled).toBe(true);
	});

	it('not installed + active: install, help, website', () => {
		const state = derivePackageViewState(pkg(), { installed: false, sessionAlive: true, isActive: true });
		expect(state.installState).toBe('not-installed');
		expect(state.actions).toEqual(['install', 'help', 'website']);
	});

	it('omits website when the package has no url', () => {
		const state = derivePackageViewState(pkg({ url: undefined }), { installed: true, sessionAlive: true, isActive: true });
		expect(state.actions).toEqual(['uninstall', 'help']);
	});

	it('not active: actions disabled, hint shown, actions still listed', () => {
		const state = derivePackageViewState(pkg(), { installed: true, sessionAlive: true, isActive: false });
		expect(state.actionsEnabled).toBe(false);
		expect(state.showNotActiveHint).toBe(true);
		expect(state.actions).toEqual(['uninstall', 'help', 'website']);
	});

	it('session ended: session-ended state, only website (if url), disabled, no hint', () => {
		const state = derivePackageViewState(pkg(), { installed: false, sessionAlive: false, isActive: false });
		expect(state.installState).toBe('session-ended');
		expect(state.actions).toEqual(['website']);
		expect(state.actionsEnabled).toBe(false);
		expect(state.showNotActiveHint).toBe(false);
	});

	it('session ended with no last-known package: no actions', () => {
		const state = derivePackageViewState(undefined, { installed: false, sessionAlive: false, isActive: false });
		expect(state.actions).toEqual([]);
	});
});
