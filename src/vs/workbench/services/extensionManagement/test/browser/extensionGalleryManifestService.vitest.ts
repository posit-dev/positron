/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ExtensionGalleryResourceType, PositronGallerySourceConfigKey, getExtensionGalleryManifestResourceUri } from '../../../../../platform/extensionManagement/common/extensionGalleryManifest.js';
import { ExtensionGalleryConfig, POSITRON_GALLERY_PRESETS } from '../../../../../platform/extensionManagement/common/extensionGalleryManifestService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IBrowserWorkbenchEnvironmentService } from '../../../environment/browser/environmentService.js';
import { IHostService } from '../../../host/browser/host.js';
import { IRemoteAgentService } from '../../../remote/common/remoteAgentService.js';
import { WebExtensionGalleryManifestService } from '../../browser/extensionGalleryManifestService.js';

// The server's product.json default gallery, forwarded to the browser as
// product.extensionsGallery. Distinct serviceUrl so it's easy to tell apart
// from the env var and the presets in assertions.
const productGallery: ExtensionGalleryConfig = {
	serviceUrl: 'https://product.example.com/gallery',
	itemUrl: '',
	publisherUrl: '',
	resourceUrlTemplate: '',
	extensionUrlTemplate: '',
	controlUrl: '',
	nlsBaseUrl: '',
};

const validEnv = JSON.stringify({ serviceUrl: 'https://env.example.com/gallery' });

describe('WebExtensionGalleryManifestService', () => {

	const disposables = ensureNoLeakedDisposables();

	function createService(opts: { env?: string; gallerySource?: string; confirmReload?: boolean } = {}) {
		const onDidChangeConfiguration = disposables.add(new Emitter<IConfigurationChangeEvent>());
		const logService = new NullLogService();
		const notificationService = stubInterface<INotificationService>({ notify: vi.fn(), info: vi.fn() });
		const dialogService = stubInterface<IDialogService>({ confirm: vi.fn().mockResolvedValue({ confirmed: opts.confirmReload ?? false }) });
		const hostService = stubInterface<IHostService>({ restart: vi.fn() });
		const instantiationService = stubInterface<IInstantiationService>({ invokeFunction: vi.fn() });
		const environmentService = stubInterface<IBrowserWorkbenchEnvironmentService>({ extensionsGalleryEnv: opts.env });
		const configurationService = stubInterface<IConfigurationService>({
			getValue: () => opts.gallerySource,
			onDidChangeConfiguration: onDidChangeConfiguration.event,
		});
		const productService = stubInterface<IProductService>({ extensionsGallery: productGallery, nameLong: 'Positron' });
		const remoteAgentService = stubInterface<IRemoteAgentService>({ getConnection: () => null });

		const service = disposables.add(new WebExtensionGalleryManifestService(
			productService, remoteAgentService, configurationService, logService,
			notificationService, dialogService, hostService, instantiationService, environmentService));

		const fireSettingChange = () => onDidChangeConfiguration.fire(
			stubInterface<IConfigurationChangeEvent>({ affectsConfiguration: (key: string): boolean => key === PositronGallerySourceConfigKey }));

		return { service, notificationService, dialogService, hostService, logService, fireSettingChange };
	}

	async function queryUrl(service: WebExtensionGalleryManifestService): Promise<string | undefined> {
		const manifest = await service.getExtensionGalleryManifest();
		return manifest ? getExtensionGalleryManifestResourceUri(manifest, ExtensionGalleryResourceType.ExtensionQueryService) : undefined;
	}

	describe('gallery resolution (env > setting > product default)', () => {

		it('uses the server-forwarded EXTENSIONS_GALLERY value, overriding the setting', async () => {
			const { service } = createService({ env: validEnv, gallerySource: 'open-vsx' });
			expect(await queryUrl(service)).toBe('https://env.example.com/gallery/extensionquery');
		});

		it('uses the gallerySource preset when the env var is unset', async () => {
			const { service } = createService({ gallerySource: 'open-vsx' });
			expect(await queryUrl(service)).toBe(`${POSITRON_GALLERY_PRESETS['open-vsx'].serviceUrl}/extensionquery`);
		});

		it('falls back to the product default when the env var is unset and the setting is unknown', async () => {
			const { service } = createService({ gallerySource: 'not-a-preset' });
			expect(await queryUrl(service)).toBe('https://product.example.com/gallery/extensionquery');
		});

		it('ignores a malformed env var and uses the gallerySource preset', async () => {
			const { service, notificationService } = createService({ env: 'not-json', gallerySource: 'open-vsx' });
			expect(await queryUrl(service)).toBe(`${POSITRON_GALLERY_PRESETS['open-vsx'].serviceUrl}/extensionquery`);
			// The invalid env var is surfaced to the user.
			expect(notificationService.notify).toHaveBeenCalledOnce();
		});

		it('reports the env outcome once even across repeated manifest requests', async () => {
			const { service, logService } = createService({ env: validEnv, gallerySource: 'open-vsx' });
			const infoSpy = vi.spyOn(logService, 'info');
			await queryUrl(service);
			await queryUrl(service);
			expect(infoSpy).toHaveBeenCalledOnce();
		});
	});

	describe('gallery source setting change', () => {

		it('prompts to reload when there is no env override', () => {
			const { dialogService, fireSettingChange } = createService({ gallerySource: 'open-vsx' });
			fireSettingChange();
			expect(dialogService.confirm).toHaveBeenCalledOnce();
		});

		it('notifies that the env var wins and does not prompt to reload when the env var is set', () => {
			const { dialogService, notificationService, fireSettingChange } = createService({ env: validEnv, gallerySource: 'open-vsx' });
			fireSettingChange();
			expect(notificationService.info).toHaveBeenCalledOnce();
			expect(dialogService.confirm).not.toHaveBeenCalled();
		});
	});
});
