/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionGalleryManifestService } from '../../../../platform/extensionManagement/common/extensionGalleryManifest.js';
import { ExtensionGalleryManifestService } from '../../../../platform/extensionManagement/common/extensionGalleryManifestService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IRemoteAgentService } from '../../remote/common/remoteAgentService.js';

// --- Start Positron ---
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
// eslint-disable-next-line no-duplicate-imports
import { IExtensionGalleryManifest, PositronGallerySourceConfigKey } from '../../../../platform/extensionManagement/common/extensionGalleryManifest.js';
// eslint-disable-next-line no-duplicate-imports
import { ExtensionGalleryConfig, resolvePositronGalleryConfig } from '../../../../platform/extensionManagement/common/extensionGalleryManifestService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IBrowserWorkbenchEnvironmentService } from '../../environment/browser/environmentService.js';
import { IHostService } from '../../host/browser/host.js';
import { handleGallerySourceSettingChange, reportExtensionsGalleryEnv, showWindowLog } from '../common/extensionGalleryManifestEnvReporting.js';
// --- End Positron ---

// --- Start Positron ---
// Exported so the service can be unit tested directly.
// class WebExtensionGalleryManifestService extends ExtensionGalleryManifestService implements IExtensionGalleryManifestService {
export class WebExtensionGalleryManifestService extends ExtensionGalleryManifestService implements IExtensionGalleryManifestService {
// --- End Positron ---

	constructor(
		@IProductService productService: IProductService,
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
		// --- Start Positron ---
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IHostService private readonly hostService: IHostService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IBrowserWorkbenchEnvironmentService private readonly environmentService: IBrowserWorkbenchEnvironmentService,
		// --- End Positron ---
	) {
		super(productService);
		const remoteConnection = remoteAgentService.getConnection();
		if (remoteConnection) {
			const channel = remoteConnection.getChannel('extensionGalleryManifest');
			this.getExtensionGalleryManifest().then(manifest => {
				channel.call('setExtensionGalleryManifest', [manifest]);
				this._register(this.onDidChangeExtensionGalleryManifest(manifest => channel.call('setExtensionGalleryManifest', [manifest])));
			});
		}
		// --- Start Positron ---
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (!e.affectsConfiguration(PositronGallerySourceConfigKey)) {
				return;
			}
			// Re-parse and report so the user is told again if the env var is
			// malformed; only a valid env var actually overrides the setting.
			const envGallery = this.reportEnv();
			handleGallerySourceSettingChange(envGallery, this.notificationService, () => this.requestRestart());
		}));
		// --- End Positron ---
	}

	// --- Start Positron ---
	private extensionGalleryManifestPromise: Promise<IExtensionGalleryManifest | null> | undefined;

	/**
	 * Cache the manifest so getGalleryConfig() -- which reports the
	 * EXTENSIONS_GALLERY outcome to the user -- runs once rather than on every
	 * consumer call. Matches the desktop service, which caches for the same
	 * reason. A gallery source setting change prompts a reload, rebuilding this.
	 */
	override getExtensionGalleryManifest(): Promise<IExtensionGalleryManifest | null> {
		this.extensionGalleryManifestPromise ??= super.getExtensionGalleryManifest();
		return this.extensionGalleryManifestPromise;
	}

	protected override getGalleryConfig(): ExtensionGalleryConfig | undefined {
		return resolvePositronGalleryConfig(
			this.reportEnv(),
			this.configurationService.getValue<string>(PositronGallerySourceConfigKey),
			super.getGalleryConfig(),
		);
	}

	/**
	 * Parses and reports the server-forwarded EXTENSIONS_GALLERY value. The
	 * browser cannot read the server process environment, so the value is
	 * delivered through the web configuration (see IWorkbenchConstructionOptions).
	 */
	private reportEnv(): ExtensionGalleryConfig | undefined {
		return reportExtensionsGalleryEnv(
			this.environmentService.extensionsGalleryEnv,
			this.configurationService.getValue<string>(PositronGallerySourceConfigKey),
			this.logService,
			this.notificationService,
			() => showWindowLog(this.instantiationService),
		);
	}

	private async requestRestart(): Promise<void> {
		const confirmation = await this.dialogService.confirm({
			message: localize('positron.extensionGalleryManifestService.gallerySourceChange', "{0} is now configured to a different extension gallery. Please reload to apply the changes.", this.productService.nameLong),
			primaryButton: localize({ key: 'positron.reload', comment: ['&& denotes a mnemonic'] }, "&&Reload")
		});
		if (confirmation.confirmed) {
			return this.hostService.restart();
		}
	}
	// --- End Positron ---

}

registerSingleton(IExtensionGalleryManifestService, WebExtensionGalleryManifestService, InstantiationType.Delayed);
