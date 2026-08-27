/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Which process tree a memory run measures. Part of the published series key
 * alongside `scenario` and `branch`, so these strings are a contract: renaming
 * one splits its history in two.
 *
 * A server total is not comparable to a desktop total. The renderer and GPU run
 * in the user's browser, outside the server's process tree, so the largest role
 * on desktop is simply absent. The lane exists to make that difference
 * structural rather than something a reader has to remember.
 */
export const MEMORY_LANES = ['desktop', 'server'] as const;

export type MemoryLane = typeof MEMORY_LANES[number];

export function isMemoryLane(value: string | undefined): value is MemoryLane {
	return value !== undefined && MEMORY_LANES.includes(value as MemoryLane);
}

/**
 * The lane a run is measuring, from `MEMORY_LANE`.
 *
 * Unset means `desktop`, so every invocation that predates lanes keeps working
 * untouched. An invalid value throws rather than falling back: a typo that
 * defaulted to desktop would file a server measurement under the desktop key,
 * and nothing downstream could detect it afterwards.
 */
export function laneFromEnv(value: string | undefined): MemoryLane {
	if (value === undefined || value === '') {
		return 'desktop';
	}
	if (!isMemoryLane(value)) {
		throw new Error(`MEMORY_LANE is '${value}'; expected one of: ${MEMORY_LANES.join(', ')}`);
	}
	return value;
}
