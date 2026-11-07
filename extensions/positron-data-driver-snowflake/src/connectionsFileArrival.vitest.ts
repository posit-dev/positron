/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { watchForFileCreation } from './connectionsFileArrival';

const INTERVAL_MS = 1000;

describe('watchForFileCreation', () => {
	let root: string;

	beforeEach(() => {
		vi.useFakeTimers();
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'connections-file-arrival-'));
	});

	afterEach(() => {
		vi.useRealTimers();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('calls back once when the file and its directory are created after the watch starts', () => {
		// The Workbench case: $SNOWFLAKE_HOME and connections.toml appear together, after activation.
		const home = path.join(root, 'snowflake-home');
		const filePath = path.join(home, 'connections.toml');
		const onCreated = vi.fn();
		const watch = watchForFileCreation(filePath, onCreated, INTERVAL_MS);

		vi.advanceTimersByTime(INTERVAL_MS * 3);
		expect(onCreated).not.toHaveBeenCalled();

		fs.mkdirSync(home);
		fs.writeFileSync(filePath, '[workbench]\n');
		vi.advanceTimersByTime(INTERVAL_MS);
		fs.writeFileSync(filePath, '[workbench]\naccount = "a"\n');
		vi.advanceTimersByTime(INTERVAL_MS * 3);

		expect(onCreated).toHaveBeenCalledTimes(1);
		watch.dispose();
	});

	it('calls back when the file is created right after the watch starts', () => {
		// fs.watchFile would take this file as its starting state and never report it.
		const filePath = path.join(root, 'connections.toml');
		const onCreated = vi.fn();
		const watch = watchForFileCreation(filePath, onCreated, INTERVAL_MS);
		fs.writeFileSync(filePath, '[workbench]\n');

		vi.advanceTimersByTime(INTERVAL_MS);

		expect(onCreated).toHaveBeenCalledTimes(1);
		watch.dispose();
	});

	it('does not call back after it is disposed', () => {
		const filePath = path.join(root, 'connections.toml');
		const onCreated = vi.fn();
		const watch = watchForFileCreation(filePath, onCreated, INTERVAL_MS);

		watch.dispose();
		fs.writeFileSync(filePath, '[workbench]\n');
		vi.advanceTimersByTime(INTERVAL_MS * 3);

		expect(onCreated).not.toHaveBeenCalled();
	});
});
