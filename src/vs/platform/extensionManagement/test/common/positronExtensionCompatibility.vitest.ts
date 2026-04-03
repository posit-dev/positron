/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ensureNoLeakedDisposables } from '../../../../base/test/common/vitestSetup.js';
import { positronExtensionCompatibility } from '../../common/abstractExtensionManagementService.js';
import { IProductService } from '../../../product/common/productService.js';
import { IExtensionManifest } from '../../../extensions/common/extensions.js';

describe('Positron Extension Compatibility', () => {

	ensureNoLeakedDisposables();

	const mockProductService: IProductService = {
		positronVersion: '2026.02.0',
		version: '1.106.0',
		date: '2026-01-10'
	} as IProductService;

	it('should reject blocked extension (ms-python.python)', () => {
		const extension = {
			name: 'python',
			publisher: 'ms-python',
			displayName: 'Python'
		};

		const result = positronExtensionCompatibility(extension, mockProductService);

		expect(result.compatible).toBe(false);
		expect(result.reason).toBeTruthy();
		expect(result.reason!.includes('conflicts with Positron built-in features')).toBeTruthy();
		expect(result.reason!.includes('Python')).toBeTruthy();
	});

	it('should accept extension with compatible version requirement', () => {
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

		expect(result.compatible).toBe(true);
		expect(result.reason).toBe(undefined);
	});

	it('should reject extension that requires newer Positron version', () => {
		const extensionManifest: IExtensionManifest = {
			name: 'future-extension',
			publisher: 'test-publisher',
			displayName: 'Future Extension',
			version: '1.0.0',
			main: './main.js', // Must have main to trigger version validation
			engines: {
				positron: '^2027.01.0' // Requires newer version than 2026.02.0
			}
		} as IExtensionManifest;

		const result = positronExtensionCompatibility(extensionManifest, mockProductService);

		expect(result.compatible).toBe(false);
		expect(result.reason).toBeTruthy();
		expect(result.reason!.includes('Extension is not compatible with Positron')).toBeTruthy();
		expect(result.reason!.includes('2026.02.0')).toBeTruthy();
		expect(result.reason!.includes('2027.01.0')).toBeTruthy();
	});

	it('should accept extension without engine requirements', () => {
		const extension = {
			name: 'simple-extension',
			publisher: 'simple-publisher',
			displayName: 'Simple Extension'
		};

		const result = positronExtensionCompatibility(extension, mockProductService);

		expect(result.compatible).toBe(true);
		expect(result.reason).toBe(undefined);
	});

	it('should report validation error for malformed Positron version syntax', () => {
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

		expect(result.compatible).toBe(false);
		expect(result.reason).toBeTruthy();
		// Should contain error about parsing the version
		expect(result.reason!.includes('Could not parse')).toBeTruthy();
	});

	it('should handle missing ProductService gracefully', () => {
		const extension = {
			name: 'test-extension',
			publisher: 'test-publisher',
			displayName: 'Test Extension'
		};

		const result = positronExtensionCompatibility(extension, undefined);

		expect(result.compatible).toBe(true);
		expect(result.reason).toBe(undefined);
	});

	it('should handle different extension input types', () => {
		// Test with basic extension object
		const basicExtension = {
			name: 'basic',
			publisher: 'publisher'
		};
		let result = positronExtensionCompatibility(basicExtension, mockProductService);
		expect(result.compatible).toBe(true);

		// Test with gallery extension (using only required properties)
		const galleryExtension = {
			name: 'gallery',
			publisher: 'publisher',
			displayName: 'Gallery Extension'
		};
		result = positronExtensionCompatibility(galleryExtension, mockProductService);
		expect(result.compatible).toBe(true);

		// Test with manifest
		const manifestExtension: IExtensionManifest = {
			name: 'manifest',
			publisher: 'publisher',
			displayName: 'Manifest Extension',
			version: '1.0.0'
		} as IExtensionManifest;
		result = positronExtensionCompatibility(manifestExtension, mockProductService);
		expect(result.compatible).toBe(true);
	});

});
