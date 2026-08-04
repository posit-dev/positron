/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, IWorkspace, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustEnablementService, IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { awaitWorkspaceTrustDecisionForCanvas, CanvasTrustDecisionServices } from '../../browser/positronCanvasTrustGate.js';

describe('awaitWorkspaceTrustDecisionForCanvas', () => {
	const disposables = ensureNoLeakedDisposables();

	interface Overrides {
		trustEnabled?: boolean;
		trusted?: boolean;
		canSetTrust?: boolean;
		workbenchState?: WorkbenchState;
		startupPrompt?: 'always' | 'once' | 'never';
		promptShown?: boolean;
		hasFocus?: boolean;
		onDidChangeFocus?: Emitter<boolean>;
		requestWorkspaceTrust?: () => Promise<boolean | undefined>;
	}

	function createServices(overrides: Overrides = {}): CanvasTrustDecisionServices & { requestSpy: ReturnType<typeof vi.fn> } {
		const requestSpy = vi.fn(overrides.requestWorkspaceTrust ?? (() => Promise.resolve(true)));
		const workspace = stubInterface<IWorkspace>({
			folders: [{ uri: URI.file('/workspace'), name: 'workspace', index: 0, toResource: (relative: string) => URI.file(`/workspace/${relative}`) }],
			configuration: null,
		});
		return {
			configurationService: stubInterface<IConfigurationService>({
				getValue: vi.fn().mockReturnValue(overrides.startupPrompt ?? 'once'),
			}),
			contextService: stubInterface<IWorkspaceContextService>({
				getWorkspace: () => workspace,
				getWorkbenchState: () => overrides.workbenchState ?? WorkbenchState.FOLDER,
			}),
			hostService: stubInterface<IHostService>({
				hasFocus: overrides.hasFocus ?? true,
				onDidChangeFocus: (overrides.onDidChangeFocus ?? disposables.add(new Emitter<boolean>())).event,
			}),
			storageService: stubInterface<IStorageService>({
				getBoolean: vi.fn().mockReturnValue(overrides.promptShown ?? false),
			}),
			trustEnablementService: stubInterface<IWorkspaceTrustEnablementService>({
				isWorkspaceTrustEnabled: () => overrides.trustEnabled ?? true,
			}),
			trustManagementService: stubInterface<IWorkspaceTrustManagementService>({
				workspaceTrustInitialized: Promise.resolve(),
				isWorkspaceTrusted: () => overrides.trusted ?? false,
				canSetWorkspaceTrust: () => overrides.canSetTrust ?? true,
			}),
			trustRequestService: stubInterface<IWorkspaceTrustRequestService>({
				requestWorkspaceTrust: requestSpy,
			}),
			requestSpy,
		};
	}

	it.each([
		['trust is disabled', { trustEnabled: false }],
		['the workspace is already trusted', { trusted: true }],
		['trust cannot be set', { canSetTrust: false }],
		['the window is empty', { workbenchState: WorkbenchState.EMPTY }],
		['the startup prompt is configured to never show', { startupPrompt: 'never' as const }],
		['a once-only startup prompt was already answered', { startupPrompt: 'once' as const, promptShown: true }],
	])('resolves without a trust request when %s', async (_name, overrides) => {
		const services = createServices(overrides);

		await awaitWorkspaceTrustDecisionForCanvas(services);

		expect(services.requestSpy).not.toHaveBeenCalled();
	});

	it('joins the pending trust request and resolves with its answer', async () => {
		let resolveRequest!: (trusted: boolean | undefined) => void;
		const services = createServices({
			requestWorkspaceTrust: () => new Promise<boolean | undefined>(resolve => { resolveRequest = resolve; }),
		});

		let settled = false;
		const gate = awaitWorkspaceTrustDecisionForCanvas(services).then(() => { settled = true; });

		await vi.waitFor(() => expect(services.requestSpy).toHaveBeenCalledTimes(1));
		expect(settled).toBe(false);

		resolveRequest(undefined);
		await gate;
		expect(settled).toBe(true);
	});

	it('waits for window focus before requesting trust', async () => {
		const focusEmitter = disposables.add(new Emitter<boolean>());
		const services = createServices({ hasFocus: false, onDidChangeFocus: focusEmitter });

		const gate = awaitWorkspaceTrustDecisionForCanvas(services);

		// The gate is parked on the focus event, not a timer, so a couple of
		// macrotask flushes deterministically shows it has not requested yet.
		await new Promise(resolve => setTimeout(resolve, 2));
		expect(services.requestSpy).not.toHaveBeenCalled();

		focusEmitter.fire(true);
		await gate;
		expect(services.requestSpy).toHaveBeenCalledTimes(1);
	});
});
