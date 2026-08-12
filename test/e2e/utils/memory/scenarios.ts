/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Which app state a memory run measured. The dashboard keys one series per
 * scenario, so these strings are a published contract; renaming one splits its
 * history in two.
 */
export type MemoryScenario = 'idle' | 'session-python' | 'session-r';

export const MEMORY_SCENARIOS: readonly MemoryScenario[] = ['idle', 'session-python', 'session-r'];

/**
 * Whether MEMORY_SCENARIO names a real scenario. Unset means an ordinary e2e
 * lane, where none of the memory machinery should engage. A typo returns false
 * rather than throwing, and the spec's own quality gate fails the run instead:
 * config loading is the wrong place to die.
 */
export function isMemoryScenario(value: string | undefined): value is MemoryScenario {
	return value !== undefined && (MEMORY_SCENARIOS as readonly string[]).includes(value);
}

/** The spec file that measures each scenario. */
const SPEC_BY_SCENARIO: Record<MemoryScenario, string> = {
	'idle': '**/performance/memory-idle.test.ts',
	'session-python': '**/performance/memory-session-python.test.ts',
	'session-r': '**/performance/memory-session-r.test.ts'
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
