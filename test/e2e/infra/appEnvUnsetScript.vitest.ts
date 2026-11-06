/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('app-env-unset script', () => {
	const script = resolve(__dirname, '../scripts/app-env-unset.ts');
	const value = 'fake-value-123456';

	function names(args: string[]): string[] {
		const result = spawnSync('npx', ['tsx', script, ...args], {
			env: { ...process.env, FAKE_SCAN_TEST_KEY: value, FAKE_KEPT_KEY: value },
			encoding: 'utf8',
		});
		expect(result.status).toBe(0);
		return result.stdout.split('\n');
	}

	it('leaves out a --keep name but still lists the others', () => {
		const out = names(['--keep', 'FAKE_KEPT_KEY']);
		expect(out).not.toContain('FAKE_KEPT_KEY');
		expect(out).toContain('FAKE_SCAN_TEST_KEY');
	});

	it('prints secret names and never their values', () => {
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
