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

	function run(args: string[]): { stdout: string; stderr: string } {
		const result = spawnSync('npx', ['tsx', script, ...args], {
			env: { ...process.env, FAKE_SCAN_TEST_KEY: value, FAKE_KEPT_KEY: value },
			encoding: 'utf8',
		});
		expect(result.status).toBe(0);
		return { stdout: result.stdout, stderr: result.stderr };
	}

	it('leaves out a --keep name but still lists the others', () => {
		const out = run(['--keep', 'FAKE_KEPT_KEY']).stdout.split('\n');
		expect(out).not.toContain('FAKE_KEPT_KEY');
		expect(out).toContain('FAKE_SCAN_TEST_KEY');
	});

	it('prints secret names and never their values', () => {
		const { stdout, stderr } = run([]);
		expect(stdout.split('\n')).toContain('FAKE_SCAN_TEST_KEY');
		expect(stdout).not.toContain(value);
		expect(stderr).not.toContain(value);
	});
});
