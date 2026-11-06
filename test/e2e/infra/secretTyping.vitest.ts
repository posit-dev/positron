/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { findSecretTypingCalls, isScannedSecretName } from './secretTyping';

const E2E_ROOT = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : sourceFiles(full);
		}
		return /\.tsx?$/.test(entry.name) && !/\.vitest\.tsx?$/.test(entry.name) ? [full] : [];
	});
}

describe('findSecretTypingCalls', () => {
	it('flags a secret env var passed straight to fill', () => {
		expect(findSecretTypingCalls(`await page.fill('#pw', process.env.WB_PASSWORD!);`)).toEqual(['1: process.env.WB_PASSWORD']);
	});

	it('flags a variable bound from a secret env var', () => {
		const src = [
			`const password = process.env.SNOWFLAKE_PASSWORD || 'x';`,
			`await field.pressSequentially(password, { delay: 30 });`,
			`await form.fillConnectionInputs({ 'Password': password });`,
		].join('\n');
		expect(findSecretTypingCalls(src)).toEqual(['2: password', '3: password']);
	});

	it('flags a default parameter bound from a secret env var', () => {
		const src = `async signIn(user = 'u', password = process.env.POSIT_WORKBENCH_PASSWORD || '') {\n\tawait this.password.fill(password);\n}`;
		expect(findSecretTypingCalls(src)).toEqual(['2: password']);
	});

	it('ignores non-secret env vars, property names and the secret-safe helper', () => {
		const src = [
			`const user = process.env.E2E_POSTGRES_USER || 'u';`,
			`const password = process.env.E2E_POSTGRES_PASSWORD || 'p';`,
			`await field.fill(user);`,
			`await this.password.fill('');`,
			`await fillSecretValue(field, password);`,
			`await page.keyboard.type(process.env.HOME!);`,
		].join('\n');
		expect(findSecretTypingCalls(src)).toEqual([]);
	});

	it('uses the scan\'s notion of a secret name', () => {
		expect(isScannedSecretName('IDE_SERVICE_ACCOUNT_PASSWORD')).toBe(true);
		expect(isScannedSecretName('SNOWFLAKE_ACCOUNT')).toBe(false);
	});
});

describe('e2e sources', () => {
	it('never fill or type a secret env var (the value would land in a step title)', () => {
		const hits = sourceFiles(E2E_ROOT).flatMap(file =>
			findSecretTypingCalls(fs.readFileSync(file, 'utf8')).map(hit => `${path.relative(E2E_ROOT, file)}:${hit}`)
		);
		expect(hits, 'use fillSecretValue (test/e2e/utils/secretInput.ts) instead').toEqual([]);
	});
});
