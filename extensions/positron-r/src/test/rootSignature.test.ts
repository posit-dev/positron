/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeRootSignatureEntries, rCurrentSymlinks } from '../provider';

/**
 * Set `process.platform` for the duration of a callback and restore it after.
 * `process.platform` is read at call time by `rCurrentSymlinks()`, so PR CI
 * (R discovery runs Linux-only) can't exercise the darwin / win32 branches
 * without this -- we assert all three explicitly.
 */
function withPlatform(platform: NodeJS.Platform, fn: () => void): void {
	const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
	Object.defineProperty(process, 'platform', { value: platform });
	try {
		fn();
	} finally {
		Object.defineProperty(process, 'platform', original);
	}
}

suite('R discovery-root signature', () => {

	suite('rCurrentSymlinks', () => {
		test('returns the platform-appropriate default-version symlink, or none on Windows', () => {
			const hq = ['/opt/R'];
			withPlatform('linux', () => assert.deepStrictEqual(rCurrentSymlinks(hq), ['/opt/R/current']));
			// macOS uses uppercase 'Current'.
			withPlatform('darwin', () => assert.deepStrictEqual(rCurrentSymlinks(hq), ['/opt/R/Current']));
			// Windows has no `current` symlink (default comes from the registry).
			withPlatform('win32', () => assert.deepStrictEqual(rCurrentSymlinks(hq), []));
		});

		test('maps each headquarters directory', () => {
			withPlatform('linux', () => assert.deepStrictEqual(
				rCurrentSymlinks(['/opt/R', '/custom/R']),
				['/opt/R/current', '/custom/R/current'],
			));
		});
	});

	// Exercises the signature against a real temporary headquarters directory
	// with real version subdirectories and a real `current` symlink. No `fs`
	// mocking (stubbing the `fs` module is unreliable in the extension host --
	// it's why the sibling discovery suite is skipped); the symlink repoint is
	// performed for real.
	suite('computeRootSignatureEntries (rig current symlink)', () => {
		let hq: string;
		// The helper records realpath'd paths; on macOS os.tmpdir() lives under
		// /var, which realpath resolves to /private/var. Build expectations from
		// the realpath'd headquarters so the assertions are platform-stable.
		let realHq: string;

		setup(() => {
			hq = fs.mkdtempSync(path.join(os.tmpdir(), 'r-hq-'));
			realHq = fs.realpathSync(hq);
			fs.mkdirSync(path.join(hq, '4.5.2'));
			fs.mkdirSync(path.join(hq, '4.6.0'));
			fs.symlinkSync(path.join(hq, '4.5.2'), path.join(hq, 'current'));
		});

		teardown(() => {
			fs.rmSync(hq, { recursive: true, force: true });
		});

		test('records the resolved current-symlink target, and repointing it flips the signature', () => {
			const candidates = [hq, path.join(hq, 'current')];

			// current -> 4.5.2
			const before = computeRootSignatureEntries(candidates);
			assert.deepStrictEqual(before.map(e => e.path), [realHq, path.join(realHq, '4.5.2')]);
			assert.ok(before.every(e => e.exists), 'all entries should resolve to existing paths');

			// rig default 4.6.0: repoint the symlink for real.
			fs.unlinkSync(path.join(hq, 'current'));
			fs.symlinkSync(path.join(hq, '4.6.0'), path.join(hq, 'current'));

			const after = computeRootSignatureEntries(candidates);
			// The current-symlink entry now resolves to 4.6.0 -- the signature
			// changed, so a warm start would trigger a clean re-discovery.
			assert.deepStrictEqual(after.map(e => e.path), [realHq, path.join(realHq, '4.6.0')]);
		});

		test('a missing current symlink still contributes a (non-existent) entry', () => {
			fs.unlinkSync(path.join(hq, 'current'));
			const entries = computeRootSignatureEntries([hq, path.join(hq, 'current')]);
			// A non-existent candidate isn't realpath'd, so it keeps its raw path.
			assert.deepStrictEqual(entries, [
				{ path: realHq, exists: true, mtimeMs: fs.statSync(hq).mtimeMs },
				{ path: path.join(hq, 'current'), exists: false, mtimeMs: 0 },
			]);
		});
	});
});
