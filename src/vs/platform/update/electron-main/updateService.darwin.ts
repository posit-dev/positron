/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as electron from 'electron';
import { createCancelablePromise, timeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { memoize } from '../../../base/common/decorators.js';
import { Event } from '../../../base/common/event.js';
import { hash } from '../../../base/common/hash.js';
import { IDisposable, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
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

// --- Start Positron ---
/** How long each simulated download state is held during dev update testing. */
const DEV_STAGING_STATE_DURATION = 3000;
// --- End Positron ---

export class DarwinUpdateService extends AbstractUpdateService implements IRelaunchHandler {

	// --- Start Positron ---
	/** The in-flight simulated download, if any; see `simulateStagedUpdate`. */
	private readonly devStagingSimulation = this._register(new MutableDisposable<IDisposable>());
	/**
	 * The feed document that led to the download Electron is running, so `onUpdateDownloaded`
	 * can fill in what Electron's event leaves out. Electron reports the feed's `notes` as
	 * `version` and its `name` as `productVersion`; Positron's feed has no `notes`, so without
	 * this the pending update has no version and the overwrite check has nothing to compare.
	 */
	private downloadingFeedUpdate: IUpdate | undefined;
	// --- End Positron ---

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
			// --- Start Positron ---
			// A source build is unsigned, so the auto-updater always rejects the feed. Dev update
			// testing only exercises the check, which goes through the request service, so keep the
			// URL rather than disabling updates outright.
			if (this.devUpdateTesting) {
				this.logService.info('update#buildUpdateFeedUrl - unbuilt Positron cannot use the Electron autoUpdater; checking the feed directly', url);
				return url;
			}
			// --- End Positron ---
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

		if (this.devUpdateTesting) {
			this.simulateStagedUpdate(update, false);
			return;
		}

		if (!this.enableAutoUpdate) {
			super.updateAvailable(update);
		} else {
			// We cannot avoid Electron checking the URL again with this call. Electron can only check against
			// the app version, which is VS Code's version.
			this.downloadingFeedUpdate = update;
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

			// The real feed has no `productVersion` (the mock server used to add one, which hid this);
			// `version` is the calver and is all `hasUpdate` needs.
			if (update && update.url && update.version && hasUpdate(update, pendingCommit)) {
				this.logService.trace('update#checkForOverwriteDownload - newer update confirmed, downloading', { version: update.version });
				if (this.devUpdateTesting) {
					this.simulateStagedUpdate(update, explicit);
					return;
				}
				this.downloadingFeedUpdate = update;
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
	 * Stands in for Electron's download pipeline, which a source build cannot use because it is
	 * unsigned. Walks the same states a real download does so the pending-update UI and the
	 * `Ready` -> `Overwriting` -> `Ready` flow can be exercised by hand; nothing is downloaded and
	 * a restart will not install anything.
	 *
	 * The states are held for a few seconds each, because a real download is not instant and a
	 * flow that jumps straight to `Ready` never renders the states a tester needs to look at.
	 */
	/**
	 * Reads the current state type behind a call, so that checking it in one place does not narrow
	 * `this.state` for the checks that follow.
	 */
	private isCurrentState(type: StateType): boolean {
		return this.state.type === type;
	}

	private simulateStagedUpdate(update: IUpdate, explicit: boolean): void {
		this.logService.info('update#simulateStagedUpdate - dev update testing, staging update without downloading it', update.version);
		this.setState(State.Downloading(update, explicit, this._overwrite));

		const promise = createCancelablePromise(async token => {
			await timeout(DEV_STAGING_STATE_DURATION, token);
			// Anything that moved the state on in the meantime (a cancel, or updates being
			// disabled) wins; do not drag it back to a staged update.
			if (!this.isCurrentState(StateType.Downloading)) {
				return;
			}
			this.setState(State.Downloaded(update, explicit, this._overwrite));

			await timeout(DEV_STAGING_STATE_DURATION, token);
			if (!this.isCurrentState(StateType.Downloaded)) {
				return;
			}
			this.setState(State.Ready(update, explicit, this._overwrite));
		});

		// Cancels a simulation still in flight, so a second check cannot race the first to Ready.
		this.devStagingSimulation.value = toDisposable(() => promise.cancel());
		promise.catch(() => { /* cancelled, or the service went away */ });
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
			// --- Start Positron ---
			// Positron's feed has no `productVersion`; `version` is the calver.
			// if (!update || !update.url || !update.version || !update.productVersion) {
			if (!update || !update.url || !update.version) {
				// --- End Positron ---
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

		// --- Start Positron ---
		// Electron's event carries the feed's `notes` as `version`, which Positron's feed does not
		// have, so fall back to the release name (the feed's `name`, also the calver) and then to
		// the feed document we handed Electron. The pending update must have a version: the
		// overwrite check compares it against the feed, and a restart installs it by name.
		update = this.withFeedDetails(update);
		// --- End Positron ---

		this.setState(State.Downloaded(update, this.state.explicit, this._overwrite));
		this.logService.info(`Update downloaded: ${JSON.stringify(update)}`);

		this.setState(State.Ready(update, this.state.explicit, this._overwrite));
	}

	// --- Start Positron ---
	private withFeedDetails(update: IUpdate): IUpdate {
		const feed = this.downloadingFeedUpdate;
		this.downloadingFeedUpdate = undefined;

		// Only trust the remembered document when it describes the build Electron just downloaded.
		const sameBuild = feed && (!update.productVersion || feed.version === update.productVersion);
		const version = update.version || update.productVersion || (sameBuild ? feed.version : '');
		const productVersion = update.productVersion || (sameBuild ? feed.version : version) || undefined;

		return {
			...update,
			version,
			productVersion,
			url: update.url ?? (sameBuild ? feed.url : undefined),
			sha256hash: update.sha256hash ?? (sameBuild ? feed.sha256hash : undefined),
		};
	}
	// --- End Positron ---

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
		this.downloadingFeedUpdate = state.update;
		// --- End Positron ---
		this.setState(State.CheckingForUpdates(true));
		electron.autoUpdater.checkForUpdates();
	}

	// --- Start Positron ---
	/**
	 * Developer hook: point Electron's auto-updater at an arbitrary feed document (typically one
	 * that advertises an older, still-hosted build) and let it download and stage that build as
	 * the pending update. The channel feed is left alone, so the pending update then re-checks
	 * against the real latest release and the overwrite flow can be exercised end to end,
	 * including Electron's second download, without waiting for two builds to publish.
	 *
	 * A source build cannot use the auto-updater, so it fetches the document itself and walks
	 * the simulated download instead.
	 */
	override async _stageUpdateFromFeed(feedUrl: string): Promise<void> {
		this.logService.info('update#_stageUpdateFromFeed - staging the update advertised by', feedUrl);

		// Allowed from Ready as well, replacing the pending update: the regular check runs 30
		// seconds after launch, so by the time a tester reaches the command something is usually
		// already staged.
		if (this.state.type !== StateType.Idle && this.state.type !== StateType.Ready) {
			this.logService.warn('update#_stageUpdateFromFeed - ignored, the update service is neither idle nor holding a pending update', this.state.type);
			return;
		}

		if (this.state.type === StateType.Ready) {
			try {
				await this.cancelPendingUpdate();
			} catch (err) {
				this.logService.error('update#_stageUpdateFromFeed - failed to cancel the pending update', err);
				return;
			}
		}

		this._overwrite = false;
		this.setState(State.CheckingForUpdates(true));

		if (this.devUpdateTesting) {
			try {
				const context = await this.requestService.request({ url: feedUrl, callSite: 'updateService.darwin._stageUpdateFromFeed' }, CancellationToken.None);
				const update = await asJson<IUpdate>(context);
				if (!update || !update.url || !update.version) {
					this.logService.warn('update#_stageUpdateFromFeed - the feed does not advertise an update', update);
					this.setState(State.Idle(UpdateType.Archive));
					return;
				}
				this.simulateStagedUpdate(update, true);
			} catch (err) {
				this.logService.error('update#_stageUpdateFromFeed - failed to fetch the feed', err);
				this.setState(State.Idle(UpdateType.Archive, String(err)));
			}
			return;
		}

		try {
			electron.autoUpdater.setFeedURL({ url: feedUrl });
		} catch (err) {
			this.logService.error('update#_stageUpdateFromFeed - failed to set the feed URL', err);
			this.setState(State.Idle(UpdateType.Archive, String(err)));
			return;
		}

		// Electron's event fills the version in from the feed's `name`; nothing else about this
		// document is known up front, so there is no feed update to remember here.
		this.downloadingFeedUpdate = undefined;
		electron.autoUpdater.checkForUpdates();
	}
	// --- End Positron ---

	protected override doQuitAndInstall(): void {
		// --- Start Positron ---
		// A source build has nothing staged, so handing the unsigned auto-updater a restart does
		// nothing useful. Log the version the real install would have used instead: this is the
		// evidence that a restart installs whatever was latest at restart time, not the version
		// that was pending when the update was first found.
		if (this.devUpdateTesting) {
			const update = this.state.type === StateType.Restarting ? this.state.update : undefined;
			this.logService.info('update#doQuitAndInstall - dev update testing, would install', update?.productVersion, update?.version);
			return;
		}
		// --- End Positron ---
		this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');
		electron.autoUpdater.quitAndInstall();
	}
}
