/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { IHeaders } from '../../../../base/parts/request/common/request.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IExtensionGalleryManifestService, IExtensionGalleryManifest, ExtensionGalleryServiceUrlConfigKey, ExtensionGalleryManifestStatus } from '../../../../platform/extensionManagement/common/extensionGalleryManifest.js';
import { ExtensionGalleryManifestService } from '../../../../platform/extensionManagement/common/extensionGalleryManifestService.js';
import { resolveMarketplaceHeaders } from '../../../../platform/externalServices/common/marketplace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ISharedProcessService } from '../../../../platform/ipc/electron-browser/services.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { IRemoteAgentService } from '../../remote/common/remoteAgentService.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHostService } from '../../host/browser/host.js';
import { IDefaultAccount } from '../../../../base/common/defaultAccount.js';

// --- Start Positron ---
import { env } from '../../../../base/common/process.js';
import { toAction } from '../../../../base/common/actions.js';
import { showWindowLogActionId } from '../../../services/log/common/logConstants.js';
// eslint-disable-next-line no-duplicate-imports
import { PositronGallerySourceConfigKey } from '../../../../platform/extensionManagement/common/extensionGalleryManifest.js';
// eslint-disable-next-line no-duplicate-imports
import { ExtensionGalleryConfig, resolvePositronGalleryConfig } from '../../../../platform/extensionManagement/common/extensionGalleryManifestService.js';
import { parseExtensionsGalleryEnv } from '../../../../platform/extensionManagement/common/extensionsGalleryEnv.js';

/**
 * Parses the EXTENSIONS_GALLERY env var and reports the outcome to the user:
 * a warning notification + log on parse failure, an info log on success.
 * Exported for unit testing -- the host class wires services in.
 */
export function reportExtensionsGalleryEnv(
	envValue: string | undefined,
	gallerySource: string | undefined,
	logService: Pick<ILogService, 'info' | 'warn'>,
	notificationService: Pick<INotificationService, 'notify'>,
	openLog: () => void,
): ExtensionGalleryConfig | undefined {
	if (!envValue) {
		return undefined;
	}
	const parsed = parseExtensionsGalleryEnv<ExtensionGalleryConfig>(envValue, msg => {
		logService.warn(msg);
		notificationService.notify({
			severity: Severity.Warning,
			message: localize(
				'positron.extensionsGallery.envInvalid',
				"The EXTENSIONS_GALLERY environment variable is set but is not valid. The extension gallery source setting (positron.extensions.gallerySource), currently \"{0}\", will be used instead. See the log for details.",
				gallerySource ?? ''),
			actions: {
				primary: [
					toAction({
						id: 'positron.extensionsGallery.showLog',
						label: localize('positron.extensionsGallery.showLog', "Show Window Log"),
						run: () => openLog(),
					})
				]
			}
		});
	});
	if (parsed) {
		logService.info(`[Marketplace] Using extension gallery from EXTENSIONS_GALLERY env var: ${parsed.serviceUrl}`);
	}
	return parsed;
}

/**
 * Decides what happens when the Positron gallery source setting changes. Only a
 * successfully-parsed EXTENSIONS_GALLERY env var overrides the setting, so notify
 * the user that the change won't take effect and skip the restart prompt in that
 * case; otherwise (env var unset or malformed) the setting applies, so request a
 * restart. Exported for unit testing -- the host class wires services in.
 */
export function handleGallerySourceSettingChange(
	envGallery: ExtensionGalleryConfig | undefined,
	notificationService: Pick<INotificationService, 'info'>,
	requestRestart: () => void,
): void {
	if (envGallery) {
		notificationService.info(localize(
			'positron.extensionsGallery.settingIgnoredByEnv',
			"The EXTENSIONS_GALLERY environment variable is set and overrides the extension gallery source setting. Unset the environment variable for this setting to take effect."));
		return;
	}
	requestRestart();
}
// --- End Positron ---

export class WorkbenchExtensionGalleryManifestService extends ExtensionGalleryManifestService implements IExtensionGalleryManifestService {

	private readonly commonHeadersPromise: Promise<IHeaders>;
	private extensionGalleryManifest: IExtensionGalleryManifest | null = null;

