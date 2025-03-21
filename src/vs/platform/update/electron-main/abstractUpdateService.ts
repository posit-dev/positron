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

//--- Start Positron ---
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
	//--- End Positron ---
}

export type UpdateErrorClassification = {
	owner: 'joaomoreno';
	messageHash: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The hash of the error message.' };
	comment: 'This is used to know how often VS Code updates have failed.';
};

export abstract class AbstractUpdateService implements IUpdateService {

	declare readonly _serviceBrand: undefined;

	protected url: string | undefined;

	// --- Start Positron ---
	private _activeLanguages: string[];
	// enable the service to download and apply updates automatically
	protected enableAutoUpdate = false;
	// --- End Positron ---

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
		// --- Start Positron ---
		@IProductService protected readonly productService: IProductService,
		@INativeHostMainService protected readonly nativeHostMainService: INativeHostMainService
		// --- End Positron ---
	) {
		// --- Start Positron ---
		this._activeLanguages = [];
		// --- End Positron ---

		lifecycleMainService.when(LifecycleMainPhase.AfterWindowOpen)
			.finally(() => this.initialize());
	}

	/**
	 * This must be called before any other call. This is a performance
	 * optimization, to avoid using extra CPU cycles before first window open.
	 * https://github.com/microsoft/vscode/issues/89784
	*/
	protected async initialize(): Promise<void> {
		// --- Start Positron ---
		const updateChannel = process.env.POSITRON_UPDATE_CHANNEL ?? UpdateChannel.Prereleases;
		this.enableAutoUpdate = this.configurationService.getValue<boolean>('update.autoUpdate');

		if (this.environmentMainService.disableUpdates) {
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
		this.logService.debug('update#ctor - update URL is', this.url);

		// disables update checking in dev unless auto-updates are off
		// auto-updates do not work in dev and we don't want to trigger unwanted update downloads
		if (!this.environmentMainService.isBuilt && this.enableAutoUpdate) {
			this.setState(State.Disabled(DisablementReason.NotBuilt));
			return; // updates are never enabled when running out of sources
		}
		// --- End Positron ---
		if (!this.url) {
			this.setState(State.Disabled(DisablementReason.InvalidConfiguration));
			this.logService.info('update#ctor - updates are disabled as the update URL is badly formed');
			return;
		}

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

	// --- Start Positron ---
	// This is essentially the update 'channel' (aka insiders, stable, etc.). VS Code sets it through the
	// product.json. Positron will have it configurable for now.
	// @ts-ignore
	private getProductQuality(updateMode: string): string | undefined {
		return updateMode === 'none' ? undefined : this.productService.quality;
	}
	// --- End Positron ---

	// --- Start Positron ---
	private async scheduleCheckForUpdates(delay = 6 * 60 * 60 * 1000): Promise<void> {
		return timeout(delay)
			.then(() => {
				this.checkForUpdates(false);
			})
			.then(() => {
				// Check again after 6 hours
				return this.scheduleCheckForUpdates(6 * 60 * 60 * 1000);
			});
		// --- End Positron ---
	}

	// --- Start Positron ---
	async checkForUpdates(explicit: boolean): Promise<void> {
		const includeLanguages = this.configurationService.getValue<boolean>('update.primaryLanguageReporting');
		this.logService.debug('update#checkForUpdates, includeLanguages =', includeLanguages);
		this.logService.trace('update#checkForUpdates, state = ', this.state.type);

		this.logService.debug('update#checkForUpdates, languages =', this._activeLanguages.join(', '));
		if (this.state.type !== StateType.Idle) {
			return;
		}

		this.setState(State.CheckingForUpdates(explicit));
		let releaseMetadataUrl = this.url;
		if (includeLanguages && this._activeLanguages.length > 0) {
			releaseMetadataUrl = `${releaseMetadataUrl}?${this._activeLanguages.map(lang => `${lang}=1`).join('&')}`;
		}

		this.logService.debug('update#checkForUpdates, url =', releaseMetadataUrl);

		this.requestService.request({ url: releaseMetadataUrl }, CancellationToken.None)
			.then<IUpdate | null>(asJson)
			.then(update => {
				if (!update || !update.url || !update.version) {
					this.setState(State.Idle(this.getUpdateType()));
					return Promise.resolve(null);
				}

				if (hasUpdate(update, `${this.productService.positronVersion}-${this.productService.positronBuildNumber}`)) {
					this.logService.info(`update#checkForUpdates, ${update.version} is available`);
					this.updateAvailable(update);
				} else {
					this.logService.info(`update#checkForUpdates, ${this.productService.positronVersion}-${this.productService.positronBuildNumber} is the latest version`);
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
	// --- End Positron ---

	async downloadUpdate(): Promise<void> {
		this.logService.trace('update#downloadUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.AvailableForDownload) {
			return;
		}

		await this.doDownloadUpdate(this.state);
	}

	// --- Start Positron ---
	protected async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		if (state.update.url) {
			this.nativeHostMainService.openExternal(undefined, state.update.url);
		} else if (this.productService.downloadUrl && this.productService.downloadUrl.length > 0) {
			// Use the download URL if available as we don't currently detect the package type that was
			// installed and the website download page is more useful than the tarball generally.
			this.nativeHostMainService.openExternal(undefined, this.productService.downloadUrl);
		}

		this.setState(State.Idle(this.getUpdateType()));
	}
	// --- End Positron ---

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

		// --- Start Positron ---
		try {
			return this.requestService.request({ url: this.url }, CancellationToken.None)
				.then<IUpdate | null>(asJson)
				.then(update => {
					if (!update || !update.version) {
						return Promise.resolve(false);
					}
					return Promise.resolve(hasUpdate(update, this.productService.positronVersion));
				});
		} catch (error) {
			this.logService.error('update#isLatestVersion(): failed to check for updates');
			this.logService.error(error);
			return undefined;
		}
		// --- End Positron ---
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

	// --- Start Positron ---
	// This isn't actually used for Positron updates but is kept to make future merges from upstream easier
	protected abstract doCheckForUpdates(context: any): void;
	protected abstract buildUpdateFeedUrl(channel: string): string | undefined;
	protected updateAvailable(context: IUpdate): void {
		this.setState(State.AvailableForDownload(context));
	}
	updateActiveLanguages(languages: string[]): void {
		this._activeLanguages = languages;
	}
	// --- End Positron ---
}
