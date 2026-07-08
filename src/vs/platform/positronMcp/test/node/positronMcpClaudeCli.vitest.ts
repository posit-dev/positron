/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { buildAddArgs, buildRemoveArgs, copyIfChanged, quoteWinArg } from '../../node/positronMcpClaudeCli.js';

describe('quoteWinArg', () => {
	it('passes plain arguments through and quotes ones cmd.exe would mangle', () => {
		expect(quoteWinArg('positron')).toBe('positron');
		expect(quoteWinArg('C:\\path\\proxy.mjs')).toBe('C:\\path\\proxy.mjs');
		expect(quoteWinArg('C:\\Program Files\\proxy.mjs')).toBe('"C:\\Program Files\\proxy.mjs"');
		expect(quoteWinArg('a&b')).toBe('"a&b"');
	});

	it('escapes embedded quotes and doubles trailing backslashes inside quotes', () => {
		expect(quoteWinArg('say "hi"')).toBe('"say \\"hi\\""');
		expect(quoteWinArg('C:\\trailing space\\')).toBe('"C:\\trailing space\\\\"');
	});

	it('refuses % (cmd.exe variable expansion is unsafe inside quotes)', () => {
		expect(() => quoteWinArg('100%done')).toThrow(/%/);
	});
});

describe('claude mcp argument construction', () => {
	it('registers the proxy at user scope through Positron running as node', () => {
		expect(buildAddArgs('/Applications/Positron.app/Contents/MacOS/Electron', '/data/positron-mcp-proxy.mjs')).toEqual([
			'mcp', 'add', 'positron', '--scope', 'user',
			'--env', 'ELECTRON_RUN_AS_NODE=1',
			'--', '/Applications/Positron.app/Contents/MacOS/Electron', '/data/positron-mcp-proxy.mjs',
		]);
		expect(buildRemoveArgs()).toEqual(['mcp', 'remove', 'positron', '--scope', 'user']);
	});
});

describe('copyIfChanged', () => {
	let dir: string;
	beforeEach(async () => {
		dir = await fs.mkdtemp(join(tmpdir(), 'pmcp-cli-test-'));
	});
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it('writes a missing file, skips an identical one, rewrites a changed one', async () => {
		const target = join(dir, 'proxy.mjs');
		expect(await copyIfChanged('v1', target)).toBe(true);
		expect(await fs.readFile(target, 'utf8')).toBe('v1');
		expect(await copyIfChanged('v1', target)).toBe(false);
		expect(await copyIfChanged('v2', target)).toBe(true);
		expect(await fs.readFile(target, 'utf8')).toBe('v2');
	});

	it('leaves no temp sibling behind', async () => {
		const target = join(dir, 'proxy.mjs');
		await copyIfChanged('content', target);
		expect(await fs.readdir(dir)).toEqual(['proxy.mjs']);
	});
});
