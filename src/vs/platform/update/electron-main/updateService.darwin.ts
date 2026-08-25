/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as electron from 'electron';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { memoize } from '../../../base/common/decorators.js';
import { Event } from '../../../base/common/event.js';
import { hash } from '../../../base/common/hash.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
// --- Start Positron ---
// removed unused import IUpdateURLOptions
import { AbstractUpdateService, createUpdateURL, getUpdateRequestHeaders, UpdateErrorClassification } from './abstractUpdateService.js';
// --- End Positron ---

// --- Start Positron ---
import { hasUpdate } from '../common/positronVersion.js';
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';
import { IStateService } from '../../state/node/state.js';
import { arch } from 'os';
// --- End Positron ---

export class DarwinUpdateService extends AbstractUpdateService implements IRelaunchHandler {

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
		@ITelemetryService telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IProductService productService: IProductService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
		@INativeHostMainService nativeHostMainService: INativeHostMainService,
		@IStateService stateService: IStateService
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, telemetryService, applicationStorageMainService, meteredConnectionService, productService, nativeHostMainService, stateService, true);

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
		await super.initialize();

		this.onRawError(this.onError, this, this._store);
		this.onRawCheckingForUpdate(this.onCheckingForUpdate, this, this._store);
		this.onRawUpdateAvailable(this.onUpdateAvailable, this, this._store);
		this.onRawUpdateDownloaded(this.onUpdateDownloaded, this, this._store);
		this.onRawUpdateNotAvailable(this.onUpdateNotAvailable, this, this._store);
	}

	private onCheckingForUpdate(): void {
		this.logService.trace('update#onCheckingForUpdate - Electron autoUpdater is checking for updates');
	}

	private onError(err: string): void {
		this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
		this.logService.error('UpdateService error:', err);

		// Only react while actively checking/downloading; a late error must not clobber Disabled or Ready.
		if (this.state.type !== StateType.CheckingForUpdates && this.state.type !== StateType.Downloading && this.state.type !== StateType.Overwriting) {
			return;
		}

		// --- Start Positron ---
		// A failed overwrite check must not cost the user the update that is already staged.
		if (this.state.type === StateType.Overwriting) {
			this.restorePendingUpdate(this.state.update, this.state.explicit);
			return;
		}
		// --- End Positron ---

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

	protected doCheckForUpdates(explicit: boolean, pendingCommit?: string): void {
		// --- Start Positron ---
		// Positron gates on `this.url` rather than `this.quality`, and uses `pendingCommit` to verify
		// the feed itself (see below) rather than to build the feed URL.
		if (!this.url) {
			// --- End Positron ---
			return;
		}

		// --- Start Positron ---
		// Don't clobber `Overwriting`: `checkForOverwriteUpdates` sets it immediately before calling
		// this, and the rest of the overwrite flow keys off it (win32 guards the same way). Without
		// the guard the state machine falls back to `Idle` on the next `update-not-available`, losing
		// the pending update with no way back to it.
		// this.setState(State.CheckingForUpdates(explicit));
		if (this.state.type !== StateType.Overwriting) {
			this.setState(State.CheckingForUpdates(explicit));
		}
		// --- End Positron ---

		const internalOrg = this.getInternalOrg();
		const background = !explicit && !internalOrg;

		// --- Start Positron ---
		const channel = this.getUpdateChannel();
		const url = this.buildUpdateFeedUrl(channel);
		// const url = this.buildUpdateFeedUrl(this.quality, pendingCommit ?? this.productService.commit!, { background, internalOrg });
		// --- End Positron ---

		if (!url) {
			// --- Start Positron ---
			if (this.state.type === StateType.Overwriting) {
				this.restorePendingUpdate(this.state.update, this.state.explicit);
				return;
			}
			// --- End Positron ---
			this.setState(State.Idle(UpdateType.Archive));
			return;
		}

		// --- Start Positron ---
		// Electron's auto-updater can only compare the feed against the *installed* version, and
		// Positron's feed always returns the latest release rather than answering "no content" for an
		// up-to-date version like upstream's server does. So an overwrite check has to verify the feed
		// itself before handing off to Electron, or a race with the `isLatestVersion` pre-check in
		// `checkForOverwriteUpdates` re-downloads the build that is already staged. This is the darwin
		// equivalent of the `hasUpdate` guard in `updateService.win32.ts`.
		if (this.state.type === StateType.Overwriting && pendingCommit) {
			this.checkForOverwriteDownload(url, pendingCommit);
			return;
		}
		// --- End Positron ---

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

	// --- Start Positron ---
	/**
	 * Verify that the feed really does advertise something newer than the pending update before
	 * letting Electron download it. Restores the pending update when it does not.
	 */
	private async checkForOverwriteDownload(url: string, pendingCommit: string): Promise<void> {
		if (this.state.type !== StateType.Overwriting) {
			return;
		}

		const pendingUpdate = this.state.update;
		const explicit = this.state.explicit;
		const headers = getUpdateRequestHeaders(this.productService.version);

		try {
			const context = await this.requestService.request({ url, headers, callSite: 'updateService.darwin.checkForOverwriteDownload' }, CancellationToken.None);
			const update = await asJson<IUpdate>(context);

			if (update && update.url && update.version && update.productVersion && hasUpdate(update, pendingCommit)) {
				this.logService.trace('update#checkForOverwriteDownload - newer update confirmed, downloading', { version: update.version });
				electron.autoUpdater.checkForUpdates();
				return;
			}

			this.logService.info('update#checkForOverwriteDownload - the feed no longer advertises a newer update, restoring the pending update');
		} catch (err) {
			this.logService.error('update#checkForOverwriteDownload - failed to check for update', err);
		}

		this.restorePendingUpdate(pendingUpdate, explicit);
	}

	/**
	 * Abandon an overwrite check and go back to advertising the update that was already staged.
	 * Unlike win32 there is nothing to re-stage: the pending update lives inside Electron's
	 * auto-updater, and `cancelPendingUpdate()` is a no-op on macOS, so it is still installable.
	 */
	private restorePendingUpdate(update: IUpdate, explicit: boolean): void {
		this._overwrite = false;
		this.setState(State.Ready(update, explicit, false));
	}
	// --- End Positron ---

	/**
	 * Manually check the update feed URL without triggering Electron's auto-download.
	 * Used when connection is metered or in the embedded app.
	 * @param canInstall When false, signals that the update cannot be installed from this app.
	 */
	private async checkForUpdateNoDownload(url: string, canInstall?: boolean): Promise<void> {
		const headers = getUpdateRequestHeaders(this.productService.version);
		this.logService.trace('update#checkForUpdateNoDownload - checking update server', { url, headers });

		try {
			const context = await this.requestService.request({ url, headers, callSite: 'updateService.darwin.checkForUpdates' }, CancellationToken.None);
			const statusCode = context.res.statusCode;
			this.logService.trace('update#checkForUpdateNoDownload - response', { statusCode });

			const update = await asJson<IUpdate>(context);
			if (!update || !update.url || !update.version || !update.productVersion) {
				this.logService.trace('update#checkForUpdateNoDownload - no update available');
				const notAvailable = this.state.type === StateType.CheckingForUpdates && this.state.explicit;
				this.setState(State.Idle(UpdateType.Archive, undefined, notAvailable || undefined));
			} else {
				this.logService.trace('update#checkForUpdateNoDownload - update available', { version: update.version, productVersion: update.productVersion });
				this.setState(State.AvailableForDownload(update, canInstall));
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

		this.setState(State.Downloaded(update, this.state.explicit, this._overwrite));
		this.logService.info(`Update downloaded: ${JSON.stringify(update)}`);

		this.setState(State.Ready(update, this.state.explicit, this._overwrite));
	}

	private onUpdateNotAvailable(): void {
		this.logService.trace('update#onUpdateNotAvailable - Electron autoUpdater reported no update available');

		// --- Start Positron ---
		if (this.state.type === StateType.Overwriting) {
			this.restorePendingUpdate(this.state.update, this.state.explicit);
			return;
		}
		// --- End Positron ---

		if (this.state.type !== StateType.CheckingForUpdates) {
			return;
		}

		const notAvailable = this.state.explicit;
		this.setState(State.Idle(UpdateType.Archive, undefined, notAvailable || undefined));
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
}
