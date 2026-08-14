/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { isMemoryScenario, memorySpecsToIgnore, MEMORY_SCENARIOS } from './scenarios.js';

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

describe('memorySpecsToIgnore', () => {
	test('ignores every memory spec in an ordinary lane', () => {
		expect(memorySpecsToIgnore(undefined)).toEqual([
			'**/performance/memory-idle.test.ts',
			'**/performance/memory-session-python.test.ts',
			'**/performance/memory-session-r.test.ts',
			'**/performance/memory-data-explorer.test.ts',
			'**/performance/memory-notebook.test.ts',
			'**/performance/memory-editors.test.ts',
			'**/performance/memory-console-output.test.ts'
		]);
	});

	test('keeps only the running scenario, so one job measures one state', () => {
		expect(memorySpecsToIgnore('session-r')).toEqual([
			'**/performance/memory-idle.test.ts',
			'**/performance/memory-session-python.test.ts',
			'**/performance/memory-data-explorer.test.ts',
			'**/performance/memory-notebook.test.ts',
			'**/performance/memory-editors.test.ts',
			'**/performance/memory-console-output.test.ts'
		]);
	});

	test('ignores everything when the scenario is a typo, rather than running the wrong spec', () => {
		expect(memorySpecsToIgnore('session_r')).toHaveLength(MEMORY_SCENARIOS.length);
	});
});
