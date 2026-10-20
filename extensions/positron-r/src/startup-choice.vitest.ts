/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as semver from 'semver';
import { compareRInstallations, RStartupCandidate } from './startup-choice';

interface FakeR extends RStartupCandidate {
	readonly name: string;
}

/** Builds a usable, non-current R. The name is the version, plus the arch when it isn't arm64. */
function r(version: string, overrides: Partial<Omit<FakeR, 'semVersion'>> = {}): FakeR {
	const arch = overrides.arch ?? 'arm64';
	return {
		name: arch === 'arm64' ? version : `${version} ${arch}`,
		usable: true,
		current: false,
		arch,
		...overrides,
		semVersion: new semver.SemVer(version),
	};
}

describe('compareRInstallations', () => {
	function sortedNames(installs: FakeR[]): string[] {
		return [...installs].sort(compareRInstallations).map(inst => inst.name);
	}

	it('lists the current R first, then the highest version', () => {
		const installs = [r('4.3.0'), r('4.5.1'), r('4.4.1', { name: 'current', current: true })];
		expect(sortedNames(installs)).toEqual(['current', '4.5.1', '4.3.0']);
	});

	it('lists arm64 before x86_64 for the same version', () => {
		const installs = [r('4.4.1', { arch: 'x86_64' }), r('4.4.1')];
		expect(sortedNames(installs)).toEqual(['4.4.1', '4.4.1 x86_64']);
	});
});
