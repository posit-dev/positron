/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IPositronMcpService, PositronMcpChannelName } from '../../../../platform/positronMcp/common/positronMcp.js';
import { INativeWorkbenchEnvironmentService } from '../../../services/environment/electron-browser/environmentService.js';

/**
 * Renderer-side {@link IPositronMcpService}, scoped transparently to this
 * window. The main-process registry serves every window's MCP server from one
 * instance and has no other way to know which window is calling, so this
 * supplies the window's own id as IPC context -- mirroring `NativeHostService`
 * (`platform/native/common/nativeHostService.ts`), which does the same for
 * {@link INativeHostService}. `ProxyChannel.toService` auto-prepends `context`
 * as the first argument of every call, so `IPositronMcpMainService`'s methods
 * receive it without this class (or any of its callers) passing it explicitly.
 *
 * `IMainProcessService` is only usable from a small allowlist of common-layer
 * files (see `build/checker/layersChecker.ts`), so unlike `NativeHostService`
 * this lives directly in the electron-browser layer rather than a shared
 * platform/common base class -- nothing else needs to construct it standalone.
 */
// @ts-expect-error: interface is implemented via proxy
class PositronMcpService implements IPositronMcpService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@INativeWorkbenchEnvironmentService environmentService: INativeWorkbenchEnvironmentService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		return ProxyChannel.toService<IPositronMcpService>(mainProcessService.getChannel(PositronMcpChannelName), { context: environmentService.window.id });
	}
}

registerSingleton(IPositronMcpService, PositronMcpService, InstantiationType.Delayed);
