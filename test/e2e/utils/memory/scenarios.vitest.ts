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
		expect(memorySpecsToIgnore('desktop', undefined)).toEqual([
			'**/performance/memory-idle.test.ts',
			'**/performance/memory-session-python.test.ts',
			'**/performance/memory-session-r.test.ts',
			'**/performance/memory-data-explorer.test.ts',
			'**/performance/memory-notebook.test.ts',
			'**/performance/memory-editors.test.ts',
			'**/performance/memory-console-output.test.ts',
			'**/performance/memory-server-idle.test.ts'
		]);
	});

	test('keeps only the running scenario, so one job measures one state', () => {
		expect(memorySpecsToIgnore('desktop', 'session-r')).toEqual([
			'**/performance/memory-idle.test.ts',
			'**/performance/memory-session-python.test.ts',
			'**/performance/memory-data-explorer.test.ts',
			'**/performance/memory-notebook.test.ts',
			'**/performance/memory-editors.test.ts',
			'**/performance/memory-console-output.test.ts',
			'**/performance/memory-server-idle.test.ts'
		]);
	});

	test('ignores everything when the scenario is a typo, rather than running the wrong spec', () => {
		expect(memorySpecsToIgnore('desktop', 'session_r')).toHaveLength(MEMORY_SCENARIOS.length + 1);
	});
});

describe('memorySpecsToIgnore with lanes', () => {
	test('ignores every memory spec when no scenario is set', () => {
		const ignored = memorySpecsToIgnore('desktop', undefined);
		// 7 desktop specs + 1 server spec: an ordinary e2e lane must run none.
		expect(ignored).toHaveLength(8);
	});

	test('keeps only the running desktop scenario', () => {
		const ignored = memorySpecsToIgnore('desktop', 'idle');
		expect(ignored).not.toContain('**/performance/memory-idle.test.ts');
		expect(ignored).toContain('**/performance/memory-server-idle.test.ts');
	});

	test('keeps only the running server scenario', () => {
		const ignored = memorySpecsToIgnore('server', 'idle');
		expect(ignored).toContain('**/performance/memory-idle.test.ts');
		expect(ignored).not.toContain('**/performance/memory-server-idle.test.ts');
	});

	test('a scenario with no spec in the requested lane ignores everything', () => {
		// Only idle exists in the server lane. Asking for server/notebook must not
		// silently fall through to the desktop notebook spec.
		const ignored = memorySpecsToIgnore('server', 'notebook');
		expect(ignored).toHaveLength(8);
	});
});
