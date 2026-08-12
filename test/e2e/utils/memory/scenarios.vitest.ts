/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { isMemoryScenario, MEMORY_SCENARIOS } from './scenarios.js';

describe('isMemoryScenario', () => {
	test('accepts every scenario in the vocabulary', () => {
		for (const scenario of MEMORY_SCENARIOS) {
			expect(isMemoryScenario(scenario)).toBe(true);
		}
	});

	test('rejects an unset MEMORY_SCENARIO, which is the ordinary e2e lanes', () => {
		expect(isMemoryScenario(undefined)).toBe(false);
	});

	test('rejects a typo rather than silently measuring nothing', () => {
		expect(isMemoryScenario('session_python')).toBe(false);
	});
});
