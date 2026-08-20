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
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { awaitWorkspaceTrustDecisionForCanvas, CanvasTrustDecisionServices, STARTUP_PROMPT_INITIATION_GRACE_MS } from '../../browser/positronCanvasTrustGate.js';

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

	interface TestServices extends CanvasTrustDecisionServices {
		requestSpy: ReturnType<typeof vi.fn>;
		startupInitiation: Emitter<void>;
		trustChange: Emitter<boolean>;
	}

	function createServices(overrides: Overrides = {}): TestServices {
		const requestSpy = vi.fn(overrides.requestWorkspaceTrust ?? (() => Promise.resolve(true)));
		const startupInitiation = disposables.add(new Emitter<void>());
		const trustChange = disposables.add(new Emitter<boolean>());
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
			lifecycleService: stubInterface<ILifecycleService>({
				when: () => Promise.resolve(),
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
				onDidChangeTrust: trustChange.event,
			}),
			trustRequestService: stubInterface<IWorkspaceTrustRequestService>({
				requestWorkspaceTrust: requestSpy,
				onDidInitiateWorkspaceTrustRequestOnStartup: startupInitiation.event,
			}),
			requestSpy,
			startupInitiation,
			trustChange,
		};
	}

	/** Flushes the microtask chains the gate awaits between its waits. */
	async function flush(): Promise<void> {
		await new Promise(resolve => setTimeout(resolve, 2));
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

	it('joins the request only once the startup prompt is initiated, resolving with its answer', async () => {
		let resolveRequest!: (trusted: boolean | undefined) => void;
		const services = createServices({
			requestWorkspaceTrust: () => new Promise<boolean | undefined>(resolve => { resolveRequest = resolve; }),
		});

		let settled = false;
		const gate = awaitWorkspaceTrustDecisionForCanvas(services).then(() => { settled = true; });

		// No initiation yet: the gate must not raise a request of its own.
		await flush();
		expect(services.requestSpy).not.toHaveBeenCalled();

		services.startupInitiation.fire();
		await vi.waitFor(() => expect(services.requestSpy).toHaveBeenCalledTimes(1));
		expect(settled).toBe(false);

		resolveRequest(undefined);
		await gate;
		expect(settled).toBe(true);
	});

	it('resolves without joining when trust is granted before the prompt initiates', async () => {
		const services = createServices();

		const gate = awaitWorkspaceTrustDecisionForCanvas(services);
		await flush();

		services.trustChange.fire(true);
		await gate;
		expect(services.requestSpy).not.toHaveBeenCalled();
	});

	it('waits for window focus without a deadline, then joins once the prompt initiates', async () => {
		vi.useFakeTimers();
		try {
			const focusEmitter = disposables.add(new Emitter<boolean>());
			const services = createServices({ hasFocus: false, onDidChangeFocus: focusEmitter });

			let settled = false;
			const gate = awaitWorkspaceTrustDecisionForCanvas(services).then(() => { settled = true; });

			// The focus wait is deliberately unbounded: the grace period must
			// not start ticking while the prompt cannot come. Advancing past
			// it while unfocused settles nothing.
			await vi.advanceTimersByTimeAsync(STARTUP_PROMPT_INITIATION_GRACE_MS + 1);
			expect(settled).toBe(false);
			expect(services.requestSpy).not.toHaveBeenCalled();

			focusEmitter.fire(true);
			await vi.advanceTimersByTimeAsync(1);
			services.startupInitiation.fire();
			await vi.waitFor(() => expect(services.requestSpy).toHaveBeenCalledTimes(1));
			await gate;
		} finally {
			vi.useRealTimers();
		}
	});

	it('joins an initiation that arrives while the window is unfocused', async () => {
		const focusEmitter = disposables.add(new Emitter<boolean>());
		const services = createServices({ hasFocus: false, onDidChangeFocus: focusEmitter });

		const gate = awaitWorkspaceTrustDecisionForCanvas(services);
		await flush();

		// The upstream handler initiates only once focused, so an unfocused
		// initiation means its conditions drifted; a pending request exists
		// either way, and joining it is the whole point of the gate.
		services.startupInitiation.fire();
		await gate;
		expect(services.requestSpy).toHaveBeenCalledTimes(1);
	});

	it('resolves when trust is granted while the window is unfocused', async () => {
		const focusEmitter = disposables.add(new Emitter<boolean>());
		const services = createServices({ hasFocus: false, onDidChangeFocus: focusEmitter });

		const gate = awaitWorkspaceTrustDecisionForCanvas(services);
		await flush();

		services.trustChange.fire(true);
		await gate;
		expect(services.requestSpy).not.toHaveBeenCalled();
	});

	it('enters untrusted after the grace period when no initiation ever comes', async () => {
		vi.useFakeTimers();
		try {
			const services = createServices();

			let settled = false;
			const gate = awaitWorkspaceTrustDecisionForCanvas(services).then(() => { settled = true; });

			await vi.advanceTimersByTimeAsync(STARTUP_PROMPT_INITIATION_GRACE_MS - 1);
			expect(settled).toBe(false);

			await vi.advanceTimersByTimeAsync(1);
			await gate;
			expect(services.requestSpy).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
