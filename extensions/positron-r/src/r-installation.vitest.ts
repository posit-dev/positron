/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { arePathsSame, arePathsSameFile } from './path-utils';
import { ReasonRejected, RInstallation } from './r-installation';

// These modules import `vscode`, which Vitest can't load.
vi.mock('./extension', () => ({ LOGGER: { info: () => { }, warn: () => { }, error: () => { }, debug: () => { }, trace: () => { } } }));
vi.mock('./interpreter-settings.js', () => ({ isExcludedInstallation: () => undefined }));
vi.mock('./kernel.js', () => ({
	normalizeWindowsArch: (arch: string) => arch,
	sniffMachOBinaryArchitecture: () => undefined,
	sniffWindowsBinaryArchitecture: () => undefined,
}));

// Creating links on Windows needs Developer Mode or admin rights. The layout
// copies CRAN's macOS installer, so the tests run as macOS on every platform.
describe.skipIf(process.platform === 'win32')('RInstallation for an R from CRAN\'s macOS installer', () => {
	const platform = process.platform;
	let root: string;

	/** The R launcher in the version folder, where the current R's path resolves to. */
	const versionedR = () => path.join(root, 'R.framework', 'Versions', '4.6', 'Resources', 'bin', 'R');
	/** A link to the current R, like `/usr/local/bin/R`. */
	const linkedR = () => path.join(root, 'bin', 'R');

	/**
	 * Lays out R the way CRAN's macOS installer does. The launcher sets
	 * `R_HOME_DIR` through the `Resources` link, so it always runs whichever
	 * R is current.
	 */
	beforeEach(() => {
		Object.defineProperty(process, 'platform', { value: 'darwin' });
		root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r-installation-')));
		const resources = path.join(root, 'R.framework', 'Versions', '4.6', 'Resources');
		fs.mkdirSync(path.join(resources, 'bin'), { recursive: true });
		fs.writeFileSync(path.join(resources, 'bin', 'R'),
			`#!/bin/bash\n# Shell wrapper for R executable.\n\nR_HOME_DIR=${path.join(root, 'R.framework', 'Resources')}\n`);
		fs.mkdirSync(path.join(resources, 'library', 'utils'), { recursive: true });
		fs.writeFileSync(path.join(resources, 'library', 'utils', 'DESCRIPTION'),
			'Package: utils\nBuilt: R 4.6.0; aarch64-apple-darwin20; 2026-04-24 12:00:00 UTC; unix\n');
		fs.symlinkSync('4.6', path.join(root, 'R.framework', 'Versions', 'Current'));
		fs.symlinkSync(path.join('Versions', 'Current', 'Resources'), path.join(root, 'R.framework', 'Resources'));
		fs.mkdirSync(path.join(root, 'bin'));
		fs.symlinkSync(path.join('..', 'R.framework', 'Resources', 'bin', 'R'), linkedR());
	});

	afterEach(() => {
		Object.defineProperty(process, 'platform', { value: platform });
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('rejects a link to the current R when the text of the paths is compared', () => {
		const inst = new RInstallation(linkedR(), arePathsSame(versionedR(), linkedR()));
		expect({ usable: inst.usable, reasonRejected: inst.reasonRejected }).toEqual({ usable: false, reasonRejected: ReasonRejected.nonOrthogonal });
	});

	it('accepts a link to the current R when the files the paths lead to are compared', () => {
		const inst = new RInstallation(linkedR(), arePathsSameFile(versionedR(), linkedR()));
		expect({ usable: inst.usable, current: inst.current, orthogonal: inst.orthogonal }).toEqual({ usable: true, current: true, orthogonal: false });
	});
});
