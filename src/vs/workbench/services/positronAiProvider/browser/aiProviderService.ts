/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { AiProviderCatalogChannelClient } from '../../../../platform/positronAiProvider/common/aiProviderCatalogChannelClient.js';
import { IAiProviderCatalog, POSITRON_AI_PROVIDER_CHANNEL } from '../../../../platform/positronAiProvider/common/aiProviderCatalog.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { IRemoteAgentService } from '../../remote/common/remoteAgentService.js';
import { IAiProviderService } from '../common/aiProviderService.js';
import { AbstractAiProviderService, AiProviderServiceWarmer } from './abstractAiProviderService.js';

/**
 * Browser/web variant. The catalog runs on the server it is connected to (web
 * always has a connection; Remote SSH routes to the remote host). When there is
 * no connection the catalog is absent and the service reports status 'error'.
 */
export class BrowserAiProviderService extends AbstractAiProviderService {
	constructor(
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@ILogService logService: ILogService,
	) {
		super(logService);
	}

	protected createCatalogClient(): IAiProviderCatalog | undefined {
		const connection = this._remoteAgentService.getConnection();
		if (!connection) {
			return undefined;
		}
		return new AiProviderCatalogChannelClient(connection.getChannel(POSITRON_AI_PROVIDER_CHANNEL));
	}

	protected toConfigUri(path: string): URI {
		return URI.from({ scheme: Schemas.vscodeRemote, authority: this._environmentService.remoteAuthority, path });
	}
}

registerSingleton(IAiProviderService, BrowserAiProviderService, InstantiationType.Delayed);
registerWorkbenchContribution2(AiProviderServiceWarmer.ID, AiProviderServiceWarmer, WorkbenchPhase.AfterRestored);
