/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ExtensionGalleryManifestService, ExtensionGalleryConfig, POSITRON_GALLERY_PRESETS, resolvePositronGalleryConfig } from '../../common/extensionGalleryManifestService.js';
import { parseExtensionsGalleryEnv } from '../../common/extensionsGalleryEnv.js';
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
		for (const preset of Object.values(POSITRON_GALLERY_PRESETS)) {
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

describe('resolvePositronGalleryConfig', () => {

	const productGallery: ExtensionGalleryConfig = {
		serviceUrl: 'https://product.example.com/gallery',
		itemUrl: 'https://product.example.com/item',
		resourceUrlTemplate: '',
		controlUrl: '',
		extensionUrlTemplate: '',
		nlsBaseUrl: '',
		publisherUrl: '',
	};

	it('returns the parsed env gallery, ignoring gallerySource', () => {
		const envGallery: ExtensionGalleryConfig = {
			...productGallery,
			serviceUrl: 'https://override.example.com/gallery',
		};
		const result = resolvePositronGalleryConfig(envGallery, 'open-vsx', productGallery);
		expect(result).toBe(envGallery);
		expect(result?.serviceUrl).toBe('https://override.example.com/gallery');
		expect(result?.serviceUrl).not.toBe(POSITRON_GALLERY_PRESETS['open-vsx'].serviceUrl);
	});

	it('returns the parsed env gallery even with no gallerySource', () => {
		const envGallery: ExtensionGalleryConfig = {
			...productGallery,
			serviceUrl: 'https://override.example.com/gallery',
		};
		const result = resolvePositronGalleryConfig(envGallery, undefined, productGallery);
		expect(result).toBe(envGallery);
	});

	it('falls through to the gallerySource preset when env is undefined (parse failed or env unset)', () => {
		// Passing undefined is how the caller signals "env was not usable" — either
		// it wasn't set, or it was set but parseExtensionsGalleryEnv returned undefined
		// because the value was not valid JSON. In both cases the preset wins.
		expect(resolvePositronGalleryConfig(undefined, 'open-vsx', productGallery)).toBe(POSITRON_GALLERY_PRESETS['open-vsx']);
		expect(resolvePositronGalleryConfig(undefined, 'posit-p3m', productGallery)).toBe(POSITRON_GALLERY_PRESETS['posit-p3m']);
	});

	it('returns the product gallery when env is undefined and gallerySource is unset or unknown', () => {
		expect(resolvePositronGalleryConfig(undefined, undefined, productGallery)).toBe(productGallery);
		expect(resolvePositronGalleryConfig(undefined, '', productGallery)).toBe(productGallery);
		expect(resolvePositronGalleryConfig(undefined, 'not-a-preset', productGallery)).toBe(productGallery);
	});

	it('returns undefined when env is undefined and the product gallery is unset', () => {
		expect(resolvePositronGalleryConfig(undefined, undefined, undefined)).toBeUndefined();
	});
});

describe('parseExtensionsGalleryEnv', () => {

	// Invalid JSON is ignored (returns undefined, logs a warning) so a
	// malformed EXTENSIONS_GALLERY env var doesn't crash startup. product.ts
	// then falls back to the default product gallery.

	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
	});

	it('parses a properly-quoted JSON value into an ExtensionGalleryConfig', () => {
		const valid = JSON.stringify({
			serviceUrl: 'https://open-vsx.org/vscode/gallery',
			itemUrl: 'https://open-vsx.org/vscode/item',
			resourceUrlTemplate: '',
			controlUrl: '',
			extensionUrlTemplate: '',
			nlsBaseUrl: '',
			publisherUrl: '',
		});
		const parsed = parseExtensionsGalleryEnv<ExtensionGalleryConfig>(valid);
		expect(parsed?.serviceUrl).toBe('https://open-vsx.org/vscode/gallery');
		expect(parsed?.itemUrl).toBe('https://open-vsx.org/vscode/item');
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('returns undefined and warns on object literal with unquoted keys / single-quoted strings', () => {
		// This is the kind of value that was previously in .vscode/launch.json:
		// JS object literal syntax, not JSON.
		const malformed = `{serviceUrl: 'https://open-vsx.org/vscode/gallery'}`;
		expect(parseExtensionsGalleryEnv(malformed)).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledOnce();
	});

	it('returns undefined and warns on truncated JSON', () => {
		const truncated = '{"serviceUrl": "https://open-vsx';
		expect(parseExtensionsGalleryEnv(truncated)).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledOnce();
	});

	it('returns undefined and warns when serviceUrl is missing (e.g. misspelled key)', () => {
		// Valid JSON, but "serviceUrls" (plural) leaves the required serviceUrl
		// unset -- previously this parsed truthy and silently disabled the gallery.
		const typo = JSON.stringify({ serviceUrls: 'https://open-vsx.org/vscode/gallery', itemUrl: '' });
		expect(parseExtensionsGalleryEnv(typo)).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledOnce();
	});

	it('returns undefined and warns on valid JSON that is not a gallery object', () => {
		// {}, [], and primitives parse cleanly but lack a serviceUrl.
		expect(parseExtensionsGalleryEnv('{}')).toBeUndefined();
		expect(parseExtensionsGalleryEnv('42')).toBeUndefined();
		expect(parseExtensionsGalleryEnv('null')).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledTimes(3);
	});

	it('returns undefined and warns on the empty string', () => {
		// product.ts guards on truthiness before calling this, so '' is unreachable
		// in practice. The helper still handles it defensively.
		expect(parseExtensionsGalleryEnv('')).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledOnce();
	});

	it('routes the failure message through the optional warn callback instead of console.warn', () => {
		// Workbench-stage callers pass `msg => logService.warn(msg)` so the warning
		// persists to the log file. Verify the callback receives the message and
		// console.warn is left untouched.
		const customWarn = vi.fn();
		const result = parseExtensionsGalleryEnv('not json', customWarn);
		expect(result).toBeUndefined();
		expect(customWarn).toHaveBeenCalledOnce();
		expect(customWarn.mock.calls[0][0]).toMatch(/Ignoring EXTENSIONS_GALLERY env var: not valid JSON/);
		expect(warnSpy).not.toHaveBeenCalled();
	});
});
