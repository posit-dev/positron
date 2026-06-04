/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ISharedProcessService } from '../../../../platform/ipc/electron-browser/services.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { IPositronLMService, POSITRON_LM_CHANNEL_NAME } from '../common/positronLMService.js';
import { AbstractPositronLMService } from '../common/positronLMServiceImpl.js';

class PositronLMServiceElectron extends AbstractPositronLMService {
	constructor(
		@ILogService logService: ILogService,
		@IAuthenticationService authenticationService: IAuthenticationService,
		@IConfigurationService configurationService: IConfigurationService,
		@ISharedProcessService sharedProcessService: ISharedProcessService,
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
	) {
		// In a remote workspace (e.g. Remote SSH), route LLM egress through the
		// remote host's channel so it stays consistent with every other Positron
		// LLM feature: the assistant and copilot extensions both default to the
		// 'workspace' extension kind and run in the remote extension host, so
		// chat, completions, and the prior ghost-cell path all egress from the
		// server. Matching that keeps routing uniform and supports setups where
		// only the server can reach the model gateway. Credentials are resolved
		// in the renderer and forwarded as channel-call arguments, so this adds
		// no new plumbing -- the same secrets that already reach the remote ext
		// host for the assistant. When there is no remote connection, use the
		// local shared process. The channel is registered in both places
		// (sharedProcessMain.ts and serverServices.ts).
		const remoteConnection = remoteAgentService.getConnection();
		const channel = remoteConnection
			? remoteConnection.getChannel(POSITRON_LM_CHANNEL_NAME)
			: sharedProcessService.getChannel(POSITRON_LM_CHANNEL_NAME);
		super(channel, logService, authenticationService, configurationService);
	}
}

registerSingleton(IPositronLMService, PositronLMServiceElectron, InstantiationType.Delayed);
