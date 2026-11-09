/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { canUninstallSelection, canUpdateSelection, getUpdatablePackages, isPackageUpdatable } from '../../browser/packageSelection.js';

function pkg(name: string, extra: Partial<ILanguageRuntimePackage> = {}): ILanguageRuntimePackage {
	return { id: `${name}-1`, name, displayName: name, version: '1', ...extra };
}

describe('packageSelection', () => {
	describe('isPackageUpdatable', () => {
		it('is true when outdated with a latest version', () => {
			expect(isPackageUpdatable(pkg('a', { outdated: true, latestVersion: '2' }))).toBe(true);
		});

		it('is false when outdated without a latest version', () => {
			expect(isPackageUpdatable(pkg('a', { outdated: true }))).toBe(false);
		});

		it('is false when not outdated', () => {
			expect(isPackageUpdatable(pkg('a', { outdated: false, latestVersion: '2' }))).toBe(false);
		});

		it('is false when outdated is undefined', () => {
			expect(isPackageUpdatable(pkg('a'))).toBe(false);
		});
	});

	describe('getUpdatablePackages', () => {
		const packages = [
			pkg('Alpha', { outdated: true, latestVersion: '2' }),
			pkg('beta'),
			pkg('gamma', { outdated: true, latestVersion: '3' }),
		];

		it('returns only updatable packages in list order', () => {
			const result = getUpdatablePackages(packages, ['gamma', 'beta', 'Alpha']);
			expect(result.map(p => p.name)).toEqual(['Alpha', 'gamma']);
		});

		it('matches names case-insensitively', () => {
			const result = getUpdatablePackages(packages, ['alpha', 'GAMMA']);
			expect(result.map(p => p.name)).toEqual(['Alpha', 'gamma']);
		});

		it('ignores unknown names', () => {
			expect(getUpdatablePackages(packages, ['nope'])).toEqual([]);
		});
	});

	describe('canUpdateSelection', () => {
		it.each([
			[1, false, true],
			[2, false, false],
			[2, true, true],
			[0, true, false],
		])('(%i, %s) -> %s', (count, hasUpdatable, expected) => {
			expect(canUpdateSelection(count, hasUpdatable)).toBe(expected);
		});
	});

	describe('canUninstallSelection', () => {
		it.each([
			[0, false],
			[1, true],
			[3, true],
		])('%i -> %s', (count, expected) => {
			expect(canUninstallSelection(count)).toBe(expected);
		});
	});
});
