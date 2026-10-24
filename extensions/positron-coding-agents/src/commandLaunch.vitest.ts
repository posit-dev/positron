/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getCommandLaunch } from './commandLaunch';

vi.mock('node:os', async importOriginal => {
	const actual = await importOriginal<typeof import('node:os')>();
	return { ...actual, platform: vi.fn(actual.platform) };
});

describe('getCommandLaunch', () => {
	let binDirectory: string;

	beforeEach(() => {
		binDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'command-launch-'));
		vi.stubEnv('PATH', binDirectory);
		vi.stubEnv('PATHEXT', '.EXE;.CMD');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.mocked(os.platform).mockReset();
		fs.rmSync(binDirectory, { recursive: true, force: true });
	});

	/** Create an empty file under the bin directory. */
	function touch(...segments: string[]): string {
		const file = path.join(binDirectory, ...segments);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, '');
		return file;
	}

	it('runs a native executable directly', async () => {
		const claude = touch('claude');
		fs.chmodSync(claude, 0o755);
		expect(await getCommandLaunch('claude', '@anthropic-ai/claude-code/cli.js')).toEqual({ command: claude, args: [] });
	});

	it('takes the first executable in PATH order', async () => {
		const otherDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'command-launch-'));
		try {
			vi.stubEnv('PATH', [binDirectory, otherDirectory].join(path.delimiter));
			const first = touch('claude');
			const second = path.join(otherDirectory, 'claude');
			fs.writeFileSync(second, '');
			fs.chmodSync(first, 0o755);
			fs.chmodSync(second, 0o755);
			expect((await getCommandLaunch('claude', '@anthropic-ai/claude-code/cli.js'))?.command).toBe(first);
		} finally {
			fs.rmSync(otherDirectory, { recursive: true, force: true });
		}
	});

	it('is undefined when the file on the PATH can\'t be run', async () => {
		vi.mocked(os.platform).mockReturnValue('linux');
		touch('claude');
		expect(await getCommandLaunch('claude', '@anthropic-ai/claude-code/cli.js')).toBeUndefined();
	});

	it('is undefined when the PATH has a directory with the executable\'s name', async () => {
		fs.mkdirSync(path.join(binDirectory, 'claude'));
		expect(await getCommandLaunch('claude', '@anthropic-ai/claude-code/cli.js')).toBeUndefined();
	});

	it('is undefined when the executable is not on the PATH', async () => {
		expect(await getCommandLaunch('claude', '@anthropic-ai/claude-code/cli.js')).toBeUndefined();
	});

	it('runs the script behind npm\'s Windows launcher under the Node beside it', async () => {
		vi.mocked(os.platform).mockReturnValue('win32');
		touch('claude.cmd');
		const node = touch('node.exe');
		const script = touch('node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
		expect(await getCommandLaunch('claude', '@anthropic-ai/claude-code/cli.js')).toEqual({ command: node, args: [script] });
	});

	it('is undefined for a Windows launcher whose script is not where npm puts it', async () => {
		vi.mocked(os.platform).mockReturnValue('win32');
		touch('claude.cmd');
		touch('node.exe');
		expect(await getCommandLaunch('claude', '@anthropic-ai/claude-code/cli.js')).toBeUndefined();
	});
});
