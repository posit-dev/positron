/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { IAiProviderService } from '../../../../services/positronAiProvider/common/aiProviderService.js';
import { IProviderCatalogChangeData, IResolvedProviderData } from '../../../../../platform/positronAiProvider/common/aiProviderCatalog.js';
import { IPositronAssistantConfigurationService, IPositronAssistantService, IPositronLanguageModelConfig, IPositronLanguageModelSource, PositronLanguageModelType } from '../../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { IChatService } from '../../../../contrib/chat/common/chatService/chatService.js';
import { IChatAgentService } from '../../../../contrib/chat/common/participants/chatAgents.js';
import { ILanguageModelsService } from '../../../../contrib/chat/common/languageModels.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IAgentAllowedCommandsService } from '../../../../contrib/positronAiFeatures/common/agentAllowedCommandsService.js';
import { ExtHostAiFeaturesShape } from '../../../common/positron/extHost.positron.protocol.js';
import { MainThreadAiFeatures } from '../../../browser/positron/mainThreadAiFeatures.js';

function resolvedProvider(id: string, enabled: boolean): IResolvedProviderData {
	return { id, enabled, connection: {} };
}

function languageModelSource(id: string): IPositronLanguageModelSource {
	return {
		type: PositronLanguageModelType.Chat,
		provider: { id, displayName: `Display ${id}` },
		supportedOptions: [],
		defaults: {},
	};
}

