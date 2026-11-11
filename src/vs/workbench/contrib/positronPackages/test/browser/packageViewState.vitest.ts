/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { derivePackageViewState } from '../../browser/packageViewState.js';

function pkg(overrides: Partial<ILanguageRuntimePackage> = {}): ILanguageRuntimePackage {
	return {
		id: 'dplyr', name: 'dplyr', displayName: 'dplyr', version: '1.1.2',
		url: 'https://dplyr.tidyverse.org', ...overrides,
	};
}

describe('derivePackageViewState', () => {
	it('installed + current + active: uninstall, website, help; actions enabled', () => {
		expect(derivePackageViewState(pkg(), { installed: true, sessionAlive: true, isActive: true }))
			.toMatchInlineSnapshot(`
				{
				  "actions": [
				    "uninstall",
				    "website",
				    "help",
				  ],
				  "actionsEnabled": true,
				  "installState": "current",
				  "latest": false,
				  "showNotActiveHint": false,
				}
			`);
	});

	it('installed + outdated + active: update, uninstall, website, help', () => {
		const state = derivePackageViewState(
			pkg({ outdated: true, latestVersion: '1.1.4' }),
			{ installed: true, sessionAlive: true, isActive: true });
		expect(state.installState).toBe('outdated');
		expect(state.actions).toEqual(['update', 'uninstall', 'website', 'help']);
		expect(state.actionsEnabled).toBe(true);
	});

	it('not installed + active: install, website, help', () => {
		const state = derivePackageViewState(pkg(), { installed: false, sessionAlive: true, isActive: true });
		expect(state.installState).toBe('not-installed');
		expect(state.actions).toEqual(['install', 'website', 'help']);
	});

	it('omits website when the package has no url', () => {
		const state = derivePackageViewState(pkg({ url: undefined }), { installed: true, sessionAlive: true, isActive: true });
		expect(state.actions).toEqual(['uninstall', 'help']);
	});

	it('not active: actions disabled, hint shown, actions still listed', () => {
		const state = derivePackageViewState(pkg(), { installed: true, sessionAlive: true, isActive: false });
		expect(state.actionsEnabled).toBe(false);
		expect(state.showNotActiveHint).toBe(true);
		expect(state.actions).toEqual(['uninstall', 'website', 'help']);
	});

	it('session ended: session-ended state, only website (if url), disabled, no hint', () => {
		const state = derivePackageViewState(pkg(), { installed: false, sessionAlive: false, isActive: false });
		expect(state.installState).toBe('session-ended');
		expect(state.actions).toEqual(['website']);
		expect(state.actionsEnabled).toBe(false);
		expect(state.showNotActiveHint).toBe(false);
	});

	it('installed + reported current: latest', () => {
		const state = derivePackageViewState(pkg({ outdated: false }), { installed: true, sessionAlive: true, isActive: true });
		expect(state.latest).toBe(true);
	});

	it('bundled only: no update or uninstall, never latest', () => {
		const state = derivePackageViewState(
			pkg({ bundled: true, outdated: false, latestVersion: '1.1.2' }),
			{ installed: true, sessionAlive: true, isActive: true });
		expect({ installState: state.installState, actions: state.actions, latest: state.latest }).toEqual({
			installState: 'current',
			actions: ['website', 'help'],
			latest: false,
		});
	});

	it('bundled only + outdated: still no update action', () => {
		const state = derivePackageViewState(
			pkg({ bundled: true, outdated: true, latestVersion: '1.2.0' }),
			{ installed: true, sessionAlive: true, isActive: true });
		expect(state.actions).toEqual(['website', 'help']);
	});

	it('bundled + in env + outdated: outdated, with update and uninstall for the env copy', () => {
		const state = derivePackageViewState(
			pkg({ bundled: true, environmentVersion: '1.0.0', outdated: true, latestVersion: '1.1.4' }),
			{ installed: true, sessionAlive: true, isActive: true });
		expect({ installState: state.installState, actions: state.actions, latest: state.latest }).toEqual({
			installState: 'outdated',
			actions: ['update', 'uninstall', 'website', 'help'],
			latest: false,
		});
	});

	it('bundled + in env + current: uninstall, and the env copy is latest', () => {
		const state = derivePackageViewState(
			pkg({ bundled: true, environmentVersion: '1.1.2', outdated: false }),
			{ installed: true, sessionAlive: true, isActive: true });
		expect({ actions: state.actions, latest: state.latest }).toEqual({
			actions: ['uninstall', 'website', 'help'],
			latest: true,
		});
	});

	it('session ended with no last-known package: no actions', () => {
		const state = derivePackageViewState(undefined, { installed: false, sessionAlive: false, isActive: false });
		expect(state.actions).toEqual([]);
	});
});
