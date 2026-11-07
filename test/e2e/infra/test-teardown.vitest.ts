/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TestTeardown } from './test-teardown.js';

describe('TestTeardown.restoreFiles', () => {
	const repoWithModifiedFile = (): string => {
		const root = mkdtempSync(join(tmpdir(), 'test-teardown-'));
		const git = (args: string) => execSync(`git -c commit.gpgsign=false -c user.name=e2e -c user.email=e2e@example.com ${args}`, { cwd: root });
		git('init -q');
		writeFileSync(join(root, 'file.txt'), 'baseline\n');
		git('add file.txt');
		git('commit -q -m baseline');
		writeFileSync(join(root, 'file.txt'), 'modified\n');
		return root;
	};

	test('waits out an index.lock another git process still holds', async () => {
		const root = repoWithModifiedFile();
		const lock = join(root, '.git', 'index.lock');
		writeFileSync(lock, '');
		setTimeout(() => rmSync(lock), 700);

		await new TestTeardown(root).restoreFiles(['file.txt']);

		expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe('baseline\n');
	});

	test('warns instead of throwing when the lock is never released', async () => {
		const root = repoWithModifiedFile();
		writeFileSync(join(root, '.git', 'index.lock'), '');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });

		await new TestTeardown(root).restoreFiles(['file.txt']);

		expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe('modified\n');
		expect(warn).toHaveBeenCalledWith('Failed to restore test files:', expect.objectContaining({ message: expect.stringContaining('index.lock') }));
	});
});
