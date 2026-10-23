/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { IAiProviderService } from '../../../../services/positronAiProvider/common/aiProviderService.js';
import { IProviderCatalogChangeData, IResolvedProviderData } from '../../../../../platform/positronAiProvider/common/aiProviderCatalog.js';
import { IPositronAssistantService } from '../../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IAgentAllowedCommandsService, IAgentCommandDescriptor } from '../../../../contrib/positronAiFeatures/common/agentAllowedCommandsService.js';
import { IErrorActionHandler, IErrorActionHandlerService } from '../../../../contrib/positronAssistant/common/errorAction.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ExtHostAiFeaturesShape } from '../../../common/positron/extHost.positron.protocol.js';
import { MainThreadAiFeatures } from '../../../browser/positron/mainThreadAiFeatures.js';

function resolvedProvider(id: string, enabled: boolean): IResolvedProviderData {
	return { id, enabled };
}

describe('MainThreadAiFeatures', () => {
	const disposables = ensureNoLeakedDisposables();

	let catalog: IResolvedProviderData[];
	let onDidChangeProviders: Emitter<IProviderCatalogChangeData>;
	let onDidChangeProviderEnablement: ReturnType<typeof vi.fn<(id: string, enabled: boolean) => void>>;
	let askErrorActionHandler: ReturnType<typeof vi.fn<ExtHostAiFeaturesShape['$askErrorActionHandler']>>;
	let errorActionHandlers: Map<string, IErrorActionHandler>;
	let logError: ReturnType<typeof vi.fn<ILogService['error']>>;

	/**
	 * Constructs a MainThreadAiFeatures with the given initial catalog and returns it. The
	 * enablement baseline snapshot is captured before the test fires any catalog changes.
	 * Pass a pending `whenInitialized` to drive the pre-initialization timing yourself.
	 */
	async function createMainThread(initialCatalog: IResolvedProviderData[], whenInitialized: Promise<void> = Promise.resolve(), agentCommands: IAgentCommandDescriptor[] = []): Promise<MainThreadAiFeatures> {
		catalog = initialCatalog;
		onDidChangeProviders = disposables.add(new Emitter<IProviderCatalogChangeData>());
		onDidChangeProviderEnablement = vi.fn<(id: string, enabled: boolean) => void>();
		askErrorActionHandler = vi.fn<ExtHostAiFeaturesShape['$askErrorActionHandler']>(async () => { });
		errorActionHandlers = new Map();
		logError = vi.fn<ILogService['error']>();

		const aiProviderService = stubInterface<IAiProviderService>({
			whenInitialized,
			getProviders: () => catalog,
			isEnabled: (id: string) => catalog.find(p => p.id === id)?.enabled ?? false,
			getProvider: (id: string) => catalog.find(p => p.id === id),
			onDidChangeProviders: onDidChangeProviders.event,
		});
		const extHostContext = stubInterface<IExtHostContext>({
			getProxy: (<T>() => stubInterface<ExtHostAiFeaturesShape>({
				$onDidChangeProviderEnablement: onDidChangeProviderEnablement,
				$askErrorActionHandler: askErrorActionHandler,
			}) as T) as IExtHostContext['getProxy'],
		});

		const mainThread = disposables.add(new MainThreadAiFeatures(
			extHostContext,
			stubInterface<IPositronAssistantService>({}),
			stubInterface<IViewsService>({}),
			stubInterface<IRuntimeSessionService>({}),
			stubInterface<IFileService>({}),
			stubInterface<IAgentAllowedCommandsService>({ getAgentAllowedCommands: () => agentCommands }),
			aiProviderService,
			stubInterface<IErrorActionHandlerService>({
				register: handler => {
					if (errorActionHandlers.has(handler.id)) {
						throw new Error('taken');
					}
					errorActionHandlers.set(handler.id, handler);
					return toDisposable(() => errorActionHandlers.delete(handler.id));
				},
			}),
			stubInterface<ILogService>({ error: logError }),
		));

		// Let the whenInitialized microtask (which captures the enablement baseline) settle.
		await Promise.resolve();
		await Promise.resolve();

		return mainThread;
	}

	it('$getAgentAllowedCommands passes on which commands are read-only', async () => {
		const mainThread = await createMainThread([], undefined, [
			{ id: 'test.reads', readOnly: true, source: { type: 'builtin' } },
			{ id: 'test.writes', source: { type: 'builtin' } },
		]);

		const commands = await mainThread.$getAgentAllowedCommands();

		expect(commands.map(c => [c.id, c.readOnly])).toEqual([['test.reads', true], ['test.writes', undefined]]);
	});

	it('$getAgentAllowedCommands passes on each command\'s display name', async () => {
		const mainThread = await createMainThread([], undefined, [
			{ id: 'test.titled', title: 'Titled Command', source: { type: 'builtin' } },
			{ id: 'test.untitled', source: { type: 'builtin' } },
		]);

		const commands = await mainThread.$getAgentAllowedCommands();

		expect(commands.map(c => [c.id, c.title])).toEqual([['test.titled', 'Titled Command'], ['test.untitled', undefined]]);
	});

	it('$isProviderEnabled waits for initialization then reads the catalog', async () => {
		const mainThread = await createMainThread([resolvedProvider('copilot', true)]);

		await expect(mainThread.$isProviderEnabled('copilot')).resolves.toBe(true);
		await expect(mainThread.$isProviderEnabled('unknown')).resolves.toBe(false);
	});

	it('$getProviderBaseUrl waits for initialization then reads the catalog', async () => {
		const initialized = new DeferredPromise<void>();
		const mainThread = await createMainThread([], initialized.p);

		const baseUrl = mainThread.$getProviderBaseUrl('positai');
		catalog = [{ ...resolvedProvider('positai', true), baseUrl: 'https://example.test' }];
		initialized.complete();

		await expect(baseUrl).resolves.toBe('https://example.test');
		await expect(mainThread.$getProviderBaseUrl('unknown')).resolves.toBeUndefined();
	});

	it('forwards a flipped enablement to the extension host', async () => {
		await createMainThread([resolvedProvider('copilot', true), resolvedProvider('anthropic', false)]);

		catalog = [resolvedProvider('copilot', false), resolvedProvider('anthropic', false)];
		onDidChangeProviders.fire({ catalog, enabledChanged: true, connectionChanged: false, modelsChanged: false });

		expect(onDidChangeProviderEnablement).toHaveBeenCalledExactlyOnceWith('copilot', false);
	});

	it('does not forward for unchanged providers or newly-appearing ids', async () => {
		await createMainThread([resolvedProvider('copilot', true)]);

		catalog = [resolvedProvider('copilot', true), resolvedProvider('anthropic', true)];
		onDidChangeProviders.fire({ catalog, enabledChanged: true, connectionChanged: false, modelsChanged: false });

		expect(onDidChangeProviderEnablement).not.toHaveBeenCalled();
	});

	it('ignores catalog changes where enablement did not change at all', async () => {
		await createMainThread([resolvedProvider('copilot', true)]);

		catalog = [resolvedProvider('copilot', false)];
		onDidChangeProviders.fire({ catalog, enabledChanged: false, connectionChanged: true, modelsChanged: false });

		expect(onDidChangeProviderEnablement).not.toHaveBeenCalled();
	});

	describe('error action handlers', () => {
		it('registers an error action handler from the extension host and passes asks through', async () => {
			const mainThread = await createMainThread([]);
			const context = { kind: 'notebook' as const, error: 'boom', uri: URI.file('/a.ipynb') };

			mainThread.$registerErrorActionHandler(7, 'claude-code', 'Claude Code', false);
			const handler = errorActionHandlers.get('claude-code')!;
			expect({ id: handler.id, label: handler.label, supportsChatContinuation: handler.supportsChatContinuation })
				.toEqual({ id: 'claude-code', label: 'Claude Code', supportsChatContinuation: false });

			await handler.ask('explain', context, {});
			expect(askErrorActionHandler).toHaveBeenCalledWith(7, 'explain', context, false);

			mainThread.$unregisterErrorActionHandler(7);
			expect(errorActionHandlers.size).toBe(0);
		});

		it('refuses Posit Assistant\'s reserved id and taken ids, with a logged error', async () => {
			const mainThread = await createMainThread([]);
			mainThread.$registerErrorActionHandler(1, 'claude-code', 'Claude Code', false);

			mainThread.$registerErrorActionHandler(2, 'posit-assistant', 'Imposter', true);
			mainThread.$registerErrorActionHandler(3, 'claude-code', 'Again', false);
			// Unregistering a refused handle leaves the others alone.
			mainThread.$unregisterErrorActionHandler(3);

			expect([...errorActionHandlers.keys()]).toEqual(['claude-code']);
			expect(logError).toHaveBeenCalledTimes(2);
		});
	});
});
