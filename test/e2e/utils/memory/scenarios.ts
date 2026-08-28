/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MEMORY_LANES, MemoryLane } from './lanes.js';

/**
 * Which app states a memory run can measure. The dashboard keys one series per
 * scenario, so these strings are a published contract; renaming one splits its
 * history in two.
 *
 * The single source of truth: MemoryScenario is derived from this array so
 * that adding a scenario here and forgetting it everywhere else is a compile
 * error, not a silent gap.
 */
export const MEMORY_SCENARIOS = ['idle', 'session-python', 'session-r', 'data-explorer', 'notebook', 'editors', 'console-output', 'quarto-render'] as const;

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

/**
 * The spec file that measures each lane/scenario pair.
 *
 * Sparse on purpose: only `idle` exists in the server lane. A pair with no spec
 * is not runnable, and asking for one must ignore everything rather than fall
 * through to the desktop spec of the same name.
 */
const SPEC_BY_LANE_SCENARIO: Record<MemoryLane, Partial<Record<MemoryScenario, string>>> = {
	desktop: {
		'idle': '**/performance/memory-idle.test.ts',
		'session-python': '**/performance/memory-session-python.test.ts',
		'session-r': '**/performance/memory-session-r.test.ts',
		'data-explorer': '**/performance/memory-data-explorer.test.ts',
		'notebook': '**/performance/memory-notebook.test.ts',
		'editors': '**/performance/memory-editors.test.ts',
		'console-output': '**/performance/memory-console-output.test.ts',
		'quarto-render': '**/performance/memory-quarto-render.test.ts'
	},
	server: {
		'idle': '**/performance/memory-server-idle.test.ts'
	}
};

/** Every memory spec, in every lane. */
const ALL_MEMORY_SPECS: string[] = MEMORY_LANES
	.flatMap(lane => Object.values(SPEC_BY_LANE_SCENARIO[lane]))
	.filter((spec): spec is string => spec !== undefined);

/**
 * Which memory specs a run must not collect: every one except the running
 * lane/scenario pair's, and all of them when no scenario is set.
 *
 * `lane` is required with no default. A default would let a call site that was
 * never updated produce a lane-filtered list where the old code meant a
 * lane-agnostic one, and the compiler could not catch it.
 */
export function memorySpecsToIgnore(lane: MemoryLane, scenario: string | undefined): string[] {
	const running = isMemoryScenario(scenario) ? SPEC_BY_LANE_SCENARIO[lane][scenario] : undefined;
	return ALL_MEMORY_SPECS.filter(spec => spec !== running);
}
