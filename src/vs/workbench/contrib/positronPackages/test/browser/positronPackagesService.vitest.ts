/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService, IStorageService } from '../../../../../platform/storage/common/storage.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimePackage, ILanguageRuntimePackageManager, ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { POSITRON_PACKAGES_SELECTED_PACKAGE_BUNDLED_ONLY } from '../../browser/positronPackagesContextKeys.js';
import { PositronPackagesService } from '../../browser/positronPackagesService.js';

const pkg = (name: string, overrides: Partial<ILanguageRuntimePackage> = {}): ILanguageRuntimePackage =>
	({ id: name, name, displayName: name, version: '1.0.0', ...overrides });

describe('PositronPackagesService selected package context keys', () => {
	const ctx = createLightTestContainer().build();

	let getPackages: ReturnType<typeof vi.fn<ILanguageRuntimePackageManager['getPackages']>>;
	let contextKeyService: MockContextKeyService;

	function makeService(): PositronPackagesService {
		getPackages = vi.fn(async () => [pkg('numpy'), pkg('tornado', { bundled: true })]);
		const packageManager = stubInterface<ILanguageRuntimePackageManager>({ getPackages, getPackageMetadata: undefined, repositoryRequest: undefined });
		const session = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'session-1',
			metadata: stubInterface<IRuntimeSessionMetadata>({ sessionId: 'session-1', sessionMode: LanguageRuntimeSessionMode.Console }),
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: 'py-3.12', languageId: 'python' }),
			getRuntimeState: () => RuntimeState.Uninitialized,
			onDidChangeRuntimeState: Event.None,
			getPackageManager: () => packageManager,
		});
		contextKeyService = new MockContextKeyService();
		const instantiationService = ctx.instantiationService;
		instantiationService.stub(IRuntimeSessionService, {
			onWillStartSession: Event.None,
			onDidChangeForegroundSession: Event.None,
			foregroundSession: session,
		});
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(IContextKeyService, contextKeyService);
		instantiationService.stub(IStorageService, ctx.disposables.add(new InMemoryStorageService()));
		instantiationService.stub(IConfigurationService, new TestConfigurationService());
		return ctx.disposables.add(instantiationService.createInstance(PositronPackagesService));
	}

	const bundledOnlyKey = () => contextKeyService.getContextKeyValue(POSITRON_PACKAGES_SELECTED_PACKAGE_BUNDLED_ONLY.key);

	it('is set when the selected package is bundled only', async () => {
		const service = makeService();
		await service.activePackagesInstance!.refreshPackages();

		service.setSelectedPackage('tornado');
		expect(bundledOnlyKey()).toBe(true);

		service.setSelectedPackage('numpy');
		expect(bundledOnlyKey()).toBe(false);
	});

	it('follows a refresh that finds an environment copy of the selected package', async () => {
		const service = makeService();
		await service.activePackagesInstance!.refreshPackages();
		service.setSelectedPackage('tornado');

		getPackages.mockResolvedValue([pkg('tornado', { bundled: true, environmentVersion: '0.9.0' })]);
		await service.activePackagesInstance!.refreshPackages();

		expect(bundledOnlyKey()).toBe(false);
	});
});
