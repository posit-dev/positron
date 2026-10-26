/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Temporary directories for the tests, removed however the test ends.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGS_RUN = fileURLToPath(new URL('../fixtures/logs-run/', import.meta.url));
const RENDER = fileURLToPath(new URL('../render.mjs', import.meta.url));

/** Calls `fn` with a new temporary directory, and removes it when `fn` returns or its promise settles. */
export function withTmpDir(prefix, fn) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	const remove = () => rmSync(dir, { recursive: true, force: true });
	let pending = false;
	try {
		const out = fn(dir);
		if (out instanceof Promise) {
			pending = true;
			return out.finally(remove);
		}
		return out;
	} finally {
		if (!pending) {
			remove();
		}
	}
}

/**
 * Calls `fn` with a copy of fixtures/logs-run, with `passes` as report.json's
 * cost when given: `{ dir, report, render }`, where `render(...args)` runs
 * render.mjs with those arguments.
 */
export function withLogsRun(fn, passes) {
	return withTmpDir('logs-run-', dir => {
		cpSync(LOGS_RUN, dir, { recursive: true });
		const report = join(dir, 'report.json');
		if (passes) {
			writeFileSync(report, JSON.stringify({ ...JSON.parse(readFileSync(report, 'utf8')), cost: { passes } }));
		}
		return fn({ dir, report, render: (...args) => spawnSync(process.execPath, [RENDER, ...args], { encoding: 'utf8' }) });
	});
}