	private _onDidChangeExtensionGalleryManifest = this._register(new Emitter<IExtensionGalleryManifest | null>());
	override readonly onDidChangeExtensionGalleryManifest = this._onDidChangeExtensionGalleryManifest.event;

	private currentStatus: ExtensionGalleryManifestStatus = ExtensionGalleryManifestStatus.Unavailable;
	override get extensionGalleryManifestStatus(): ExtensionGalleryManifestStatus { return this.currentStatus; }
	private _onDidChangeExtensionGalleryManifestStatus = this._register(new Emitter<ExtensionGalleryManifestStatus>());
	override readonly onDidChangeExtensionGalleryManifestStatus = this._onDidChangeExtensionGalleryManifestStatus.event;

	constructor(
		@IProductService productService: IProductService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IFileService fileService: IFileService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
		@ISharedProcessService sharedProcessService: ISharedProcessService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IRequestService private readonly requestService: IRequestService,
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
		@ILogService private readonly logService: ILogService,
		@IDialogService private readonly dialogService: IDialogService,
		@IHostService private readonly hostService: IHostService,
		@INotificationService private readonly notificationService: INotificationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(productService);
		this.commonHeadersPromise = resolveMarketplaceHeaders(
			productService.version,
			productService,
			environmentService,
			configurationService,
			fileService,
			storageService,
			telemetryService);

		const channels = [sharedProcessService.getChannel('extensionGalleryManifest')];
		const remoteConnection = remoteAgentService.getConnection();
		if (remoteConnection) {
			channels.push(remoteConnection.getChannel('extensionGalleryManifest'));
		}
		this.getExtensionGalleryManifest().then(manifest => {
			channels.forEach(channel => channel.call('setExtensionGalleryManifest', [manifest]));
		});
	}

	// --- Start Positron ---
	protected override getGalleryConfig(): ExtensionGalleryConfig | undefined {
		const gallerySource = this.configurationService.getValue<string>(PositronGallerySourceConfigKey);
		const envGallery = reportExtensionsGalleryEnv(
			env['EXTENSIONS_GALLERY'],
			gallerySource,
			this.logService,
			this.notificationService,
			() => this.showWindowLog(),
		);
		return resolvePositronGalleryConfig(
			envGallery,
			gallerySource,
			super.getGalleryConfig(),
		);
	}

	/**
	 * Reveals the Window log channel. ICommandService is resolved lazily rather
	 * than injected because this service sits below the command-service layer in
	 * the DI graph (commandService -> extensionService -> extensionGalleryService
	 * -> this service); injecting it directly forms a cyclic dependency.
	 */
	private showWindowLog(): void {
		this.instantiationService.invokeFunction(accessor => accessor.get(ICommandService).executeCommand(showWindowLogActionId));
	}
	// --- End Positron ---

	private extensionGalleryManifestPromise: Promise<void> | undefined;
	override async getExtensionGalleryManifest(): Promise<IExtensionGalleryManifest | null> {
		if (!this.extensionGalleryManifestPromise) {
			this.extensionGalleryManifestPromise = this.doGetExtensionGalleryManifest();
		}
		await this.extensionGalleryManifestPromise;
		return this.extensionGalleryManifest;
	}

