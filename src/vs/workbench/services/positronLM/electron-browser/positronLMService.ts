/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ISharedProcessService } from '../../../../platform/ipc/electron-browser/services.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { IPositronLMService, POSITRON_LM_CHANNEL_NAME } from '../common/positronLMService.js';
import { AbstractPositronLMService } from '../common/positronLMServiceImpl.js';

class PositronLMServiceElectron extends AbstractPositronLMService {
	constructor(
		@ILogService logService: ILogService,
		@IAuthenticationService authenticationService: IAuthenticationService,
		@IConfigurationService configurationService: IConfigurationService,
		@ISharedProcessService sharedProcessService: ISharedProcessService,
	) {
		// Always use shared process. The LM channel is only registered there,
		// not on the remote server (even in Remote SSH scenarios).
		super(sharedProcessService.getChannel(POSITRON_LM_CHANNEL_NAME), logService, authenticationService, configurationService);
	}
}

registerSingleton(IPositronLMService, PositronLMServiceElectron, InstantiationType.Delayed);
