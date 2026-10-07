/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getAgentLaunch } from './agentLaunch';

vi.mock('node:os', async importOriginal => {
	const actual = await importOriginal<typeof import('node:os')>();
	return { ...actual, platform: vi.fn(actual.platform) };
});

describe('getAgentLaunch', () => {
	let binDirectory: string;

	beforeEach(() => {
		binDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-launch-'));
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
		const codex = touch('codex');
		expect(await getAgentLaunch('codex', '@openai/codex/bin/codex.js')).toEqual({ command: codex, args: [] });
	});

	it('is undefined when the executable is not on the PATH', async () => {
		expect(await getAgentLaunch('codex', '@openai/codex/bin/codex.js')).toBeUndefined();
	});

	it('runs the script behind npm\'s Windows launcher under the Node beside it', async () => {
		vi.mocked(os.platform).mockReturnValue('win32');
		touch('codex.cmd');
		const node = touch('node.exe');
		const script = touch('node_modules', '@openai', 'codex', 'bin', 'codex.js');
		expect(await getAgentLaunch('codex', '@openai/codex/bin/codex.js')).toEqual({ command: node, args: [script] });
	});

	it('is undefined for a Windows launcher whose script is not where npm puts it', async () => {
		vi.mocked(os.platform).mockReturnValue('win32');
		touch('codex.cmd');
		touch('node.exe');
		expect(await getAgentLaunch('codex', '@openai/codex/bin/codex.js')).toBeUndefined();
	});
});
