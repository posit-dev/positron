/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronMemoryInfoProvider, IPositronProcessMemoryInfo, POSITRON_MEMORY_INFO_CHANNEL_NAME } from '../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';
import { PositronMemoryInfoChannelClient } from '../../../../platform/positronMemoryUsage/common/positronMemoryUsageIpc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IRemoteAgentService } from '../../remote/common/remoteAgentService.js';

/**
 * Electron sandbox implementation of IPositronMemoryInfoProvider.
 * Bridges to the main process via IPC, or to the remote server when
 * connected via Remote SSH.
 */
export class ElectronPositronMemoryInfoProvider implements IPositronMemoryInfoProvider {
	readonly _serviceBrand: undefined;
	private readonly _channel: PositronMemoryInfoChannelClient;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
	) {
		const remoteConnection = remoteAgentService.getConnection();
		if (remoteConnection) {
			this._channel = new PositronMemoryInfoChannelClient(
				remoteConnection.getChannel(POSITRON_MEMORY_INFO_CHANNEL_NAME)
			);
		} else {
			this._channel = new PositronMemoryInfoChannelClient(
				mainProcessService.getChannel(POSITRON_MEMORY_INFO_CHANNEL_NAME)
			);
		}
	}

	getMemoryInfo(excludePids?: number[]): Promise<IPositronProcessMemoryInfo> {
		return this._channel.getMemoryInfo(excludePids);
	}
}

registerSingleton(IPositronMemoryInfoProvider, ElectronPositronMemoryInfoProvider, InstantiationType.Delayed);
