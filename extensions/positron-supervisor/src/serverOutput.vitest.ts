/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describeServerOutput, findTerminalPathOverride } from './serverOutput';

describe('describeServerOutput', () => {
	let root: string;
	let outFile: string;

	beforeEach(async () => {
		root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'server-output-'));
		outFile = path.join(root, 'kallichore.out.log');
	});

	afterEach(async () => {
		await fs.promises.rm(root, { recursive: true, force: true });
	});

	it('includes the captured output', async () => {
		await fs.promises.writeFile(outFile, '/bin/bash -l -c kcserver\nkcserver: bad flag\n');
		expect(await describeServerOutput(outFile))
			.toBe('; output:\n\n/bin/bash -l -c kcserver\nkcserver: bad flag\n');
	});

	it('adds nothing when the output file is empty', async () => {
		await fs.promises.writeFile(outFile, '');
		expect(await describeServerOutput(outFile)).toBe('');
	});

	it('points at PATH when the wrapper never created the output file', async () => {
		expect(await describeServerOutput(outFile)).toBe(
			'; the supervisor wrapper script did not start, so it captured no output. ' +
			'Make sure that the PATH for terminals is correct.');
	});

	it('names the setting and its value when a terminal setting sets PATH', async () => {
		const pathOverride = { setting: 'terminal.integrated.env.osx', value: '' };
		expect(await describeServerOutput(outFile, pathOverride)).toBe(
			'; the supervisor wrapper script did not start, so it captured no output. ' +
			'The setting terminal.integrated.env.osx sets PATH to "" in the terminal environment. ' +
			'Make sure that this PATH is correct.');
	});

	it('says that a null value removes PATH', async () => {
		const pathOverride = { setting: 'terminal.integrated.env.linux', value: null };
		expect(await describeServerOutput(outFile, pathOverride)).toBe(
			'; the supervisor wrapper script did not start, so it captured no output. ' +
			'The setting terminal.integrated.env.linux removes PATH from the terminal environment. ' +
			'Make sure that this PATH is correct.');
	});

	it('ignores the PATH override when the wrapper captured output', async () => {
		await fs.promises.writeFile(outFile, 'kcserver: bad flag\n');
		const pathOverride = { setting: 'terminal.integrated.env.osx', value: '' };
		expect(await describeServerOutput(outFile, pathOverride)).toBe('; output:\n\nkcserver: bad flag\n');
	});

	it('reports a read error instead of throwing', async () => {
		// A directory at the output path exists but cannot be read as a file.
		await fs.promises.mkdir(outFile);
		expect(await describeServerOutput(outFile)).toMatch(/^; could not read the output file .*EISDIR/);
	});
});

describe('findTerminalPathOverride', () => {
	it('finds PATH in the setting for the platform', () => {
		expect(findTerminalPathOverride('darwin', { PATH: '/opt/bin', FOO: 'bar' }))
			.toEqual({ setting: 'terminal.integrated.env.osx', value: '/opt/bin' });
	});

	it('returns undefined when the setting is unset or does not set PATH', () => {
		expect(findTerminalPathOverride('linux', undefined)).toBeUndefined();
		expect(findTerminalPathOverride('linux', { FOO: 'bar' })).toBeUndefined();
	});

	it('matches PATH case-sensitively except on Windows', () => {
		expect(findTerminalPathOverride('linux', { Path: '/opt/bin' })).toBeUndefined();
		expect(findTerminalPathOverride('win32', { Path: null }))
			.toEqual({ setting: 'terminal.integrated.env.windows', value: null });
	});
});
