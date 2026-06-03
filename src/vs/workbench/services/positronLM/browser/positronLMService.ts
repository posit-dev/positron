/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { IPositronLMService, POSITRON_LM_CHANNEL_NAME } from '../common/positronLMService.js';
import { AbstractPositronLMService } from '../common/positronLMServiceImpl.js';

class PositronLMServiceBrowser extends AbstractPositronLMService {
	constructor(
		@ILogService logService: ILogService,
		@IAuthenticationService authenticationService: IAuthenticationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
	) {
		const connection = remoteAgentService.getConnection();
		const channel = connection
			? connection.getChannel(POSITRON_LM_CHANNEL_NAME)
			: null;
		super(channel, logService, authenticationService, configurationService);
	}
}

registerSingleton(IPositronLMService, PositronLMServiceBrowser, InstantiationType.Delayed);
