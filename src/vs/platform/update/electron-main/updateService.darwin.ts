/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as electron from 'electron';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { memoize } from '../../../base/common/decorators.js';
import { Event } from '../../../base/common/event.js';
import { hash } from '../../../base/common/hash.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, DisablementReason, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
// --- Start Positron ---
// removed unused import
import { AbstractUpdateService, createUpdateURL, getUpdateRequestHeaders, UpdateErrorClassification } from './abstractUpdateService.js';
// --- End Positron ---
import { INodeProcess } from '../../../base/common/platform.js';

// --- Start Positron ---
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';
import { IStateService } from '../../state/node/state.js';
import { arch } from 'os';
// --- End Positron ---

export class DarwinUpdateService extends AbstractUpdateService implements IRelaunchHandler {

	private readonly disposables = new DisposableStore();

	@memoize private get onRawError(): Event<string> { return Event.fromNodeEventEmitter(electron.autoUpdater, 'error', (_, message) => message); }
	@memoize private get onRawCheckingForUpdate(): Event<void> { return Event.fromNodeEventEmitter<void>(electron.autoUpdater, 'checking-for-update'); }
	@memoize private get onRawUpdateNotAvailable(): Event<void> { return Event.fromNodeEventEmitter<void>(electron.autoUpdater, 'update-not-available'); }
	@memoize private get onRawUpdateAvailable(): Event<void> { return Event.fromNodeEventEmitter(electron.autoUpdater, 'update-available'); }
	@memoize private get onRawUpdateDownloaded(): Event<IUpdate> {
		return Event.fromNodeEventEmitter(electron.autoUpdater, 'update-downloaded', (_, version: string, productVersion: string, releaseDate: Date | number) => ({
			version,
			productVersion,
			timestamp: releaseDate instanceof Date ? releaseDate.getTime() || undefined : releaseDate
		}));
	}