describe('MainThreadAiFeatures', () => {
	const disposables = ensureNoLeakedDisposables();

	let catalog: IResolvedProviderData[];
	let onDidChangeProviders: Emitter<IProviderCatalogChangeData>;
	let onChangeProviderConfig: Emitter<never>;
	let onDidChangeProviderEnablement: ReturnType<typeof vi.fn<(id: string, enabled: boolean) => void>>;
	let getRegisteredSources: ReturnType<typeof vi.fn<() => IPositronLanguageModelSource[]>>;
	let getProviderRegistrations: ReturnType<typeof vi.fn<() => IPositronLanguageModelSource[]>>;
	let responseProviderAction: ReturnType<typeof vi.fn<(source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Promise<void>>>;

	/**
	 * Constructs a MainThreadAiFeatures with the given initial catalog and returns it. The
	 * enablement baseline snapshot is captured before the test fires any catalog changes.
	 * Pass a pending `whenInitialized` to drive the pre-initialization timing yourself.
	 */
	async function createMainThread(initialCatalog: IResolvedProviderData[], whenInitialized: Promise<void> = Promise.resolve()): Promise<MainThreadAiFeatures> {
		catalog = initialCatalog;
		onDidChangeProviders = disposables.add(new Emitter<IProviderCatalogChangeData>());
		onChangeProviderConfig = disposables.add(new Emitter<never>());
		onDidChangeProviderEnablement = vi.fn<(id: string, enabled: boolean) => void>();
		getRegisteredSources = vi.fn<() => IPositronLanguageModelSource[]>(() => []);
		getProviderRegistrations = vi.fn<() => IPositronLanguageModelSource[]>(() => []);
		responseProviderAction = vi.fn<(source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Promise<void>>(
			() => Promise.resolve());

		const aiProviderService = stubInterface<IAiProviderService>({
			whenInitialized,
			getProviders: () => catalog,
			isEnabled: (id: string) => catalog.find(p => p.id === id)?.enabled ?? false,
			onDidChangeProviders: onDidChangeProviders.event,
		});
		const positronAssistantConfigurationService = stubInterface<IPositronAssistantConfigurationService>({
			onChangeProviderConfig: onChangeProviderConfig.event as Event<never>,
			getRegisteredSources,
			getProviderRegistrations,
			registerProvider: vi.fn(),
			unregisterProvider: vi.fn(),
		});
		const extHostContext = stubInterface<IExtHostContext>({
			getProxy: (<T>() => stubInterface<ExtHostAiFeaturesShape>({
				$onDidChangeProviderEnablement: onDidChangeProviderEnablement,
				$responseProviderAction: responseProviderAction,
			}) as T) as IExtHostContext['getProxy'],
		});

		const mainThread = disposables.add(new MainThreadAiFeatures(
			extHostContext,
			stubInterface<IPositronAssistantService>({}),
			positronAssistantConfigurationService,
			stubInterface<IChatService>({}),
			stubInterface<IChatAgentService>({}),
			stubInterface<ILanguageModelsService>({ invalidateProvider: vi.fn() }),
			stubInterface<IViewsService>({}),
			stubInterface<IRuntimeSessionService>({}),
			stubInterface<IFileService>({}),
			stubInterface<IAgentAllowedCommandsService>({}),
			aiProviderService,
		));

		// Let the whenInitialized microtask (which captures the enablement baseline) settle.
		await Promise.resolve();
		await Promise.resolve();

		return mainThread;
	}

	it('$isProviderEnabled waits for initialization then reads the catalog', async () => {
		const mainThread = await createMainThread([resolvedProvider('copilot', true)]);

		await expect(mainThread.$isProviderEnabled('copilot')).resolves.toBe(true);
		await expect(mainThread.$isProviderEnabled('unknown')).resolves.toBe(false);
	});

	it('$getRegisteredProviders waits for initialization before reading the sources', async () => {
		let initialized: () => void;
		const whenInitialized = new Promise<void>(resolve => { initialized = resolve; });
		const mainThread = await createMainThread([resolvedProvider('ollama', false)], whenInitialized);
		getRegisteredSources.mockReturnValue([languageModelSource('ollama')]);

		// The sources are filtered by catalog enablement, so reading them before the
		// catalog is loaded would report the empty pre-initialization snapshot.
		const registered = mainThread.$getRegisteredProviders();
		await Promise.resolve();
		expect(getRegisteredSources).not.toHaveBeenCalled();

		initialized!();
		await expect(registered).resolves.toEqual([languageModelSource('ollama')]);
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

	describe('$runLegacyProviderAction', () => {
		const config: IPositronLanguageModelConfig = { provider: 'amazon-bedrock', name: 'AWS', model: '' };

		/**
		 * Registers `amazon-bedrock` as owned by `owner` and returns the main thread.
		 * The source has to be visible through getProviderRegistrations too -- the
		 * owner map answers "who registered it", the configuration service answers
		 * "what is it", and the bridge needs both.
		 */
		async function createMainThreadWithLegacyProvider(owner: string): Promise<MainThreadAiFeatures> {
			const mainThread = await createMainThread([resolvedProvider('amazon-bedrock', true)]);
			getProviderRegistrations.mockReturnValue([languageModelSource('amazon-bedrock')]);
			mainThread.$registerProvider(languageModelSource('amazon-bedrock'), owner);
			return mainThread;
		}

		it('dispatches to the proxy of the host that registered the provider', async () => {
			const mainThread = await createMainThreadWithLegacyProvider('positron.authentication');

			await mainThread.$runLegacyProviderAction('posit.assistant', 'amazon-bedrock', config, 'oauth-signout');

			expect(responseProviderAction).toHaveBeenCalledExactlyOnceWith(
				languageModelSource('amazon-bedrock'), config, 'oauth-signout');
		});

		it('rejects a caller that is not an allowed provider-UI host', async () => {
			const mainThread = await createMainThreadWithLegacyProvider('positron.authentication');

			await expect(mainThread.$runLegacyProviderAction('some.other-extension', 'amazon-bedrock', config, 'save'))
				.rejects.toThrow(/some\.other-extension may not run legacy provider actions/);
			expect(responseProviderAction).not.toHaveBeenCalled();
		});

		// DEMO ONLY -- delete alongside the 'positron.scratch' entry in
		// LEGACY_ACTION_CALLERS. Asserted rather than left implicit so removing the
		// demo hole fails a test instead of going unnoticed.
		it('allows extensions/scratch, the local demo caller', async () => {
			const mainThread = await createMainThreadWithLegacyProvider('positron.authentication');

			await mainThread.$runLegacyProviderAction('positron.scratch', 'amazon-bedrock', config, 'oauth-signout');

			expect(responseProviderAction).toHaveBeenCalledExactlyOnceWith(
				languageModelSource('amazon-bedrock'), config, 'oauth-signout');
		});

		it('rejects a provider the authentication extension does not own', async () => {
			// The bridge exists only to reach providers Posit Assistant does not own.
			// Once it registers its own, it holds their credentials itself.
			const mainThread = await createMainThreadWithLegacyProvider('posit.assistant');

			await expect(mainThread.$runLegacyProviderAction('posit.assistant', 'amazon-bedrock', config, 'save'))
				.rejects.toThrow(/is not a legacy provider/);
			expect(responseProviderAction).not.toHaveBeenCalled();
		});

		it('rejects an unregistered provider', async () => {
			const mainThread = await createMainThreadWithLegacyProvider('positron.authentication');

			await expect(mainThread.$runLegacyProviderAction('posit.assistant', 'unknown', config, 'save'))
				.rejects.toThrow(/No registered provider: unknown/);
			expect(responseProviderAction).not.toHaveBeenCalled();
		});

		it('stops dispatching once the provider is unregistered', async () => {
			const mainThread = await createMainThreadWithLegacyProvider('positron.authentication');
			mainThread.$unregisterProvider('amazon-bedrock');

			await expect(mainThread.$runLegacyProviderAction('posit.assistant', 'amazon-bedrock', config, 'save'))
				.rejects.toThrow(/No registered provider: amazon-bedrock/);
		});
	});
});
