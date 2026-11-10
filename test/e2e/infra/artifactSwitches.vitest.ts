/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { ArtifactSwitch, isArtifactEnabled } from './artifactSwitches.js';

const ALL: ArtifactSwitch[] = ['E2E_TRACES', 'E2E_ATTACH_LOGS', 'E2E_ATTACH_CRASH_DUMPS'];

describe('isArtifactEnabled', () => {
	it('on and off win', () => {
		expect(isArtifactEnabled('E2E_TRACES', { CI: 'true', E2E_TRACES: 'on' })).toBe(true);
		expect(isArtifactEnabled('E2E_TRACES', { E2E_TRACES: 'off' })).toBe(false);
	});

	it('default off in CI', () => {
		for (const name of ALL) {
			expect(isArtifactEnabled(name, { CI: 'true' })).toBe(false);
		}
	});

	it('default on locally', () => {
		for (const name of ALL) {
			expect(isArtifactEnabled(name, {})).toBe(true);
			expect(isArtifactEnabled(name, { CI: '' })).toBe(true);
		}
	});

	it('unknown value falls back to default', () => {
		expect(isArtifactEnabled('E2E_TRACES', { CI: 'true', E2E_TRACES: 'yes' })).toBe(false);
		expect(isArtifactEnabled('E2E_TRACES', { E2E_TRACES: 'ON' })).toBe(true);
	});
});
