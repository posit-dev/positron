/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { packagerMetadataForPath } from './packager-detection';

describe('packagerMetadataForPath', () => {
	let root: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'packager-detection-'));
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	/** Creates the given directories and files under the temp root. */
	function layout(dirs: string[], files: string[] = []): void {
		dirs.forEach(dir => fs.mkdirSync(path.join(root, dir), { recursive: true }));
		files.forEach(file => fs.writeFileSync(path.join(root, file), ''));
	}

	it('detects a Conda environment', () => {
		layout(['env/conda-meta', 'env/bin']);
		expect(packagerMetadataForPath(path.join(root, 'env', 'bin', 'R')))
			.toEqual({ environmentPath: path.join(root, 'env') });
	});

	it('detects a Conda environment from the Windows layout', () => {
		layout(['env/conda-meta', 'env/Lib/R/bin/x64']);
		expect(packagerMetadataForPath(path.join(root, 'env', 'Lib', 'R', 'bin', 'x64', 'R.exe')))
			.toEqual({ environmentPath: path.join(root, 'env') });
	});

	it('detects a Pixi environment and its manifest', () => {
		layout(['proj/.pixi/envs/default/conda-meta', 'proj/.pixi/envs/default/bin'], ['proj/pixi.toml']);
		const envPath = path.join(root, 'proj', '.pixi', 'envs', 'default');
		expect(packagerMetadataForPath(path.join(envPath, 'bin', 'R'))).toEqual({
			environmentPath: envPath,
			manifestPath: path.join(root, 'proj', 'pixi.toml'),
			environmentName: 'default',
		});
	});

	it('treats a Pixi-shaped environment without a manifest as Conda', () => {
		layout(['proj/.pixi/envs/default/conda-meta', 'proj/.pixi/envs/default/bin']);
		const envPath = path.join(root, 'proj', '.pixi', 'envs', 'default');
		expect(packagerMetadataForPath(path.join(envPath, 'bin', 'R'))).toEqual({ environmentPath: envPath });
	});

	it('returns undefined outside an environment', () => {
		layout(['opt/R/4.5/bin']);
		expect(packagerMetadataForPath(path.join(root, 'opt', 'R', '4.5', 'bin', 'R'))).toBeUndefined();
	});
});
