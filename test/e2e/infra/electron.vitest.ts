/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it } from 'vitest';
import { resolveElectronConfiguration } from './electron';
import type { LaunchOptions } from './code';

describe('resolveElectronConfiguration', () => {
	const original = process.env.FAKE_TEST_API_KEY;

	afterEach(() => {
		if (original === undefined) {
			delete process.env.FAKE_TEST_API_KEY;
		} else {
			process.env.FAKE_TEST_API_KEY = original;
		}
	});

	it('strips secrets and applies extraEnv', async () => {
		process.env.FAKE_TEST_API_KEY = 'fake-value-123456';
		const options = {
			logsPath: '/fake/logs',
			crashesPath: '/fake/crashes',
			extraEnv: { ADDED: '1' },
		} as unknown as LaunchOptions;

		const { env } = await resolveElectronConfiguration(options);

		expect(env?.FAKE_TEST_API_KEY).toBeUndefined();
		expect(env?.ADDED).toBe('1');
		expect(env?.PATH).toBeDefined();
	});
});
