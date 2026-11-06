/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('app-env-unset script', () => {
	it('prints secret names and never their values', () => {
		const value = 'fake-value-123456';
		const script = resolve(__dirname, '../scripts/app-env-unset.ts');
		const result = spawnSync('npx', ['tsx', script], {
			env: { ...process.env, FAKE_SCAN_TEST_KEY: value },
			encoding: 'utf8',
		});
		expect(result.status).toBe(0);
		expect(result.stdout.split('\n')).toContain('FAKE_SCAN_TEST_KEY');
		expect(result.stdout).not.toContain(value);
		expect(result.stderr).not.toContain(value);
	});
});
