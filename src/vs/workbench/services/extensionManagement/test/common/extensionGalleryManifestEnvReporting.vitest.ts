/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Severity } from '../../../../../platform/notification/common/notification.js';
import { ExtensionGalleryConfig } from '../../../../../platform/extensionManagement/common/extensionGalleryManifestService.js';
import { handleGallerySourceSettingChange, reportExtensionsGalleryEnv } from '../../common/extensionGalleryManifestEnvReporting.js';

function makeServices() {
	return {
		logService: { info: vi.fn(), warn: vi.fn() },
		notificationService: { notify: vi.fn() },
		openLog: vi.fn(),
	};
}

const validConfig: ExtensionGalleryConfig = {
	serviceUrl: 'https://example.com/gallery',
	itemUrl: '',
	publisherUrl: '',
	resourceUrlTemplate: '',
	extensionUrlTemplate: '',
	controlUrl: '',
	nlsBaseUrl: '',
};

describe('reportExtensionsGalleryEnv', () => {

	it('returns undefined and reports nothing when the env var is unset', () => {
		const svc = makeServices();
		expect(reportExtensionsGalleryEnv(undefined, 'open-vsx', svc.logService, svc.notificationService, svc.openLog)).toBeUndefined();
		expect(svc.logService.info).not.toHaveBeenCalled();
		expect(svc.logService.warn).not.toHaveBeenCalled();
		expect(svc.notificationService.notify).not.toHaveBeenCalled();
	});

	it('returns the parsed config and logs success when the env var is valid JSON', () => {
		const svc = makeServices();
		const envValue = JSON.stringify({ serviceUrl: 'https://example.com/gallery' });
		const result = reportExtensionsGalleryEnv(envValue, 'open-vsx', svc.logService, svc.notificationService, svc.openLog);
		expect(result?.serviceUrl).toBe('https://example.com/gallery');
		expect(svc.logService.info).toHaveBeenCalledOnce();
		expect(svc.logService.info.mock.calls[0][0]).toContain('https://example.com/gallery');
		expect(svc.logService.warn).not.toHaveBeenCalled();
		expect(svc.notificationService.notify).not.toHaveBeenCalled();
	});

	it('returns undefined and warns + notifies when the env var is malformed JSON', () => {
		const svc = makeServices();
		const result = reportExtensionsGalleryEnv('not-json', 'open-vsx', svc.logService, svc.notificationService, svc.openLog);
		expect(result).toBeUndefined();
		expect(svc.logService.warn).toHaveBeenCalledOnce();
		expect(svc.logService.info).not.toHaveBeenCalled();
		expect(svc.notificationService.notify).toHaveBeenCalledOnce();

		const notification = svc.notificationService.notify.mock.calls[0][0];
		expect(notification.severity).toBe(Severity.Warning);
		expect(notification.message).toContain('positron.extensions.gallerySource');
		expect(notification.message).toContain('open-vsx');
	});

	it('wires the malformed-env notification action to open the log', () => {
		const svc = makeServices();
		reportExtensionsGalleryEnv('not-json', 'open-vsx', svc.logService, svc.notificationService, svc.openLog);

		const notification = svc.notificationService.notify.mock.calls[0][0];
		notification.actions?.primary?.[0].run();
		expect(svc.openLog).toHaveBeenCalledOnce();
	});
});

describe('handleGallerySourceSettingChange', () => {

	it('notifies and skips the restart when a valid env gallery overrides the setting', () => {
		const notificationService = { info: vi.fn() };
		const requestRestart = vi.fn();
		handleGallerySourceSettingChange(validConfig, notificationService, requestRestart);
		expect(notificationService.info).toHaveBeenCalledOnce();
		expect(requestRestart).not.toHaveBeenCalled();
	});

	it('requests a restart and does not notify when there is no valid env gallery (unset or malformed)', () => {
		const notificationService = { info: vi.fn() };
		const requestRestart = vi.fn();
		handleGallerySourceSettingChange(undefined, notificationService, requestRestart);
		expect(requestRestart).toHaveBeenCalledOnce();
		expect(notificationService.info).not.toHaveBeenCalled();
	});
});
