/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Which app states a memory run can measure. The dashboard keys one series per
 * scenario, so these strings are a published contract; renaming one splits its
 * history in two.
 *
 * The single source of truth: MemoryScenario is derived from this array so
 * that adding a scenario here and forgetting it everywhere else is a compile
 * error, not a silent gap.
 */
export const MEMORY_SCENARIOS = ['idle', 'session-python', 'session-r', 'data-explorer', 'notebook', 'editors', 'console-output'] as const;

export type MemoryScenario = typeof MEMORY_SCENARIOS[number];

/**
 * Whether MEMORY_SCENARIO names a real scenario. Unset means an ordinary e2e
 * lane, where none of the memory machinery should engage. A typo returns false
 * rather than throwing, and the spec's own quality gate fails the run instead:
 * config loading is the wrong place to die.
 */
export function isMemoryScenario(value: string | undefined): value is MemoryScenario {
	return value !== undefined && MEMORY_SCENARIOS.includes(value as MemoryScenario);
}

/** The spec file that measures each scenario. */
const SPEC_BY_SCENARIO: Record<MemoryScenario, string> = {
	'idle': '**/performance/memory-idle.test.ts',
	'session-python': '**/performance/memory-session-python.test.ts',
	'session-r': '**/performance/memory-session-r.test.ts',
	'data-explorer': '**/performance/memory-data-explorer.test.ts',
	'notebook': '**/performance/memory-notebook.test.ts',
	'editors': '**/performance/memory-editors.test.ts',
	'console-output': '**/performance/memory-console-output.test.ts'
};

/**
 * Which memory specs a run must not collect. Every one of them except the
 * running scenario's, and all of them when no scenario is set.
 *
 * Ignored rather than skipped in-test because merge-to-main runs this lane
 * ungrepped, so a skip would report a permanently skipped row.
 */
export function memorySpecsToIgnore(scenario: string | undefined): string[] {
	return MEMORY_SCENARIOS
		.filter(candidate => candidate !== scenario)
		.map(candidate => SPEC_BY_SCENARIO[candidate]);
}
