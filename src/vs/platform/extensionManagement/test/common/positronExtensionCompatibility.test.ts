/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { positronExtensionCompatibility } from '../../common/abstractExtensionManagementService.js';
import { IProductService } from '../../../product/common/productService.js';
import { IExtensionManifest } from '../../../extensions/common/extensions.js';

suite('Positron Extension Compatibility', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const mockProductService: IProductService = {
		positronVersion: '2026.02.0',
		version: '1.106.0',
		date: '2026-01-10'
	} as IProductService;

	test('should reject blocked extension (ms-python.python)', () => {
		const extension = {
			name: 'python',
			publisher: 'ms-python',
			displayName: 'Python'
		};

		const result = positronExtensionCompatibility(extension, mockProductService);

		assert.strictEqual(result.compatible, false);
		assert.ok(result.reason);
		assert.ok(result.reason.includes('conflicts with Positron built-in features'));
		assert.ok(result.reason.includes('Python'));
	});

	test('should accept extension with compatible version requirement', () => {
		const extensionManifest: IExtensionManifest = {
			name: 'test-extension',
			publisher: 'test-publisher',
			displayName: 'Test Extension',
			version: '1.0.0',
			engines: {
				positron: '^2025.1.0' // Compatible version requirement
			}
		} as IExtensionManifest;

		const result = positronExtensionCompatibility(extensionManifest, mockProductService);

		assert.strictEqual(result.compatible, true);
		assert.strictEqual(result.reason, undefined);
	});

	test('should accept extension without engine requirements', () => {
		const extension = {
			name: 'simple-extension',
			publisher: 'simple-publisher',
			displayName: 'Simple Extension'
		};

		const result = positronExtensionCompatibility(extension, mockProductService);

		assert.strictEqual(result.compatible, true);
		assert.strictEqual(result.reason, undefined);
	});

	test('should report validation error for malformed Positron version syntax', () => {
		// Test with an extension that has malformed Positron version syntax
		const extensionManifest: IExtensionManifest = {
			name: 'test-extension',
			publisher: 'test-publisher',
			displayName: 'Test Extension',
			version: '1.0.0',
			main: './main.js', // Must have main to trigger validation
			engines: {
				positron: 'invalid-version-syntax' // Malformed version will produce error
			}
		} as IExtensionManifest;

		const result = positronExtensionCompatibility(extensionManifest, mockProductService);

		assert.strictEqual(result.compatible, false);
		assert.ok(result.reason);
		// Should contain error about parsing the version
		assert.ok(result.reason.includes('Could not parse'));
	});

	test('should handle missing ProductService gracefully', () => {
		const extension = {
			name: 'test-extension',
			publisher: 'test-publisher',
			displayName: 'Test Extension'
		};

		const result = positronExtensionCompatibility(extension, undefined);

		assert.strictEqual(result.compatible, true);
		assert.strictEqual(result.reason, undefined);
	});

	test('should handle different extension input types', () => {
		// Test with basic extension object
		const basicExtension = {
			name: 'basic',
			publisher: 'publisher'
		};
		let result = positronExtensionCompatibility(basicExtension, mockProductService);
		assert.strictEqual(result.compatible, true);

		// Test with gallery extension (using only required properties)
		const galleryExtension = {
			name: 'gallery',
			publisher: 'publisher',
			displayName: 'Gallery Extension'
		};
		result = positronExtensionCompatibility(galleryExtension, mockProductService);
		assert.strictEqual(result.compatible, true);

		// Test with manifest
		const manifestExtension: IExtensionManifest = {
			name: 'manifest',
			publisher: 'publisher',
			displayName: 'Manifest Extension',
			version: '1.0.0'
		} as IExtensionManifest;
		result = positronExtensionCompatibility(manifestExtension, mockProductService);
		assert.strictEqual(result.compatible, true);
	});

});
