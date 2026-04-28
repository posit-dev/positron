/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ExtensionGalleryManifestService, ExtensionGalleryConfig, POSITRON_GALLERY_PRESETS } from '../../common/extensionGalleryManifestService.js';
import { ExtensionGalleryResourceType, getExtensionGalleryManifestResourceUri } from '../../common/extensionGalleryManifest.js';
import { IProductService } from '../../../product/common/productService.js';

function createProductService(extensionsGallery?: ExtensionGalleryConfig): IProductService {
	// eslint-disable-next-line local/code-no-dangerous-type-assertions
	return { _serviceBrand: undefined, extensionsGallery } as IProductService;
}

describe('POSITRON_GALLERY_PRESETS', () => {

	it('should have posit-p3m preset with p3m.dev URLs', () => {
		const preset = POSITRON_GALLERY_PRESETS['posit-p3m'];
		expect(preset).toBeDefined();
		expect(preset.serviceUrl).toBe('https://p3m.dev/openvsx/latest/vscode/gallery');
		expect(preset.itemUrl).toBe('https://p3m.dev/openvsx/latest/vscode/item');
		expect(preset.resourceUrlTemplate).toContain('p3m.dev');
	});

	it('should have open-vsx preset with open-vsx.org URLs', () => {
		const preset = POSITRON_GALLERY_PRESETS['open-vsx'];
		expect(preset).toBeDefined();
		expect(preset.serviceUrl).toBe('https://open-vsx.org/vscode/gallery');
		expect(preset.itemUrl).toBe('https://open-vsx.org/vscode/item');
		expect(preset.resourceUrlTemplate).toContain('open-vsx.org');
	});

	it('should have all required fields in each preset', () => {
		const requiredFields: (keyof ExtensionGalleryConfig)[] = [
			'serviceUrl', 'itemUrl', 'publisherUrl', 'resourceUrlTemplate',
			'extensionUrlTemplate', 'controlUrl', 'nlsBaseUrl',
		];
		for (const [name, preset] of Object.entries(POSITRON_GALLERY_PRESETS)) {
			for (const field of requiredFields) {
				expect(preset).toHaveProperty(field);
			}
			expect(preset.serviceUrl).toBeTruthy();
			expect(preset.itemUrl).toBeTruthy();
		}
	});
});

describe('ExtensionGalleryManifestService', () => {

	it('should return null when no gallery is configured', async () => {
		const service = new ExtensionGalleryManifestService(createProductService());
		const manifest = await service.getExtensionGalleryManifest();
		expect(manifest).toBeNull();
	});

	it('should build manifest from product gallery config', async () => {
		const service = new ExtensionGalleryManifestService(
			createProductService(POSITRON_GALLERY_PRESETS['posit-p3m'])
		);
		const manifest = await service.getExtensionGalleryManifest();
		expect(manifest).not.toBeNull();

		const queryUrl = getExtensionGalleryManifestResourceUri(
			manifest!, ExtensionGalleryResourceType.ExtensionQueryService
		);
		expect(queryUrl).toBe('https://p3m.dev/openvsx/latest/vscode/gallery/extensionquery');
	});

	it('should build manifest with open-vsx preset', async () => {
		const service = new ExtensionGalleryManifestService(
			createProductService(POSITRON_GALLERY_PRESETS['open-vsx'])
		);
		const manifest = await service.getExtensionGalleryManifest();
		expect(manifest).not.toBeNull();

		const queryUrl = getExtensionGalleryManifestResourceUri(
			manifest!, ExtensionGalleryResourceType.ExtensionQueryService
		);
		expect(queryUrl).toBe('https://open-vsx.org/vscode/gallery/extensionquery');
	});

	it('should include item and resource URLs in manifest when configured', async () => {
		const service = new ExtensionGalleryManifestService(
			createProductService(POSITRON_GALLERY_PRESETS['open-vsx'])
		);
		const manifest = await service.getExtensionGalleryManifest();
		expect(manifest).not.toBeNull();

		const detailsUrl = getExtensionGalleryManifestResourceUri(
			manifest!, ExtensionGalleryResourceType.ExtensionDetailsViewUri
		);
		expect(detailsUrl).toContain('open-vsx.org');

		const resourceUrl = getExtensionGalleryManifestResourceUri(
			manifest!, ExtensionGalleryResourceType.ExtensionResourceUri
		);
		expect(resourceUrl).toContain('open-vsx.org');
	});

	it('should omit publisher and item resources when URLs are empty', async () => {
		const config: ExtensionGalleryConfig = {
			serviceUrl: 'https://example.com/gallery',
			itemUrl: '',
			publisherUrl: '',
			resourceUrlTemplate: '',
			extensionUrlTemplate: '',
			controlUrl: '',
			nlsBaseUrl: '',
		};
		const service = new ExtensionGalleryManifestService(createProductService(config));
		const manifest = await service.getExtensionGalleryManifest();
		expect(manifest).not.toBeNull();

		// Query service should always be present
		const queryUrl = getExtensionGalleryManifestResourceUri(
			manifest!, ExtensionGalleryResourceType.ExtensionQueryService
		);
		expect(queryUrl).toBe('https://example.com/gallery/extensionquery');

		// Optional resources should be absent
		const detailsUrl = getExtensionGalleryManifestResourceUri(
			manifest!, ExtensionGalleryResourceType.ExtensionDetailsViewUri
		);
		expect(detailsUrl).toBeUndefined();

		const publisherUrl = getExtensionGalleryManifestResourceUri(
			manifest!, ExtensionGalleryResourceType.PublisherViewUri
		);
		expect(publisherUrl).toBeUndefined();

		const resourceUrl = getExtensionGalleryManifestResourceUri(
			manifest!, ExtensionGalleryResourceType.ExtensionResourceUri
		);
		expect(resourceUrl).toBeUndefined();
	});

	it('should report Available status when gallery is configured', () => {
		const service = new ExtensionGalleryManifestService(
			createProductService(POSITRON_GALLERY_PRESETS['posit-p3m'])
		);
		expect(service.extensionGalleryManifestStatus).toBe('available');
	});

	it('should report Unavailable status when gallery is not configured', () => {
		const service = new ExtensionGalleryManifestService(createProductService());
		expect(service.extensionGalleryManifestStatus).toBe('unavailable');
	});
});
