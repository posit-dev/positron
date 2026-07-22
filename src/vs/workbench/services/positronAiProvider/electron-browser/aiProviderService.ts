/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ISharedProcessService } from '../../../../platform/ipc/electron-browser/services.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { AiProviderCatalogChannelClient } from '../../../../platform/positronAiProvider/common/aiProviderCatalogChannelClient.js';
import { IAiProviderCatalog, POSITRON_AI_PROVIDER_CHANNEL } from '../../../../platform/positronAiProvider/common/aiProviderCatalog.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { IRemoteAgentService } from '../../remote/common/remoteAgentService.js';
import { IAiProviderService } from '../common/aiProviderService.js';
import { AbstractAiProviderService, AiProviderServiceWarmer } from '../browser/abstractAiProviderService.js';

/**
 * Desktop variant. When connected to a remote the catalog runs on the remote
 * host; otherwise it runs locally in the shared process. Either way the caller
 * sees the same interface, and the config URI is a local file:// path unless a
 * remote authority is present.
 */
export class NativeAiProviderService extends AbstractAiProviderService {
	constructor(
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@ISharedProcessService private readonly _sharedProcessService: ISharedProcessService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@ILogService logService: ILogService,
	) {
		super(logService);
	}

	protected createCatalogClient(): IAiProviderCatalog | undefined {
		const connection = this._remoteAgentService.getConnection();
		const channel = connection
			? connection.getChannel(POSITRON_AI_PROVIDER_CHANNEL)
			: this._sharedProcessService.getChannel(POSITRON_AI_PROVIDER_CHANNEL);
		return new AiProviderCatalogChannelClient(channel);
	}

	protected toConfigUri(path: string): URI {
		const authority = this._environmentService.remoteAuthority;
		return authority
			? URI.from({ scheme: Schemas.vscodeRemote, authority, path })
			: URI.file(path);
	}
}

registerSingleton(IAiProviderService, NativeAiProviderService, InstantiationType.Delayed);
registerWorkbenchContribution2(AiProviderServiceWarmer.ID, AiProviderServiceWarmer, WorkbenchPhase.AfterRestored);
