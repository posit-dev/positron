/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronMemoryInfoProvider, IPositronProcessMemoryInfo, POSITRON_MEMORY_INFO_CHANNEL_NAME } from '../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';
import { PositronMemoryInfoChannelClient } from '../../../../platform/positronMemoryUsage/common/positronMemoryUsageIpc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRemoteAgentService } from '../../remote/common/remoteAgentService.js';

/**
 * Browser/web implementation of IPositronMemoryInfoProvider.
 * Connects to the remote server via the remote agent's IPC channel.
 */
export class BrowserPositronMemoryInfoProvider implements IPositronMemoryInfoProvider {
	readonly _serviceBrand: undefined;
	private readonly _channel: PositronMemoryInfoChannelClient | undefined;

	constructor(
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
		@ILogService logService: ILogService,
	) {
		const connection = remoteAgentService.getConnection();
		if (connection) {
			this._channel = new PositronMemoryInfoChannelClient(
				connection.getChannel(POSITRON_MEMORY_INFO_CHANNEL_NAME)
			);
		} else {
			logService.warn('Cannot create memory info provider; no remote connection.');
		}
	}

	async getMemoryInfo(excludePids?: number[]): Promise<IPositronProcessMemoryInfo> {
		if (!this._channel) {
			throw new Error('Cannot get memory info; no remote connection.');
		}
		return this._channel.getMemoryInfo(excludePids);
	}
}

registerSingleton(IPositronMemoryInfoProvider, BrowserPositronMemoryInfoProvider, InstantiationType.Delayed);