	// --- Start Positron ---
	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IProductService productService: IProductService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
		@INativeHostMainService nativeHostMainService: INativeHostMainService,
		@IStateService stateService: IStateService
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, meteredConnectionService, productService, nativeHostMainService, stateService, true);
		// --- End Positron ---

		lifecycleMainService.setRelaunchHandler(this);
	}
	// --- End Positron ---

	handleRelaunch(options?: IRelaunchOptions): boolean {
		if (options?.addArgs || options?.removeArgs) {
			return false; // we cannot apply an update and restart with different args
		}

		if (this.state.type !== StateType.Ready) {
			return false; // we only handle the relaunch when we have a pending update
		}

		this.logService.trace('update#handleRelaunch(): running raw#quitAndInstall()');
		this.doQuitAndInstall();

		return true;
	}

	protected override async initialize(): Promise<void> {
		if ((process as INodeProcess).isEmbeddedApp) {
			this.setState(State.Disabled(DisablementReason.EmbeddedApp));
			this.logService.info('update#ctor - updates are disabled from embedded app');
			return;
		}

		await super.initialize();
		this.onRawError(this.onError, this, this.disposables);
		this.onRawCheckingForUpdate(this.onCheckingForUpdate, this, this.disposables);
		this.onRawUpdateAvailable(this.onUpdateAvailable, this, this.disposables);
		this.onRawUpdateDownloaded(this.onUpdateDownloaded, this, this.disposables);
		this.onRawUpdateNotAvailable(this.onUpdateNotAvailable, this, this.disposables);
	}

	private onCheckingForUpdate(): void {
		this.logService.trace('update#onCheckingForUpdate - Electron autoUpdater is checking for updates');
	}

	private onError(err: string): void {
		this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
		this.logService.error('UpdateService error:', err);

		// only show message when explicitly checking for updates
		const message = (this.state.type === StateType.CheckingForUpdates && this.state.explicit) ? err : undefined;
		this.setState(State.Idle(UpdateType.Archive, message));
	}

	//--- Start Positron ---
	// building our update feed URL is simpler than upstream
	protected buildUpdateFeedUrl(channel: string): string | undefined {
		// Always use automatic architecture detection
		const platform = 'mac/' + arch();
		const url = createUpdateURL(platform, channel, this.productService) + '/releases.json';
		try {
			electron.autoUpdater.setFeedURL({ url: url });
		} catch (e) {
			// application is very likely not signed
			this.logService.error('Failed to set update feed URL', e);
			return undefined;
		}
		return url;
	}
	// --- End Positron ---

	// Unused for Positron
	protected doCheckForUpdates(explicit: boolean): void {
		if (!this.url) {
			return;
		}

		this.setState(State.CheckingForUpdates(explicit));

		const internalOrg = this.getInternalOrg();
		const background = !explicit && !internalOrg;

		// --- Start Positron ---
		const channel = this.getUpdateChannel();
		const url = this.buildUpdateFeedUrl(channel);
		// const url = this.buildUpdateFeedUrl(this.quality, pendingCommit ?? this.productService.commit!, { background, internalOrg });
		// --- End Positron ---

		if (!url) {
			return;
		}

		// When connection is metered and this is not an explicit check, avoid electron call as to not to trigger auto-download.
		if (!explicit && this.meteredConnectionService.isConnectionMetered) {
			this.logService.info('update#doCheckForUpdates - checking for update without auto-download because connection is metered');
			this.checkForUpdateNoDownload(url);
			return;
		}

		this.logService.trace('update#doCheckForUpdates - using Electron autoUpdater', { url, explicit, background });
		electron.autoUpdater.checkForUpdates();
	}

	// --- Start Positron ---
	/**
	 * Manually check for updates and call Electron to install the update if an update is available.
	 */
	protected override updateAvailable(update: IUpdate): void {
		if (!update.url || !update.version) {
			this.setState(State.Idle(UpdateType.Archive));
			return;
		}

		if (!this.enableAutoUpdate) {
			super.updateAvailable(update);
		} else {
			// We cannot avoid Electron checking the URL again with this call. Electron can only check against
			// the app version, which is VS Code's version.
			electron.autoUpdater.checkForUpdates();
		}
	}
	//--- End Positron ---

	/**
	 * Manually check the update feed URL without triggering Electron's auto-download.
	 * Used when connection is metered to show update availability without downloading.
	 */
	private async checkForUpdateNoDownload(url: string): Promise<void> {
		const headers = getUpdateRequestHeaders(this.productService.version);
		this.logService.trace('update#checkForUpdateNoDownload - checking update server', { url, headers });

		try {
			const context = await this.requestService.request({ url, headers }, CancellationToken.None);
			const statusCode = context.res.statusCode;
			this.logService.trace('update#checkForUpdateNoDownload - response', { statusCode });

			const update = await asJson<IUpdate>(context);
			if (!update || !update.url || !update.version || !update.productVersion) {
				this.logService.trace('update#checkForUpdateNoDownload - no update available');
				this.setState(State.Idle(UpdateType.Archive));
			} else {
				this.logService.trace('update#checkForUpdateNoDownload - update available', { version: update.version, productVersion: update.productVersion });
				this.setState(State.AvailableForDownload(update));
			}
		} catch (err) {
			this.logService.error('update#checkForUpdateNoDownload - failed to check for update', err);
			this.setState(State.Idle(UpdateType.Archive));
		}
	}

	private onUpdateAvailable(): void {
		this.logService.trace('update#onUpdateAvailable - Electron autoUpdater reported update available');

		if (this.state.type !== StateType.CheckingForUpdates && this.state.type !== StateType.Overwriting) {
			return;
		}

		this.setState(State.Downloading(this.state.type === StateType.Overwriting ? this.state.update : undefined, this.state.explicit, this._overwrite));
	}

	private onUpdateDownloaded(update: IUpdate): void {
		if (this.state.type !== StateType.Downloading) {
			return;
		}

		this.setState(State.Downloaded(update, false, false));

		type UpdateDownloadedClassification = {
			owner: 'joaomoreno';
			newVersion: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The version number of the new VS Code that has been downloaded.' };
			comment: 'This is used to know how often VS Code has successfully downloaded the update.';
		};
		this.telemetryService.publicLog2<{ newVersion: String }, UpdateDownloadedClassification>('update:downloaded', { newVersion: update.version });

		this.setState(State.Ready(update, false, false));
	}

	private onUpdateNotAvailable(): void {
		this.logService.trace('update#onUpdateNotAvailable - Electron autoUpdater reported no update available');

		if (this.state.type !== StateType.CheckingForUpdates) {
			return;
		}

		this.setState(State.Idle(UpdateType.Archive));
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		// Rebuild feed URL and trigger download via Electron's auto-updater
		// --- Start Positron ---
		this.buildUpdateFeedUrl(this.getUpdateChannel());
		// this.buildUpdateFeedUrl(this.quality!, state.update.version, { internalOrg: this.getInternalOrg() });
		// --- End Positron ---
		this.setState(State.CheckingForUpdates(true));
		electron.autoUpdater.checkForUpdates();
	}

	protected override doQuitAndInstall(): void {
		this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');
		electron.autoUpdater.quitAndInstall();
	}

	dispose(): void {
		this.disposables.dispose();
	}
}
