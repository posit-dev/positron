/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { isVirtualWorkspace } from '../../../../platform/workspace/common/virtualWorkspace.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustEnablementService, IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { WORKSPACE_TRUST_STARTUP_PROMPT } from '../../../services/workspaces/common/workspaceTrust.js';

/**
 * Mirrors the file-local STARTUP_PROMPT_SHOWN_KEY in
 * `workbench/contrib/workspace/browser/workspace.contribution.ts`. If the key
 * drifts, the gate mispredicts "prompt is coming" and initiates its own trust
 * request below - an extra dialog, never a hang.
 */
const STARTUP_PROMPT_SHOWN_KEY = 'workspace.trust.startupPrompt.shown';

export interface CanvasTrustDecisionServices {
	readonly configurationService: IConfigurationService;
	readonly contextService: IWorkspaceContextService;
	readonly hostService: IHostService;
	readonly storageService: IStorageService;
	readonly trustEnablementService: IWorkspaceTrustEnablementService;
	readonly trustManagementService: IWorkspaceTrustManagementService;
	readonly trustRequestService: IWorkspaceTrustRequestService;
}

/**
 * Resolves once the workspace trust decision that gates extension activation
 * has been made, or immediately when no decision is pending.
 *
 * Canvas boot must wait for this before it covers the IDE: the workspace
 * trust startup prompt renders in the main window, which Canvas mode
 * minimizes, and an undecided workspace keeps trust-gated extensions - the
 * authentication providers behind the Canvas model picker among them - from
 * activating. Deciding behind the startup curtain (whose z-index sits below
 * workbench dialogs) keeps the prompt visible and answered before Canvas is
 * the only surface.
 *
 * The conditions mirror `WorkspaceTrustUXHandler.showModalOnStart`: whenever
 * that startup prompt is not coming (trust disabled, already trusted, prompt
 * suppressed by setting or an earlier answer), the gate stays out of the way
 * rather than second-guessing the user's startup-prompt preference - Canvas
 * then enters untrusted and the assistant's restricted-mode surface owns the
 * explanation. When the prompt is coming, the gate joins its coalesced
 * request via `requestWorkspaceTrust`, resolving on either answer.
 */
export async function awaitWorkspaceTrustDecisionForCanvas(services: CanvasTrustDecisionServices): Promise<void> {
	const { configurationService, contextService, hostService, storageService, trustEnablementService, trustManagementService, trustRequestService } = services;

	await trustManagementService.workspaceTrustInitialized;

	if (!trustEnablementService.isWorkspaceTrustEnabled()) {
		return;
	}
	if (trustManagementService.isWorkspaceTrusted()) {
		return;
	}
	if (!trustManagementService.canSetWorkspaceTrust()) {
		return;
	}
	if (isVirtualWorkspace(contextService.getWorkspace())) {
		return;
	}
	if (contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
		return;
	}
	const startupPrompt = configurationService.getValue<'always' | 'once' | 'never'>(WORKSPACE_TRUST_STARTUP_PROMPT);
	if (startupPrompt === 'never') {
		return;
	}
	if (startupPrompt === 'once' && storageService.getBoolean(STARTUP_PROMPT_SHOWN_KEY, StorageScope.WORKSPACE, false)) {
		return;
	}

	// The startup prompt initiates only once the window has focus; wait for
	// the same signal so the request to join exists. The yield lets the UX
	// handler's earlier-registered focus listener initiate first.
	if (!hostService.hasFocus) {
		await Event.toPromise(Event.filter(hostService.onDidChangeFocus, focused => focused));
	}
	await timeout(0);

	await trustRequestService.requestWorkspaceTrust({
		message: localize('positron.canvas.trustRequest', "Canvas starts AI and runtime features that are disabled until you decide whether to trust this folder.")
	});
}
