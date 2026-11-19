/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describeServerOutput } from './serverOutput';

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
		const description = await describeServerOutput(outFile);
		expect(description).toContain('wrapper script did not start');
		expect(description).toContain('terminal.integrated.env');
	});

	it('reports a read error instead of throwing', async () => {
		// A directory at the output path exists but cannot be read as a file.
		await fs.promises.mkdir(outFile);
		expect(await describeServerOutput(outFile)).toContain('could not read the output file');
	});
});
