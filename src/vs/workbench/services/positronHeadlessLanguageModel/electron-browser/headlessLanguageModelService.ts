/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ISharedProcessService } from '../../../../platform/ipc/electron-browser/services.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IAuthenticationService } from '../../authentication/common/authentication.js';
import { IRemoteAgentService } from '../../remote/common/remoteAgentService.js';
import { AbstractHeadlessLanguageModelService } from '../browser/abstractHeadlessLanguageModelService.js';
import { HeadlessLanguageModelEngineChannelClient, HEADLESS_LM_ENGINE_CHANNEL, IHeadlessLanguageModelEngine } from '../../../../platform/positronHeadlessLanguageModel/common/engine.js';
import { IHeadlessLanguageModelService } from '../common/headlessLanguageModelService.js';

/**
 * Desktop variant. When connected to a remote, egress runs on the remote host;
 * otherwise it runs locally in the shared process. Either way the caller
 * sees the same interface.
 */
export class NativeHeadlessLanguageModelService extends AbstractHeadlessLanguageModelService {
	constructor(
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@ISharedProcessService private readonly _sharedProcessService: ISharedProcessService,
		@IAuthenticationService authService: IAuthenticationService,
		@IConfigurationService configService: IConfigurationService,
		@ILogService logService: ILogService,
	) {
		super(authService, configService, logService);
	}

	protected createEngine(): IHeadlessLanguageModelEngine | undefined {
		const connection = this._remoteAgentService.getConnection();
		const channel = connection
			? connection.getChannel(HEADLESS_LM_ENGINE_CHANNEL)
			: this._sharedProcessService.getChannel(HEADLESS_LM_ENGINE_CHANNEL);
		return new HeadlessLanguageModelEngineChannelClient(channel);
	}
}

registerSingleton(IHeadlessLanguageModelService, NativeHeadlessLanguageModelService, InstantiationType.Delayed);
