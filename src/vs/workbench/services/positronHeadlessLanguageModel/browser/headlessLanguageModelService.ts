/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAuthenticationService } from '../../authentication/common/authentication.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRemoteAgentService } from '../../remote/common/remoteAgentService.js';
import { AbstractHeadlessLanguageModelService } from './abstractHeadlessLanguageModelService.js';
import { HeadlessLanguageModelEngineChannelClient, HEADLESS_LM_ENGINE_CHANNEL, IHeadlessLanguageModelEngine } from '../../../../platform/positronHeadlessLanguageModel/common/engine.js';
import { IHeadlessLanguageModelService } from '../common/headlessLanguageModelService.js';

/**
 * Browser/web variant. The engine runs on the server it is connected to (web
 * always has a connection; Remote SSH routes egress to the remote host).
 * When there is no connection the engine is absent and requests resolve to
 * `no-providers-configured`.
 */
export class BrowserHeadlessLanguageModelService extends AbstractHeadlessLanguageModelService {
	constructor(
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@IAuthenticationService authService: IAuthenticationService,
		@IConfigurationService configService: IConfigurationService,
		@ILogService logService: ILogService,
	) {
		super(authService, configService, logService);
	}

	protected createEngine(): IHeadlessLanguageModelEngine | undefined {
		const connection = this._remoteAgentService.getConnection();
		if (!connection) {
			return undefined;
		}
		return new HeadlessLanguageModelEngineChannelClient(connection.getChannel(HEADLESS_LM_ENGINE_CHANNEL));
	}
}

registerSingleton(IHeadlessLanguageModelService, BrowserHeadlessLanguageModelService, InstantiationType.Delayed);
