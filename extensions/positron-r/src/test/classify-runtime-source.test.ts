/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import { classifyRRuntimeSource, RRuntimeSource } from '../provider';
import { CondaMetadata, ModuleMetadata, PixiMetadata, ReasonDiscovered } from '../r-installation';

const MODULE_METADATA: ModuleMetadata = {
	type: 'module',
	environmentName: 'R-Latest',
	modules: ['R/4.6.0'],
	startupCommand: 'module load R/4.6.0',
};

const CONDA_METADATA: CondaMetadata = {
	environmentPath: '/home/user/.conda/envs/r-env',
};

const PIXI_METADATA: PixiMetadata = {
	environmentPath: '/project/.pixi/envs/default',
	manifestPath: '/project/pixi.toml',
};

suite('classifyRRuntimeSource', () => {

	test('module metadata wins even when discovery reason is not MODULE', () => {
		// Regression: an affiliated runtime restored from storage is rebuilt with
		// the `affiliated` reason but keeps its module metadata. It must still be
		// labelled Module (and launch via `module load`), not System.
		const source = classifyRRuntimeSource(
			'/opt/software/R/4.4.2/bin/R',
			MODULE_METADATA,
			[ReasonDiscovered.affiliated, ReasonDiscovered.PATH],
			false,
		);

		assert.strictEqual(source, RRuntimeSource.module);
	});

	test('falls back to the MODULE discovery reason when no metadata is present', () => {
		const source = classifyRRuntimeSource(
			'/opt/R/4.6.0/bin/R',
			undefined,
			[ReasonDiscovered.MODULE],
			false,
		);

		assert.strictEqual(source, RRuntimeSource.module);
	});

	test('classifies conda and pixi metadata over a homebrew path', () => {
		assert.strictEqual(
			classifyRRuntimeSource('/opt/homebrew/bin/R', CONDA_METADATA, null, false),
			RRuntimeSource.conda,
		);
		assert.strictEqual(
			classifyRRuntimeSource('/opt/homebrew/bin/R', PIXI_METADATA, null, false),
			RRuntimeSource.pixi,
		);
	});

	test('classifies homebrew, user, and system installations without metadata', () => {
		assert.strictEqual(
			classifyRRuntimeSource('/opt/homebrew/bin/R', undefined, [ReasonDiscovered.HQ], false),
			RRuntimeSource.homebrew,
		);
		assert.strictEqual(
			classifyRRuntimeSource('/home/user/R/bin/R', undefined, [ReasonDiscovered.userSetting], true),
			RRuntimeSource.user,
		);
		assert.strictEqual(
			classifyRRuntimeSource('/usr/bin/R', undefined, [ReasonDiscovered.PATH], false),
			RRuntimeSource.system,
		);
	});
});
