/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as positron from 'positron';
import { listMissingRPackages, parseRPackageReferences } from '../missingPackages';
import { RPackageManager } from '../packages';

function makePackage(name: string): positron.LanguageRuntimePackage {
	return { id: name, name, displayName: name, version: '0' };
}

/**
 * Builds a minimal RPackageManager stub: `installed` are reported as installed,
 * and `available` are the packages the repository search can find by exact name.
 */
function makeManager(installed: string[], available: string[]): RPackageManager {
	return {
		getPackages: async () => installed.map(makePackage),
		searchPackages: async (query: string) =>
			available.includes(query) ? [makePackage(query)] : [],
	} as unknown as RPackageManager;
}

suite('parseRPackageReferences', () => {
	test('extracts packages from library/require/requireNamespace and :: usage', () => {
		const code = [
			'library(dplyr)',
			'require("ggplot2")',
			'requireNamespace("jsonlite")',
			'x <- stringr::str_pad("a", 3)',
			'y <- data.table:::shallow(z)',
		].join('\n');

		assert.deepStrictEqual(
			parseRPackageReferences(code).sort(),
			['data.table', 'dplyr', 'ggplot2', 'jsonlite', 'stringr'].sort(),
		);
	});
});

suite('listMissingRPackages', () => {
	test('drops installed packages and packages not available in the repositories', async () => {
		// dplyr is installed; tidyverse is available on CRAN; garfblatz is
		// GitHub-only (not in available.packages), so it is never offered.
		const manager = makeManager(['dplyr'], ['tidyverse']);
		const code = 'library(dplyr)\nlibrary(tidyverse)\nlibrary(garfblatz)';

		const result = await listMissingRPackages(manager, { code });

		assert.deepStrictEqual(result, [{ name: 'tidyverse' }]);
	});
});
