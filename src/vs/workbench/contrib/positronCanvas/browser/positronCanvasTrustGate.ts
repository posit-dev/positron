/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { isVirtualWorkspace } from '../../../../platform/workspace/common/virtualWorkspace.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustEnablementService, IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { WORKSPACE_TRUST_STARTUP_PROMPT } from '../../../services/workspaces/common/workspaceTrust.js';

/**
 * Mirrors the file-local STARTUP_PROMPT_SHOWN_KEY in
 * `workbench/contrib/workspace/browser/workspace.contribution.ts`. If the key
 * drifts, the gate mispredicts "prompt is coming" and waits out the grace
 * period below before entering untrusted - a delay, never a hang and never
 * an extra dialog.
 */
const STARTUP_PROMPT_SHOWN_KEY = 'workspace.trust.startupPrompt.shown';

/**
 * How long after the startup prompt's preconditions are met (workbench
 * restored, window focused) the gate keeps waiting for the prompt to be
 * initiated. `WorkspaceTrustUXHandler` initiates synchronously once those
 * hold, so this fires only if its bail conditions drift from the mirrored
 * checks below; entering untrusted late beats a curtain that never lifts.
 */
export const STARTUP_PROMPT_INITIATION_GRACE_MS = 10_000;

export interface CanvasTrustDecisionServices {
	readonly configurationService: IConfigurationService;
	readonly contextService: IWorkspaceContextService;
	readonly hostService: IHostService;
	readonly lifecycleService: ILifecycleService;
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
 * hides, and an undecided workspace keeps trust-gated extensions - the
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
 * explanation. When the prompt is coming, the gate waits for the
 * Restored-phase UX handler to initiate it, then joins the coalesced request
 * that initiation created, resolving on either answer - the prompt's own
 * decline path answers with `undefined`, which is a decision for restricted
 * mode, not an unanswered prompt.
 */
export async function awaitWorkspaceTrustDecisionForCanvas(services: CanvasTrustDecisionServices): Promise<void> {
	const { configurationService, contextService, hostService, lifecycleService, storageService, trustEnablementService, trustManagementService, trustRequestService } = services;

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

	// The startup prompt belongs to `WorkspaceTrustUXHandler`, which
	// registers at the Restored phase - after this gate, which runs at
	// BlockRestore - and initiates the request only once the window has
	// focus. Wait for that initiation rather than initiating anything here:
	// a `requestWorkspaceTrust` call with no request pending raises its own
	// immediate dialog, and the startup prompt would still follow it.
	const disposables = new DisposableStore();
	try {
		// Subscribe before reproducing the handler's own waits so an
		// initiation between them cannot be missed.
		const initiated = Event.toPromise(trustRequestService.onDidInitiateWorkspaceTrustRequestOnStartup, disposables);
		const trustGranted = Event.toPromise(Event.filter(trustManagementService.onDidChangeTrust, trusted => trusted, disposables), disposables);

		await lifecycleService.when(LifecyclePhase.Restored);
		if (!hostService.hasFocus) {
			await Event.toPromise(Event.filter(hostService.onDidChangeFocus, focused => focused, disposables), disposables);
		}

		// Trust granted through another path means the handler stays quiet
		// and the initiation never comes; the grace period covers mirrored
		// conditions drifting out of sync (see STARTUP_PROMPT_SHOWN_KEY).
		const grace = timeout(STARTUP_PROMPT_INITIATION_GRACE_MS);
		disposables.add({ dispose: () => grace.cancel() });
		grace.catch(() => { /* cancellation of a lost race */ });
		const outcome = await Promise.race([
			initiated.then(() => 'join' as const),
			trustGranted.then(() => 'decided' as const),
			grace.then(() => 'no-prompt' as const),
		]);
		if (outcome !== 'join') {
			return;
		}
	} finally {
		disposables.dispose();
	}

	// `requestWorkspaceTrustOnStartup` creates its pending request before
	// firing the initiation event, so this joins that request rather than
	// raising a dialog of its own; the startup prompt answers it for us.
	await trustRequestService.requestWorkspaceTrust();
}
