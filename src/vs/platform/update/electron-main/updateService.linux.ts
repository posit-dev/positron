/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, IUpdate, State, UpdateType } from '../common/update.js';
import { AbstractUpdateService, createUpdateURL } from './abstractUpdateService.js';
import { IStateService } from '../../state/node/state.js';

export class LinuxUpdateService extends AbstractUpdateService {

	// --- Start Positron ---
	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		// change scope of this service since it's set by the abstract class
		@INativeHostMainService nativeHostMainService: INativeHostMainService,
		@IProductService productService: IProductService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
		@IStateService stateService: IStateService
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, telemetryService, applicationStorageMainService, meteredConnectionService, productService, nativeHostMainService, stateService, false);
	}

	protected buildUpdateFeedUrl(channel: string): string {
		const arch = process.arch === 'x64' ? 'x86_64' : 'arm64';
		const platform = `${this.productService.packageType ?? 'deb'}/${arch}`;
		const baseUrl = createUpdateURL(platform, channel, this.productService);

		return `${baseUrl}/releases.json`;
	}
	// --- End Positron ---

	// Unused for Positron
	protected doCheckForUpdates(explicit: boolean): void {
		if (!this.url) {
			return;
		}

		// --- Start Positron ---
		/*
		const internalOrg = this.getInternalOrg();
		const background = !explicit && !internalOrg;
		const url = this.buildUpdateFeedUrl(this.quality, this.productService.commit!, { background, internalOrg });
		*/
		const url = this.buildUpdateFeedUrl(this.getUpdateChannel());
		// --- End Positron ---
		this.setState(State.CheckingForUpdates(explicit));

		this.requestService.request({ url, callSite: 'updateService.linux.checkForUpdates' }, CancellationToken.None)
			.then<IUpdate | null>(asJson)
			.then(update => {
				if (!update || !update.url || !update.version || !update.productVersion) {
					this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
				} else {
					this.setState(State.AvailableForDownload(update));
				}
			})
			.then(undefined, err => {
				this.logService.error(err);
				// only show message when explicitly checking for updates
				const message: string | undefined = explicit ? (err.message || err) : undefined;
				this.setState(State.Idle(UpdateType.Archive, message));
			});
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		// Send the user directly to the artifact advertised by the update feed. The feed URL is keyed
		// to the installed package type (productService.packageType), so state.update.url already points
		// at the correct .deb/.rpm/tarball for the version we detected. This is the version the check
		// found, which matters for both channels: the website download page only serves `releases`, so
		// dailies users have nowhere to land there, and even release users can be handed a build the page
		// is not yet serving. Fall back to the generic download page only when the feed omits a URL.
		if (state.update.url) {
			this.nativeHostMainService.openExternal(undefined, state.update.url);
		} else if (this.productService.downloadUrl && this.productService.downloadUrl.length > 0) {
			this.nativeHostMainService.openExternal(undefined, this.productService.downloadUrl);
		}

		this.setState(State.Idle(UpdateType.Archive));
	}
}
