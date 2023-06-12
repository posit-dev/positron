/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { ShowCandidateContribution } from 'vs/workbench/contrib/remote/browser/showCandidate';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { TunnelFactoryContribution } from 'vs/workbench/contrib/remote/browser/tunnelFactory';
import { RemoteAgentConnectionStatusListener, RemoteMarkers } from 'vs/workbench/contrib/remote/browser/remote';
// --- Start Positron ---
// Remove the RemoteStatusIndicator.
// import { RemoteStatusIndicator } from 'vs/workbench/contrib/remote/browser/remoteIndicator';
// --- End Positron ---
import { AutomaticPortForwarding, ForwardedPortsView, PortRestore } from 'vs/workbench/contrib/remote/browser/remoteExplorer';

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(ShowCandidateContribution, LifecyclePhase.Ready);
workbenchContributionsRegistry.registerWorkbenchContribution(TunnelFactoryContribution, LifecyclePhase.Ready);
workbenchContributionsRegistry.registerWorkbenchContribution(RemoteAgentConnectionStatusListener, LifecyclePhase.Eventually);
// --- Start Positron ---
// Remove the RemoteStatusIndicator.
// workbenchContributionsRegistry.registerWorkbenchContribution(RemoteStatusIndicator, LifecyclePhase.Starting);
// --- End Positron ---
workbenchContributionsRegistry.registerWorkbenchContribution(ForwardedPortsView, LifecyclePhase.Restored);
workbenchContributionsRegistry.registerWorkbenchContribution(PortRestore, LifecyclePhase.Eventually);
workbenchContributionsRegistry.registerWorkbenchContribution(AutomaticPortForwarding, LifecyclePhase.Eventually);
workbenchContributionsRegistry.registerWorkbenchContribution(RemoteMarkers, LifecyclePhase.Eventually);
