/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronAttributionInfo, IPositronAttributionService } from '../common/positronAttribution.js';
import { IRemoteAgentService } from '../../remote/common/remoteAgentService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

/**
 * Browser implementation of the Positron attribution service.
 * Retrieves attribution info from the remote agent environment.
 */
export class PositronAttributionService implements IPositronAttributionService {
	readonly _serviceBrand: undefined;

	private _attributionPromise: Promise<IPositronAttributionInfo | undefined> | undefined;

	constructor(
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService
	) {
	}

	async getAttribution(): Promise<IPositronAttributionInfo | undefined> {
		// Cache the promise to avoid multiple calls
		if (!this._attributionPromise) {
			this._attributionPromise = this._fetchAttribution();
		}
		return this._attributionPromise;
	}

	private async _fetchAttribution(): Promise<IPositronAttributionInfo | undefined> {
		const environment = await this._remoteAgentService.getEnvironment();
		if (!environment?.positronAttribution) {
			return undefined;
		}
		return {
			licensee: environment.positronAttribution.licensee,
			issuer: environment.positronAttribution.issuer
		};
	}
}

registerSingleton(IPositronAttributionService, PositronAttributionService, InstantiationType.Delayed);
