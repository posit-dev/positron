/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { isMemoryLane, laneFromEnv, MEMORY_LANES } from './lanes.js';

describe('MEMORY_LANES', () => {
	test('is exactly desktop and server', () => {
		expect(MEMORY_LANES).toEqual(['desktop', 'server']);
	});
});

describe('isMemoryLane', () => {
	test('accepts the known lanes', () => {
		expect(isMemoryLane('desktop')).toBe(true);
		expect(isMemoryLane('server')).toBe(true);
	});

	test('rejects a near miss rather than coercing it', () => {
		// 'serve' reaching the collector as a valid lane would publish a server
		// measurement under the desktop key, which is unrecoverable after the fact.
		expect(isMemoryLane('serve')).toBe(false);
		expect(isMemoryLane('')).toBe(false);
		expect(isMemoryLane(undefined)).toBe(false);
	});
});

describe('laneFromEnv', () => {
	test('defaults to desktop when unset, so every existing invocation is unchanged', () => {
		expect(laneFromEnv(undefined)).toBe('desktop');
		expect(laneFromEnv('')).toBe('desktop');
	});

	test('returns a valid lane unchanged', () => {
		expect(laneFromEnv('server')).toBe('server');
	});

	test('throws on an invalid lane rather than falling back to desktop', () => {
		// Silently defaulting would label a server run desktop. Failing the job is
		// the only outcome that cannot corrupt a series.
		expect(() => laneFromEnv('serve')).toThrow(/serve/);
	});
});
