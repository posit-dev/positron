/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IWorkbenchContributionsRegistry, WorkbenchPhase, Extensions as WorkbenchExtensions, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ShowCandidateContribution } from './showCandidate.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { TunnelFactoryContribution } from './tunnelFactory.js';
import { RemoteAgentConnectionStatusListener, RemoteMarkers } from './remote.js';
import { RemoteStatusIndicator } from './remoteIndicator.js';
import { AutomaticPortForwarding, ForwardedPortsView, PortRestore, TOGGLE_VIEW_ACTION_ID } from './remoteExplorer.js';
import { InitialRemoteConnectionHealthContribution } from './remoteConnectionHealth.js';
// --- Start PWB: Stop reconnecting once Workbench reports the session exited ---
import { PwbSessionExitListener } from './pwbSessionExitListener.js';
// --- End PWB ---
// --- Start PWB: login-aware reconnection backoff ---
import { PwbReconnectionGateContribution } from './pwbReconnectionGate.js';
import { isWorkbench } from '../../../../base/common/platform.js';
// --- End PWB ---
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { TUNNEL_VIEW_ID } from '../../../services/remote/common/remoteExplorerService.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: TOGGLE_VIEW_ACTION_ID,
			title: localize('remote.togglePortsView', "Toggle Forwarded Ports View"),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		if (viewsService.isViewVisible(TUNNEL_VIEW_ID)) {
			viewsService.closeView(TUNNEL_VIEW_ID);
		} else {
			await viewsService.openView(TUNNEL_VIEW_ID, true);
		}
	}
});

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
registerWorkbenchContribution2(ShowCandidateContribution.ID, ShowCandidateContribution, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(TunnelFactoryContribution.ID, TunnelFactoryContribution, WorkbenchPhase.BlockRestore);
workbenchContributionsRegistry.registerWorkbenchContribution(RemoteAgentConnectionStatusListener, LifecyclePhase.Eventually);
registerWorkbenchContribution2(RemoteStatusIndicator.ID, RemoteStatusIndicator, WorkbenchPhase.BlockStartup);
workbenchContributionsRegistry.registerWorkbenchContribution(ForwardedPortsView, LifecyclePhase.Restored);
workbenchContributionsRegistry.registerWorkbenchContribution(PortRestore, LifecyclePhase.Eventually);
workbenchContributionsRegistry.registerWorkbenchContribution(AutomaticPortForwarding, LifecyclePhase.Eventually);
workbenchContributionsRegistry.registerWorkbenchContribution(RemoteMarkers, LifecyclePhase.Eventually);
workbenchContributionsRegistry.registerWorkbenchContribution(InitialRemoteConnectionHealthContribution, LifecyclePhase.Restored);
// --- Start PWB: Stop reconnecting once Workbench reports the session exited, and back off while logged out ---
// Only in Workbench: both depend on rsLoginCheck.js, which desktop and non-Workbench servers don't include.
if (isWorkbench) {
	registerWorkbenchContribution2(PwbSessionExitListener.ID, PwbSessionExitListener, WorkbenchPhase.BlockRestore);
	registerWorkbenchContribution2(PwbReconnectionGateContribution.ID, PwbReconnectionGateContribution, WorkbenchPhase.BlockStartup);
}
// --- End PWB ---
