/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getPositronVersion } from './positron-version.js';

/**
 * Only the build-directory path is covered here. The no-BUILD path shells out to
 * the version script, which needs a full git checkout.
 */
describe('getPositronVersion from a build directory', () => {
	const product = JSON.stringify({ positronVersion: '2026.09.0', positronBuildNumber: 150 });

	const buildWith = (relativeDir: string): string => {
		const root = mkdtempSync(join(tmpdir(), 'positron-version-'));
		const dir = relativeDir ? join(root, relativeDir) : root;
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'product.json'), product);
		return root;
	};

	test('reads the Electron layout, where product.json sits under resources/app', () => {
		// darwin nests it one level deeper; this asserts the layout this platform reads.
		const relative = process.platform === 'darwin'
			? join('Contents', 'Resources', 'app')
			: join('resources', 'app');

		expect(getPositronVersion(buildWith(relative))).toEqual({
			positronVersion: '2026.09.0',
			buildNumber: 150
		});
	});

	test('reads a positron-server build, which keeps product.json at its root', () => {
		// Without the root fallback this returns null, and the memory harness
		// publishes a snapshot with no version rather than failing loudly.
		expect(getPositronVersion(buildWith(''))).toEqual({
			positronVersion: '2026.09.0',
			buildNumber: 150
		});
	});

	test('yields null when the build has no product.json in either place', () => {
		expect(getPositronVersion(mkdtempSync(join(tmpdir(), 'positron-version-')))).toBeNull();
	});

	// The build pipeline stamps the VS Code `version` (package.json) and the
	// positron `commit` into product.json (gulpfile.vscode.ts / gulpfile.reh.ts).
	// Together they place a build against the upstream merges, which the Positron
	// version alone cannot: 2026.10.0-9 and 2026.10.0-25 differ by a VS Code
	// release, and only the second has a `1.134.0`.
	describe('the upstream version and build commit', () => {
		const commit = '13e0efe1234567890abcdef1234567890abcdef12';

		const buildWithProduct = (productJson: Record<string, unknown>): string => {
			const root = mkdtempSync(join(tmpdir(), 'positron-version-'));
			writeFileSync(join(root, 'product.json'), JSON.stringify(productJson));
			return root;
		};

		test('reads them from product.json when the build stamped them', () => {
			const root = buildWithProduct({
				positronVersion: '2026.10.0', positronBuildNumber: 25, version: '1.134.0', commit
			});
			expect(getPositronVersion(root)).toEqual({
				positronVersion: '2026.10.0', buildNumber: 25, vscodeVersion: '1.134.0', commit
			});
		});

		test('leaves them out rather than reporting an empty string', () => {
			// The source-tree product.json carries `"version": ""` and no commit; a
			// build that somehow shipped it must not report a VS Code release of ''.
			const root = buildWithProduct({ positronVersion: '2026.10.0', positronBuildNumber: 25, version: '' });
			expect(getPositronVersion(root)).not.toHaveProperty('vscodeVersion');
			expect(getPositronVersion(root)).not.toHaveProperty('commit');
		});
	});
});
