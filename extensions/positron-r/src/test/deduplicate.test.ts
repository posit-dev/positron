/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import { deduplicateRBinaries, RBinary } from '../provider';
import { ModuleMetadata, ReasonDiscovered, RVersionsMetadata } from '../r-installation';

const MODULE_METADATA: ModuleMetadata = {
	type: 'module',
	environmentName: 'r/4.5.3',
	modules: ['r/4.5.3'],
	startupCommand: 'module load r/4.5.3',
};

const RVERSIONS_LABELED: RVersionsMetadata = {
	type: 'rversions',
	label: 'R 4.5.3 (Production)',
};

suite('deduplicateRBinaries', () => {

	test('retains module metadata when the system binary is discovered first', () => {
		// Regression for #13936: a module-managed R that resolves to a path the
		// system scanner also finds must keep its module startupCommand.
		const binaries: RBinary[] = [
			{ path: '/opt/R/4.5.3/bin/R', reasons: [ReasonDiscovered.PATH] },
			{ path: '/opt/R/4.5.3/bin/R', reasons: [ReasonDiscovered.MODULE], packagerMetadata: MODULE_METADATA },
		];

		const result = deduplicateRBinaries(binaries);

		assert.strictEqual(result.length, 1);
		assert.deepStrictEqual(result[0], {
			path: '/opt/R/4.5.3/bin/R',
			reasons: [ReasonDiscovered.PATH, ReasonDiscovered.MODULE],
			packagerMetadata: MODULE_METADATA,
		});
	});

	test('retains module metadata regardless of discovery order', () => {
		const binaries: RBinary[] = [
			{ path: '/opt/R/4.5.3/bin/R', reasons: [ReasonDiscovered.MODULE], packagerMetadata: MODULE_METADATA },
			{ path: '/opt/R/4.5.3/bin/R', reasons: [ReasonDiscovered.PATH] },
		];

		const result = deduplicateRBinaries(binaries);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].packagerMetadata, MODULE_METADATA);
		assert.deepStrictEqual(result[0].reasons, [ReasonDiscovered.MODULE, ReasonDiscovered.PATH]);
	});

	test('still prefers r-versions metadata with a label over no metadata', () => {
		const binaries: RBinary[] = [
			{ path: '/opt/R/4.5.3/bin/R', reasons: [ReasonDiscovered.PATH] },
			{ path: '/opt/R/4.5.3/bin/R', reasons: [ReasonDiscovered.RVERSIONS], packagerMetadata: RVERSIONS_LABELED },
		];

		const result = deduplicateRBinaries(binaries);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].packagerMetadata, RVERSIONS_LABELED);
	});

	test('prefers module metadata over r-versions metadata for the same path', () => {
		const binaries: RBinary[] = [
			{ path: '/opt/R/4.5.3/bin/R', reasons: [ReasonDiscovered.RVERSIONS], packagerMetadata: RVERSIONS_LABELED },
			{ path: '/opt/R/4.5.3/bin/R', reasons: [ReasonDiscovered.MODULE], packagerMetadata: MODULE_METADATA },
		];

		const result = deduplicateRBinaries(binaries);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].packagerMetadata, MODULE_METADATA);
	});

	test('keeps distinct binary paths separate', () => {
		const binaries: RBinary[] = [
			{ path: '/opt/R/4.5.3/bin/R', reasons: [ReasonDiscovered.MODULE], packagerMetadata: MODULE_METADATA },
			{ path: '/usr/bin/R', reasons: [ReasonDiscovered.PATH] },
		];

		const result = deduplicateRBinaries(binaries);

		assert.strictEqual(result.length, 2);
	});
});