	private async doGetExtensionGalleryManifest(): Promise<void> {
		const defaultServiceUrl = this.productService.extensionsGallery?.serviceUrl;
		if (!defaultServiceUrl) {
			return;
		}

		const configuredServiceUrl = this.configurationService.getValue<string>(ExtensionGalleryServiceUrlConfigKey);
		if (configuredServiceUrl) {
			await this.handleDefaultAccountAccess(configuredServiceUrl);
			this._register(this.defaultAccountService.onDidChangeDefaultAccount(() => this.handleDefaultAccountAccess(configuredServiceUrl)));
		} else {
			const defaultExtensionGalleryManifest = await super.getExtensionGalleryManifest();
			this.update(defaultExtensionGalleryManifest);
		}

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			// --- Start Positron ---
			if (e.affectsConfiguration(PositronGallerySourceConfigKey)) {
				// Re-parse and report so the user is told again if the env var is
				// malformed; only a valid env var actually overrides the setting.
				const envGallery = reportExtensionsGalleryEnv(
					env['EXTENSIONS_GALLERY'],
					this.configurationService.getValue<string>(PositronGallerySourceConfigKey),
					this.logService,
					this.notificationService,
					() => this.showWindowLog(),
				);
				handleGallerySourceSettingChange(envGallery, this.notificationService, () => this.requestRestart());
				return;
			}
			// --- End Positron ---
			if (!e.affectsConfiguration(ExtensionGalleryServiceUrlConfigKey)) {
				return;
			}
			this.requestRestart();
		}));
	}

	private async handleDefaultAccountAccess(configuredServiceUrl: string): Promise<void> {
		const account = await this.defaultAccountService.getDefaultAccount();

		if (!account) {
			this.logService.debug('[Marketplace] Enterprise marketplace configured but user not signed in');
			this.update(null, ExtensionGalleryManifestStatus.RequiresSignIn);
		} else if (!this.checkAccess(account)) {
			this.logService.debug('[Marketplace] User signed in but lacks access to enterprise marketplace');
			this.update(null, ExtensionGalleryManifestStatus.AccessDenied);
		} else if (this.currentStatus !== ExtensionGalleryManifestStatus.Available) {
			try {
				const manifest = await this.getExtensionGalleryManifestFromServiceUrl(configuredServiceUrl);
				this.update(manifest);
				this.telemetryService.publicLog2<
					{},
					{
						owner: 'sandy081';
						comment: 'Reports when a user successfully accesses a custom marketplace';
					}>('galleryservice:custom:marketplace');
			} catch (error) {
				this.logService.error('[Marketplace] Error retrieving enterprise gallery manifest', error);
				this.update(null, ExtensionGalleryManifestStatus.AccessDenied);
			}
		}
	}

	private update(manifest: IExtensionGalleryManifest | null, status?: ExtensionGalleryManifestStatus): void {
		if (this.extensionGalleryManifest !== manifest) {
			this.extensionGalleryManifest = manifest;
			this._onDidChangeExtensionGalleryManifest.fire(manifest);
		}
		this.updateStatus(status ?? (this.extensionGalleryManifest ? ExtensionGalleryManifestStatus.Available : ExtensionGalleryManifestStatus.Unavailable));
	}

	private updateStatus(status: ExtensionGalleryManifestStatus): void {
		if (this.currentStatus !== status) {
			this.currentStatus = status;
			this._onDidChangeExtensionGalleryManifestStatus.fire(status);
		}
	}

	private checkAccess(account: IDefaultAccount): boolean {
		this.logService.debug('[Marketplace] Checking Account SKU access for configured gallery', account.entitlementsData?.access_type_sku);
		if (account.entitlementsData?.access_type_sku && this.productService.extensionsGallery?.accessSKUs?.includes(account.entitlementsData.access_type_sku)) {
			this.logService.debug('[Marketplace] Account has access to configured gallery');
			return true;
		}
		this.logService.debug('[Marketplace] Checking enterprise account access for configured gallery', account.enterprise);
		return account.enterprise;
	}

	private async requestRestart(): Promise<void> {
		const confirmation = await this.dialogService.confirm({
			message: localize('extensionGalleryManifestService.accountChange', "{0} is now configured to a different Marketplace. Please restart to apply the changes.", this.productService.nameLong),
			primaryButton: localize({ key: 'restart', comment: ['&& denotes a mnemonic'] }, "&&Restart")
		});
		if (confirmation.confirmed) {
			return this.hostService.restart();
		}
	}

	private async getExtensionGalleryManifestFromServiceUrl(url: string): Promise<IExtensionGalleryManifest> {
		const commonHeaders = await this.commonHeadersPromise;
		const headers = {
			...commonHeaders,
			'Content-Type': 'application/json',
			'Accept-Encoding': 'gzip',
		};

		try {
			const context = await this.requestService.request({
				type: 'GET',
				url,
				headers,
				callSite: 'extensionGalleryManifestService.fetchManifest'
			}, CancellationToken.None);

			const extensionGalleryManifest = await asJson<IExtensionGalleryManifest>(context);

			if (!extensionGalleryManifest) {
				throw new Error('Unable to retrieve extension gallery manifest.');
			}

			return extensionGalleryManifest;
		} catch (error) {
			this.logService.error('[Marketplace] Error retrieving extension gallery manifest', error);
			throw error;
		}
	}
}

registerSingleton(IExtensionGalleryManifestService, WorkbenchExtensionGalleryManifestService, InstantiationType.Eager);
