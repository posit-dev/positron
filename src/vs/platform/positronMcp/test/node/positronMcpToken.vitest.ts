/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import { join } from '../../../../base/common/path.js';
import { isAuthorizedBearer, loadOrCreateMcpToken } from '../../node/positronMcpToken.js';

describe('loadOrCreateMcpToken', () => {
	let dir: string;
	let tokenPath: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(join(os.tmpdir(), 'positron-mcp-token-test-'));
		tokenPath = join(dir, 'nested', 'positron-mcp.token');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('generates, persists, and reloads the same token across calls', () => {
		const token = loadOrCreateMcpToken(tokenPath);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(fs.readFileSync(tokenPath, 'utf8').trim()).toBe(token);
		// A second load (a Positron restart) returns the persisted token, so
		// previously written `.mcp.json` files stay valid.
		expect(loadOrCreateMcpToken(tokenPath)).toBe(token);
	});

	it('writes the token file user-private', () => {
		loadOrCreateMcpToken(tokenPath);
		// Windows has no POSIX mode bits; the check only means something elsewhere.
		if (process.platform !== 'win32') {
			expect(fs.statSync(tokenPath).mode & 0o777).toBe(0o600);
		}
	});

	it('accepts a trimmed hand-provisioned token in the valid shape', () => {
		fs.mkdirSync(join(dir, 'nested'));
		fs.writeFileSync(tokenPath, '  my-provisioned_token-0123456789abcdef \n');
		expect(loadOrCreateMcpToken(tokenPath)).toBe('my-provisioned_token-0123456789abcdef');
	});

	it('regenerates over a malformed token file', () => {
		fs.mkdirSync(join(dir, 'nested'));
		fs.writeFileSync(tokenPath, 'too short\n');
		const token = loadOrCreateMcpToken(tokenPath);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(fs.readFileSync(tokenPath, 'utf8').trim()).toBe(token);
	});

	it('returns a usable in-memory token and warns when persistence fails', () => {
		const onWarning = vi.fn();
		// The parent path is a file, so mkdir/write both fail.
		fs.writeFileSync(join(dir, 'nested'), 'a file, not a directory');
		const token = loadOrCreateMcpToken(tokenPath, onWarning);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(onWarning).toHaveBeenCalledOnce();
	});
});

describe('isAuthorizedBearer', () => {
	const token = 'a'.repeat(64);

	it('accepts exactly the expected Bearer header', () => {
		expect(isAuthorizedBearer(`Bearer ${token}`, token)).toBe(true);
	});

	it('rejects a missing, empty, malformed, or wrong-token header', () => {
		expect(isAuthorizedBearer(undefined, token)).toBe(false);
		expect(isAuthorizedBearer('', token)).toBe(false);
		expect(isAuthorizedBearer(token, token)).toBe(false);
		expect(isAuthorizedBearer(`bearer ${token}`, token)).toBe(false);
		expect(isAuthorizedBearer(`Bearer ${'b'.repeat(64)}`, token)).toBe(false);
		expect(isAuthorizedBearer(`Bearer ${token}x`, token)).toBe(false);
	});
});
