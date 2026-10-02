/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

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
import { ExtHostAiFeaturesShape } from '../../../common/positron/extHost.positron.protocol.js';
import { MainThreadAiFeatures } from '../../../browser/positron/mainThreadAiFeatures.js';

function resolvedProvider(id: string, enabled: boolean): IResolvedProviderData {
	return { id, enabled, connection: {} };
}

describe('MainThreadAiFeatures', () => {
	const disposables = ensureNoLeakedDisposables();

	let catalog: IResolvedProviderData[];
	let onDidChangeProviders: Emitter<IProviderCatalogChangeData>;
	let onDidChangeProviderEnablement: ReturnType<typeof vi.fn<(id: string, enabled: boolean) => void>>;

	/**
	 * Constructs a MainThreadAiFeatures with the given initial catalog and returns it. The
	 * enablement baseline snapshot is captured before the test fires any catalog changes.
	 * Pass a pending `whenInitialized` to drive the pre-initialization timing yourself.
	 */
	async function createMainThread(initialCatalog: IResolvedProviderData[], whenInitialized: Promise<void> = Promise.resolve(), agentCommands: IAgentCommandDescriptor[] = []): Promise<MainThreadAiFeatures> {
		catalog = initialCatalog;
		onDidChangeProviders = disposables.add(new Emitter<IProviderCatalogChangeData>());
		onDidChangeProviderEnablement = vi.fn<(id: string, enabled: boolean) => void>();

		const aiProviderService = stubInterface<IAiProviderService>({
			whenInitialized,
			getProviders: () => catalog,
			isEnabled: (id: string) => catalog.find(p => p.id === id)?.enabled ?? false,
			onDidChangeProviders: onDidChangeProviders.event,
		});
		const extHostContext = stubInterface<IExtHostContext>({
			getProxy: (<T>() => stubInterface<ExtHostAiFeaturesShape>({
				$onDidChangeProviderEnablement: onDidChangeProviderEnablement,
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
