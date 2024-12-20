/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, LifecycleMainPhase } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService } from '../../request/common/request.js';
import { AvailableForDownload, DisablementReason, IUpdateService, State, StateType, UpdateType } from '../common/update.js';

//--- START POSITRON
// eslint-disable-next-line no-duplicate-imports
import { asJson } from '../../request/common/request.js';
// eslint-disable-next-line no-duplicate-imports
import { IUpdate } from '../common/update.js';
import { hasUpdate } from '../electron-main/positronVersion.js';
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';

export const enum UpdateChannel {
	Releases = 'releases',
	Prereleases = 'prereleases',
	Dailies = 'dailies',
	Staging = 'staging',
}

export function createUpdateURL(platform: string, channel: string, productService: IProductService): string {
	return `${productService.updateUrl}/${channel}/${platform}`;
	//--- END POSITRON
}

export type UpdateNotAvailableClassification = {
	owner: 'joaomoreno';
	explicit: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the user has manually checked for updates, or this was an automatic check.' };
	comment: 'This is used to understand how often VS Code pings the update server for an update and there\'s none available.';
};

export type UpdateErrorClassification = {
	owner: 'joaomoreno';
	messageHash: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The hash of the error message.' };
	comment: 'This is used to know how often VS Code updates have failed.';
};

export abstract class AbstractUpdateService implements IUpdateService {

	declare readonly _serviceBrand: undefined;

	protected url: string | undefined;

	// --- START POSITRON ---
	// enable the service to download and apply updates automatically
	protected enableAutoUpdate: boolean;
	// --- END POSITRON ---

	private _state: State = State.Uninitialized;

	private readonly _onStateChange = new Emitter<State>();
	readonly onStateChange: Event<State> = this._onStateChange.event;

	get state(): State {
		return this._state;
	}

	protected setState(state: State): void {
		this.logService.info('update#setState', state.type);
		this._state = state;
		this._onStateChange.fire(state);
	}

	constructor(
		@ILifecycleMainService protected readonly lifecycleMainService: ILifecycleMainService,
		@IConfigurationService protected configurationService: IConfigurationService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@IRequestService protected requestService: IRequestService,
		@ILogService protected logService: ILogService,
		// --- START POSITRON ---
		@IProductService protected readonly productService: IProductService,
		@INativeHostMainService protected readonly nativeHostMainService: INativeHostMainService
	) {
		this.enableAutoUpdate = process.env.POSITRON_AUTO_UPDATE === '1';
		lifecycleMainService.when(LifecycleMainPhase.AfterWindowOpen)
			.finally(() => this.initialize());
	}

	/**
	 * This must be called before any other call. This is a performance
	 * optimization, to avoid using extra CPU cycles before first window open.
	 * https://github.com/microsoft/vscode/issues/89784
	 */
	protected async initialize(): Promise<void> {
		const updateChannel = process.env.POSITRON_UPDATE_CHANNEL ?? UpdateChannel.Prereleases;
		const autoUpdateFlag = this.configurationService.getValue<boolean>('update.autoUpdateExperimental');

		if (!this.environmentMainService.isBuilt && !autoUpdateFlag) {
			this.setState(State.Disabled(DisablementReason.NotBuilt));
			return; // updates are never enabled when running out of sources
		} else if (!this.environmentMainService.isBuilt && updateChannel && autoUpdateFlag) {
			this.logService.warn('update#ctor - updates enabled in dev environment; attempted update installs will fail');
		}

		if (this.environmentMainService.disableUpdates || !autoUpdateFlag) {
			this.setState(State.Disabled(DisablementReason.DisabledByEnvironment));
			this.logService.info('update#ctor - updates are disabled by the environment');
			return;
		}

		if ((!this.productService.updateUrl || !this.productService.commit) && !updateChannel) {
			this.setState(State.Disabled(DisablementReason.MissingConfiguration));
			this.logService.info('update#ctor - updates are disabled as there is no update URL');
			return;
		}

		const updateMode = this.configurationService.getValue<'none' | 'manual' | 'start' | 'default'>('update.mode');

		if (updateMode === 'none') {
			this.setState(State.Disabled(DisablementReason.ManuallyDisabled));
			this.logService.info('update#ctor - updates are disabled by user preference');
			return;
		}

		this.url = this.buildUpdateFeedUrl(updateChannel);
		if (!this.url) {
			this.setState(State.Disabled(DisablementReason.InvalidConfiguration));
			this.logService.info('update#ctor - updates are disabled as the update URL is badly formed');
			return;
		}
		this.logService.debug('update#ctor - update URL is', this.url);

		// hidden setting
		if (this.configurationService.getValue<boolean>('_update.prss')) {
			const url = new URL(this.url);
			url.searchParams.set('prss', 'true');
			this.url = url.toString();
		}

		this.setState(State.Idle(this.getUpdateType()));

		if (updateMode === 'manual') {
			this.logService.info('update#ctor - manual checks only; automatic updates are disabled by user preference');
			return;
		}

		if (updateMode === 'start') {
			this.logService.info('update#ctor - startup checks only; automatic updates are disabled by user preference');

			// Check for updates only once after 30 seconds
			setTimeout(() => this.checkForUpdates(false), 30 * 1000);
		} else {
			// Start checking for updates after 30 seconds
			this.scheduleCheckForUpdates(30 * 1000).then(undefined, err => this.logService.error(err));
		}
	}

