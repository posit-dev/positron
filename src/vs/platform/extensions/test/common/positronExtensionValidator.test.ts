/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { IExtensionManifest } from '../../common/extensions.js';
import { validatePositronExtensionManifest } from '../../common/positronExtensionValidator.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

/**
 * Validate Positron Extension Manifest suite.
 */
suite('Positron Extension Validator', () => {
	test('Positron Extension Validator - Positron Version', () => {
		// Setup the tests.
		const uri = URI.parse('http://test-extension.com');
		const manifest: IExtensionManifest = {
			name: "testExtension",
			publisher: "testPublisher",
			version: "0.1.0",
			main: "./main.js",
			engines: {
				vscode: "^1.0.0",
				positron: "^2025.6.0"
			}
		};

		// Some builds to test.
		const buildsToTest = [0, 24, 49, 99];

		// Test years between 2000 and 2050.
		for (let year = 2000; year <= 2050; year++) {
			// Test months, including weird months we'll never use like 13-20, just to ensure robustness.
			for (let month = 1; month <= 20; month++) {
				// Test random builds.
				for (const build of buildsToTest) {
					// Create the version under test and validate the manifest for it.
					const versionUnderTest = `${year}.${month}.${build}`;
					const testResult = validatePositronExtensionManifest(versionUnderTest, undefined, uri, manifest, false).length;

					// Check the text result based on the year and month.
					if (year < 2025 || (year === 2025 && month < 6)) {
						assert.notEqual(testResult, 0, `Expected errors for version ${versionUnderTest}`);
					} else {
						assert.equal(testResult, 0, `Expected no errors for version ${versionUnderTest}`);
					}
				}
			}
		}
	});

	// Ensure that no disposables are leaked.
	ensureNoDisposablesAreLeakedInTestSuite();
});
