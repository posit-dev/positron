/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import './mocha-setup';
import { archesMismatch, resolveLibRPath } from '../environmentHealth';

suite('environment health: libR path resolution', () => {
	// Mirrors harp::find_r_shared_library_folder. Windows arm64 is deliberately
	// flat; see crates/harp/src/sys/windows/library.rs:107-117.
	const cases: Array<{
		name: string;
		platform: NodeJS.Platform;
		arkArch: 'arm64' | 'x64' | undefined;
		expected: string[];
	}> = [
			{ name: 'macOS', platform: 'darwin', arkArch: 'arm64', expected: ['lib', 'libR.dylib'] },
			{ name: 'Linux', platform: 'linux', arkArch: 'x64', expected: ['lib', 'libR.so'] },
			{ name: 'Windows x64', platform: 'win32', arkArch: 'x64', expected: ['bin', 'x64', 'R.dll'] },
			{ name: 'Windows arm64', platform: 'win32', arkArch: 'arm64', expected: ['bin', 'R.dll'] },
		];

	for (const c of cases) {
		test(`${c.name} resolves the ark-compatible libR path`, () => {
			const rHome = path.join('/opt', 'R', '4.4.1');
			assert.strictEqual(
				resolveLibRPath(rHome, c.platform, c.arkArch),
				path.join(rHome, ...c.expected)
			);
		});
	}

	test('Windows with unknown ark arch falls back to the x64 layout', () => {
		// x64 is the overwhelmingly common Windows R install, so an unknown ark
		// arch should not send us looking in the rarer flat arm64 location.
		const rHome = path.join('C:', 'R', 'R-4.4.1');
		assert.strictEqual(
			resolveLibRPath(rHome, 'win32', undefined),
			path.join(rHome, 'bin', 'x64', 'R.dll')
		);
	});
});

suite('environment health: architecture comparison', () => {
	test('reports a mismatch when R and ark differ', () => {
		assert.strictEqual(archesMismatch('x86_64', 'arm64'), true);
	});

	test('normalizes x64 and x86_64 as the same architecture', () => {
		// The two sniffers use different vocabularies: sniffWindowsBinaryArchitecture
		// returns 'x64', RInstallation.arch records 'x86_64'.
		assert.strictEqual(archesMismatch('x86_64', 'x64'), false);
	});

	test('treats arm64 on both sides as matching', () => {
		assert.strictEqual(archesMismatch('arm64', 'arm64'), false);
	});

	test('reports no mismatch when either side is unknown', () => {
		// A failed sniff is missing information, not evidence of a problem.
		assert.strictEqual(archesMismatch(undefined, 'arm64'), false);
		assert.strictEqual(archesMismatch('arm64', undefined), false);
		assert.strictEqual(archesMismatch('', undefined), false);
	});
});