	private scheduleCheckForUpdates(delay = 60 * 60 * 1000): Promise<void> {
		return timeout(delay)
			.then(() => this.checkForUpdates(false))
			.then(() => {
				// Check again after 1 hour
				return this.scheduleCheckForUpdates(60 * 60 * 1000);
			});
	}

	async checkForUpdates(explicit: boolean): Promise<void> {
		this.logService.trace('update#checkForUpdates, state = ', this.state.type);

		if (this.state.type !== StateType.Idle) {
			return;
		}

		this.setState(State.CheckingForUpdates(explicit));

		this.requestService.request({ url: this.url }, CancellationToken.None)
			.then<IUpdate | null>(asJson)
			.then(update => {
				if (!update || !update.url || !update.version) {
					this.setState(State.Idle(this.getUpdateType()));
					return Promise.resolve(null);
				}

				if (hasUpdate(update, this.productService.positronVersion)) {
					this.logService.info(`update#checkForUpdates, ${update.version} is available`);
					this.updateAvailable(update);
				} else {
					this.logService.info(`update#checkForUpdates, ${this.productService.positronVersion} is the latest version`);
					this.setState(State.Idle(this.getUpdateType()));
				}
				return Promise.resolve(update);
			})
			.then(undefined, err => {
				this.logService.error(err);

				// only show message when explicitly checking for updates
				const message: string | undefined = !!explicit ? (err.message || err) : undefined;
				this.setState(State.Idle(this.getUpdateType(), message));
			});

	}

	async downloadUpdate(): Promise<void> {
		this.logService.trace('update#downloadUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.AvailableForDownload) {
			return;
		}

		await this.doDownloadUpdate(this.state);
	}

	protected async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		if (this.productService.downloadUrl && this.productService.downloadUrl.length > 0) {
			// Use the download URL if available as we don't currently detect the package type that was
			// installed and the website download page is more useful than the tarball generally.
			this.nativeHostMainService.openExternal(undefined, this.productService.downloadUrl);
		} else if (state.update.url) {
			this.nativeHostMainService.openExternal(undefined, state.update.url);
		}

		this.setState(State.Idle(this.getUpdateType()));
	}
	// --- END POSITRON ---

	async applyUpdate(): Promise<void> {
		this.logService.trace('update#applyUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.Downloaded) {
			return;
		}

		await this.doApplyUpdate();
	}

	protected async doApplyUpdate(): Promise<void> {
		// noop
	}

	quitAndInstall(): Promise<void> {
		this.logService.trace('update#quitAndInstall, state = ', this.state.type);

		if (this.state.type !== StateType.Ready) {
			return Promise.resolve(undefined);
		}

		this.logService.trace('update#quitAndInstall(): before lifecycle quit()');

		this.lifecycleMainService.quit(true /* will restart */).then(vetod => {
			this.logService.trace(`update#quitAndInstall(): after lifecycle quit() with veto: ${vetod}`);
			if (vetod) {
				return;
			}

			this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');
			this.doQuitAndInstall();
		});

		return Promise.resolve(undefined);
	}

	async isLatestVersion(): Promise<boolean | undefined> {
		if (!this.url) {
			return undefined;
		}

		const mode = this.configurationService.getValue<'none' | 'manual' | 'start' | 'default'>('update.mode');

		if (mode === 'none') {
			return false;
		}

		try {
			// --- START POSITRON
			return this.requestService.request({ url: this.url }, CancellationToken.None)
				.then<IUpdate | null>(asJson)
				.then(update => {
					if (!update || !update.version) {
						return Promise.resolve(false);
					}
					return Promise.resolve(hasUpdate(update, this.productService.positronVersion));
				});
			// --- END POSITRON
		} catch (error) {
			this.logService.error('update#isLatestVersion(): failed to check for updates');
			this.logService.error(error);
			return undefined;
		}
	}

	async _applySpecificUpdate(packagePath: string): Promise<void> {
		// noop
	}

	protected getUpdateType(): UpdateType {
		return UpdateType.Archive;
	}

	protected doQuitAndInstall(): void {
		// noop
	}

	// --- START POSITRON ---
	protected abstract buildUpdateFeedUrl(channel: string): string | undefined;
	protected updateAvailable(context: IUpdate): void {
		this.setState(State.AvailableForDownload(context));
	}
	// --- END POSITRON ---
}
