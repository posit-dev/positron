/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { watchForFileCreation } from './connectionsFileArrival';

// Short enough to keep the tests fast, long enough that fs.watchFile polls reliably.
const INTERVAL_MS = 20;

/** Waits long enough for several polls to run. */
function waitForPolls(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, INTERVAL_MS * 10));
}

describe('watchForFileCreation', () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'connections-file-arrival-'));
	});

	afterEach(async () => {
		await fs.promises.rm(root, { recursive: true, force: true });
	});

	it('calls back once when the file and its directory are created after the watch starts', async () => {
		// The Workbench case: $SNOWFLAKE_HOME and connections.toml appear together, after activation.
		const home = path.join(root, 'snowflake-home');
		const filePath = path.join(home, 'connections.toml');
		const onCreated = vi.fn();
		const watch = watchForFileCreation(filePath, onCreated, INTERVAL_MS);

		// fs.watchFile reports the missing file at its first poll; that is not a creation.
		await waitForPolls();
		expect(onCreated).not.toHaveBeenCalled();

		await fs.promises.mkdir(home);
		await fs.promises.writeFile(filePath, '[workbench]\n');
		await vi.waitFor(() => expect(onCreated).toHaveBeenCalled(), { timeout: 5000 });
		await fs.promises.writeFile(filePath, '[workbench]\naccount = "a"\n');
		await waitForPolls();

		expect(onCreated).toHaveBeenCalledTimes(1);
		watch.dispose();
	});

	it('calls back when the file already exists as the watch starts', () => {
		// Covers a file created between the caller's own read and the start of polling, which
		// fs.watchFile alone would take as its starting state and never report.
		const filePath = path.join(root, 'connections.toml');
		fs.writeFileSync(filePath, '[workbench]\n');
		const onCreated = vi.fn();

		const watch = watchForFileCreation(filePath, onCreated, INTERVAL_MS);

		expect(onCreated).toHaveBeenCalledTimes(1);
		watch.dispose();
	});

	it('does not call back after it is disposed', async () => {
		const filePath = path.join(root, 'connections.toml');
		const onCreated = vi.fn();
		const watch = watchForFileCreation(filePath, onCreated, INTERVAL_MS);

		watch.dispose();
		await fs.promises.writeFile(filePath, '[workbench]\n');
		await waitForPolls();

		expect(onCreated).not.toHaveBeenCalled();
	});
});
