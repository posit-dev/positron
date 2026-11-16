/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { canUninstallSelection, canUpdateSelection, copyPackagesLabel, getUninstallablePackages, getUpdatablePackages, isPackageUninstallable, isPackageUpdatable } from '../../browser/packageSelection.js';

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

		it('is false for a package only Positron bundles, even if it looks outdated', () => {
			expect(isPackageUpdatable(pkg('a', { outdated: true, latestVersion: '2', bundled: true }))).toBe(false);
		});

		it('is true for a bundled package the environment also has', () => {
			expect(isPackageUpdatable(pkg('a', { outdated: true, latestVersion: '2', bundled: true, environmentVersion: '1' }))).toBe(true);
		});
	});

	describe('isPackageUninstallable', () => {
		it('is true for an ordinary package', () => {
			expect(isPackageUninstallable(pkg('a'))).toBe(true);
		});

		it('is false for a package only Positron bundles', () => {
			expect(isPackageUninstallable(pkg('a', { bundled: true }))).toBe(false);
		});

		it('is true for a bundled package the environment also has', () => {
			expect(isPackageUninstallable(pkg('a', { bundled: true, environmentVersion: '1' }))).toBe(true);
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

	describe('getUninstallablePackages', () => {
		const packages = [pkg('Alpha'), pkg('beta', { bundled: true }), pkg('gamma')];

		it('leaves out packages only Positron bundles, in list order', () => {
			const result = getUninstallablePackages(packages, ['gamma', 'beta', 'alpha']);
			expect(result.map(p => p.name)).toEqual(['Alpha', 'gamma']);
		});
	});

	describe('canUpdateSelection', () => {
		const outdated = pkg('a', { outdated: true, latestVersion: '2' });
		const current = pkg('b');
		const bundledOnly = pkg('c', { bundled: true });

		it('is false for an empty selection', () => {
			expect(canUpdateSelection([])).toBe(false);
		});

		it('is true for one package even when it is not outdated, since Update opens a version picker', () => {
			expect(canUpdateSelection([current])).toBe(true);
		});

		it('is false for one package only Positron bundles', () => {
			expect(canUpdateSelection([bundledOnly])).toBe(false);
		});

		it('is true for several packages when at least one is updatable', () => {
			expect(canUpdateSelection([current, outdated])).toBe(true);
		});

		it('is false for several packages when none is updatable', () => {
			expect(canUpdateSelection([current, bundledOnly])).toBe(false);
		});
	});

	describe('canUninstallSelection', () => {
		const ordinary = pkg('a');
		const bundledOnly = pkg('b', { bundled: true });

		it('is false for an empty selection', () => {
			expect(canUninstallSelection([])).toBe(false);
		});

		it('is true for one ordinary package', () => {
			expect(canUninstallSelection([ordinary])).toBe(true);
		});

		it('is false for one package only Positron bundles', () => {
			expect(canUninstallSelection([bundledOnly])).toBe(false);
		});

		it('is true for several packages when at least one can be uninstalled', () => {
			expect(canUninstallSelection([bundledOnly, ordinary])).toBe(true);
		});

		it('is false for several packages that are all only bundled', () => {
			expect(canUninstallSelection([bundledOnly, pkg('c', { bundled: true })])).toBe(false);
		});
	});
});

describe('multi-selection menu label', () => {
	it('names the number of packages to copy', () => {
		expect(copyPackagesLabel(3)).toBe('Copy 3 Packages');
	});
});
