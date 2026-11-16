/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimePackage, ILanguageRuntimePackageManager, ILanguageRuntimeSession, IRuntimeSessionService, IRuntimeSessionWillStartEvent, RuntimeStartMode } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronPackagesService } from '../../browser/positronPackagesService.js';
import { PACKAGES_CAN_UNINSTALL_SELECTION, PACKAGES_CAN_UPDATE_SELECTION, POSITRON_PACKAGES_SELECTED_PACKAGE, POSITRON_PACKAGES_SELECTION_COUNT, POSITRON_PACKAGES_SELECTION_HAS_UNINSTALLABLE, POSITRON_PACKAGES_SELECTION_HAS_UPDATABLE } from '../../browser/positronPackagesContextKeys.js';

function pkg(name: string, outdated: boolean, extra: Partial<ILanguageRuntimePackage> = {}): ILanguageRuntimePackage {
	return {
		id: `${name}-1.0`, name, displayName: name, version: '1.0',
		...(outdated ? { outdated: true, latestVersion: '2.0' } : {}),
		...extra,
	};
}

/** A package only Positron's bundle provides: no copy in the user's environment. */
function bundledOnly(name: string, outdated = false): ILanguageRuntimePackage {
	return pkg(name, outdated, { bundled: true });
}

describe('PositronPackagesService selection', () => {
	const store = new DisposableStore();
	afterEach(() => store.clear());

	function makeService(initial: ILanguageRuntimePackage[]) {
		let current = initial;
		const packageManager = stubInterface<ILanguageRuntimePackageManager>({
			getPackages: async () => current,
			getPackageMetadata: undefined,
			repositoryRequest: undefined,
		});
		const session = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'session-1',
			metadata: stubInterface<ILanguageRuntimeSession['metadata']>({ sessionMode: LanguageRuntimeSessionMode.Console }),
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: 'test-runtime', languageId: 'r' }),
			getPackageManager: () => packageManager,
		});
		const onWillStartSession = store.add(new Emitter<IRuntimeSessionWillStartEvent>());
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({
			onWillStartSession: onWillStartSession.event,
			onDidChangeForegroundSession: store.add(new Emitter<ILanguageRuntimeSession | undefined>()).event,
			foregroundSession: undefined,
		});
		const contextKeyService = new MockContextKeyService();
		const service = store.add(new PositronPackagesService(
			runtimeSessionService, new NullLogService(), contextKeyService,
			store.add(new InMemoryStorageService()), new TestConfigurationService(),
		));
		onWillStartSession.fire({ startMode: RuntimeStartMode.Starting, activate: true, hasConsole: true, session });
		const instance = service.activePackagesInstance!;
		return {
			service, instance,
			/**
			 * Whether an action's precondition expression holds for the service's current keys.
			 * Evaluated directly, because the mock context key service's own `contextMatchesRules`
			 * is a stub that always answers false.
			 */
			matches: (expression: ContextKeyExpression | undefined) => !!expression?.evaluate({ getValue: key => contextKeyService.getContextKeyValue(key) }),
			setBackend: (packages: ILanguageRuntimePackage[]) => { current = packages; },
			keys: () => ({
				count: contextKeyService.getContextKeyValue(POSITRON_PACKAGES_SELECTION_COUNT.key),
				selected: contextKeyService.getContextKeyValue(POSITRON_PACKAGES_SELECTED_PACKAGE.key),
				hasUpdatable: contextKeyService.getContextKeyValue(POSITRON_PACKAGES_SELECTION_HAS_UPDATABLE.key),
				hasUninstallable: contextKeyService.getContextKeyValue(POSITRON_PACKAGES_SELECTION_HAS_UNINSTALLABLE.key),
			}),
		};
	}

	it('tracks a single selection', () => {
		const { service, keys } = makeService([]);
		service.setSelectedPackages(['a']);
		expect(service.selectedPackages).toEqual(['a']);
		expect(service.selectedPackage).toBe('a');
		expect(keys()).toMatchObject({ count: 1, selected: 'a' });
	});

	it('has no single selectedPackage for a multi-selection', () => {
		const { service, keys } = makeService([]);
		service.setSelectedPackages(['a', 'b']);
		expect(service.selectedPackage).toBeUndefined();
		expect(keys()).toMatchObject({ count: 2, selected: '' });
	});

	it('clears on an empty selection', () => {
		const { service, keys } = makeService([]);
		service.setSelectedPackages(['a']);
		service.setSelectedPackages([]);
		expect(service.selectedPackage).toBeUndefined();
		expect(keys()).toEqual({ count: 0, selected: '', hasUpdatable: false, hasUninstallable: false });
	});

	it('hasUpdatable is true only when a selected package is updatable', async () => {
		const { service, instance, keys } = makeService([pkg('a', true), pkg('b', false)]);
		await instance.refreshPackages();
		service.setSelectedPackages(['b']);
		expect(keys().hasUpdatable).toBe(false);
		service.setSelectedPackages(['a', 'b']);
		expect(keys().hasUpdatable).toBe(true);
	});

	it('recomputes hasUpdatable when the instance refreshes without a selection change', async () => {
		const { service, instance, setBackend, keys } = makeService([pkg('a', false), pkg('b', false)]);
		await instance.refreshPackages();
		service.setSelectedPackages(['a', 'b']);
		expect(keys().hasUpdatable).toBe(false);
		setBackend([pkg('a', true), pkg('b', false)]);
		await instance.refreshPackages();
		expect(keys().hasUpdatable).toBe(true);
	});

	it('hasUpdatable ignores a package only Positron bundles, even one that looks outdated', async () => {
		const { service, instance, keys } = makeService([bundledOnly('tornado', true), pkg('a', false)]);
		await instance.refreshPackages();
		service.setSelectedPackages(['tornado', 'a']);
		expect(keys().hasUpdatable).toBe(false);
	});

	it('hasUninstallable is true only when a selected package has an environment copy', async () => {
		const { service, instance, keys } = makeService([bundledOnly('tornado'), pkg('a', false)]);
		await instance.refreshPackages();
		service.setSelectedPackages(['tornado']);
		expect(keys().hasUninstallable).toBe(false);
		service.setSelectedPackages(['tornado', 'a']);
		expect(keys().hasUninstallable).toBe(true);
	});

	describe('whether Update and Uninstall are available', () => {
		const installed = [
			pkg('current', false),
			pkg('outdated', true),
			bundledOnly('tornado'),
			bundledOnly('traitlets'),
		];

		it.each([
			['nothing selected', [], false, false],
			['one up-to-date package', ['current'], true, true],
			['one outdated package', ['outdated'], true, true],
			['one package only Positron bundles', ['tornado'], false, false],
			['several packages, none outdated', ['current', 'tornado'], false, true],
			['several packages, one outdated', ['current', 'outdated'], true, true],
			['several packages that are all only bundled', ['tornado', 'traitlets'], false, false],
			['a bundled package alongside an outdated one', ['tornado', 'outdated'], true, true],
		])('%s', async (_label, selection, canUpdate, canUninstall) => {
			const { service, instance, matches } = makeService(installed);
			await instance.refreshPackages();
			service.setSelectedPackages(selection);

			expect({
				update: matches(PACKAGES_CAN_UPDATE_SELECTION),
				uninstall: matches(PACKAGES_CAN_UNINSTALL_SELECTION),
			}).toEqual({ update: canUpdate, uninstall: canUninstall });
		});
	});
});
