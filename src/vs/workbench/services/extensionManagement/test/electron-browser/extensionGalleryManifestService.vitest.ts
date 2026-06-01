/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { reportExtensionsGalleryEnv } from '../../electron-browser/extensionGalleryManifestService.js';

function makeServices() {
	return {
		logService: { info: vi.fn(), warn: vi.fn() },
		notificationService: { warn: vi.fn() },
	};
}

describe('reportExtensionsGalleryEnv', () => {

	it('returns undefined and reports nothing when the env var is unset', () => {
		const svc = makeServices();
		expect(reportExtensionsGalleryEnv(undefined, svc.logService, svc.notificationService)).toBeUndefined();
		expect(svc.logService.info).not.toHaveBeenCalled();
		expect(svc.logService.warn).not.toHaveBeenCalled();
		expect(svc.notificationService.warn).not.toHaveBeenCalled();
	});

	it('returns the parsed config and logs success when the env var is valid JSON', () => {
		const svc = makeServices();
		const envValue = JSON.stringify({ serviceUrl: 'https://example.com/gallery' });
		const result = reportExtensionsGalleryEnv(envValue, svc.logService, svc.notificationService);
		expect(result?.serviceUrl).toBe('https://example.com/gallery');
		expect(svc.logService.info).toHaveBeenCalledOnce();
		expect(svc.logService.info.mock.calls[0][0]).toContain('https://example.com/gallery');
		expect(svc.logService.warn).not.toHaveBeenCalled();
		expect(svc.notificationService.warn).not.toHaveBeenCalled();
	});

	it('returns undefined and notifies + logs when the env var is malformed JSON', () => {
		const svc = makeServices();
		const result = reportExtensionsGalleryEnv('not-json', svc.logService, svc.notificationService);
		expect(result).toBeUndefined();
		expect(svc.logService.warn).toHaveBeenCalledOnce();
		expect(svc.notificationService.warn).toHaveBeenCalledOnce();
		expect(svc.logService.info).not.toHaveBeenCalled();
	});
});
