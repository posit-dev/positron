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
import { IPositronAssistantConfigurationService, IPositronAssistantService } from '../../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
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

describe('MainThreadAiFeatures', () => {
	const disposables = ensureNoLeakedDisposables();

	let catalog: IResolvedProviderData[];
	let onDidChangeProviders: Emitter<IProviderCatalogChangeData>;
	let onChangeProviderConfig: Emitter<never>;
	let onDidChangeProviderEnablement: ReturnType<typeof vi.fn<(id: string, enabled: boolean) => void>>;

	/**
	 * Constructs a MainThreadAiFeatures with the given initial catalog and returns it. The
	 * returned instance's whenInitialized has already resolved, so the enablement baseline
	 * snapshot is captured before the test fires any catalog changes.
	 */
	async function createMainThread(initialCatalog: IResolvedProviderData[]): Promise<MainThreadAiFeatures> {
		catalog = initialCatalog;
		onDidChangeProviders = disposables.add(new Emitter<IProviderCatalogChangeData>());
		onChangeProviderConfig = disposables.add(new Emitter<never>());
		onDidChangeProviderEnablement = vi.fn<(id: string, enabled: boolean) => void>();

		const aiProviderService = stubInterface<IAiProviderService>({
			whenInitialized: Promise.resolve(),
			getProviders: () => catalog,
			isEnabled: (id: string) => catalog.find(p => p.id === id)?.enabled ?? false,
			onDidChangeProviders: onDidChangeProviders.event,
		});
		const positronAssistantConfigurationService = stubInterface<IPositronAssistantConfigurationService>({
			onChangeProviderConfig: onChangeProviderConfig.event as Event<never>,
		});
		const extHostContext = stubInterface<IExtHostContext>({
			getProxy: (<T>() => stubInterface<ExtHostAiFeaturesShape>({
				$onDidChangeProviderEnablement: onDidChangeProviderEnablement,
			}) as T) as IExtHostContext['getProxy'],
		});

		const mainThread = disposables.add(new MainThreadAiFeatures(
			extHostContext,
			stubInterface<IPositronAssistantService>({}),
			positronAssistantConfigurationService,
			stubInterface<IChatService>({}),
			stubInterface<IChatAgentService>({}),
			stubInterface<ILanguageModelsService>({}),
			stubInterface<IViewsService>({}),
			stubInterface<IRuntimeSessionService>({}),
			stubInterface<IFileService>({}),
			stubInterface<IAgentAllowedCommandsService>({}),
			aiProviderService,
		));

		// Let the whenInitialized microtask (which captures the enablement baseline) settle.
		await aiProviderService.whenInitialized;
		await Promise.resolve();

		return mainThread;
	}

	it('$isProviderEnabled waits for initialization then reads the catalog', async () => {
		const mainThread = await createMainThread([resolvedProvider('copilot', true)]);

		await expect(mainThread.$isProviderEnabled('copilot')).resolves.toBe(true);
		await expect(mainThread.$isProviderEnabled('unknown')).resolves.toBe(false);
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
});
