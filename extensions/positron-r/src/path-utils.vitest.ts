/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { arePathsSameFile } from './path-utils';

// Creating links on Windows needs Developer Mode or admin rights, and the
// layout copies CRAN's macOS installer.
describe.skipIf(process.platform === 'win32')('arePathsSameFile', () => {
	let root: string;

	/**
	 * Lays out R the way CRAN's macOS installer does: versioned folders, a
	 * `Current` link to one of them, a `Resources` link through `Current`,
	 * and a `bin/R` link like `/usr/local/bin/R`.
	 */
	beforeEach(() => {
		root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'path-utils-')));
		for (const version of ['4.5', '4.6']) {
			const bin = path.join(root, 'R.framework', 'Versions', version, 'Resources', 'bin');
			fs.mkdirSync(bin, { recursive: true });
			fs.writeFileSync(path.join(bin, 'R'), '');
		}
		fs.symlinkSync('4.6', path.join(root, 'R.framework', 'Versions', 'Current'));
		fs.symlinkSync(path.join('Versions', 'Current', 'Resources'), path.join(root, 'R.framework', 'Resources'));
		fs.mkdirSync(path.join(root, 'bin'));
		fs.symlinkSync(path.join('..', 'R.framework', 'Resources', 'bin', 'R'), path.join(root, 'bin', 'R'));
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	const versioned = (version: string) => path.join(root, 'R.framework', 'Versions', version, 'Resources', 'bin', 'R');

	it('matches a link chain to the file it leads to', () => {
		expect(arePathsSameFile(path.join(root, 'bin', 'R'), versioned('4.6'))).toBe(true);
		expect(arePathsSameFile(path.join(root, 'R.framework', 'Resources', 'bin', 'R'), versioned('4.6'))).toBe(true);
	});

	it('does not match a different file', () => {
		expect(arePathsSameFile(path.join(root, 'bin', 'R'), versioned('4.5'))).toBe(false);
	});

	it('compares a path that does not exist as given', () => {
		const missing = path.join(root, 'missing', 'R');
		expect(arePathsSameFile(missing, missing)).toBe(true);
		expect(arePathsSameFile(missing, versioned('4.6'))).toBe(false);
	});
});
