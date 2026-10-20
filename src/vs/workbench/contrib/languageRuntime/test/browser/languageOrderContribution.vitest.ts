/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { Extensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { LANGUAGE_ORDER_KEY } from '../../../../services/languageRuntime/common/languageOrder.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { getInstalledLanguageIds, getLanguageOrderSchema } from '../../../../services/languageRuntime/common/languageOrderConfiguration.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { LanguageOrderContribution } from '../../browser/languageOrderContribution.js';

describe('LanguageOrderContribution', () => {
	let languageIds: string[];
	const onDidChangeLanguageIds = new Emitter<void>();
	const names: Record<string, string> = { python: 'Python', r: 'R', julia: 'Julia' };

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeStartupService, {
			get languageIds() { return languageIds; },
			onDidChangeLanguageIds: onDidChangeLanguageIds.event,
		})
		.stub(ILanguageService, { getLanguageName: (id: string) => names[id] ?? null })
		.build();

	beforeEach(() => {
		languageIds = ['r', 'python'];
		setOrder(undefined);
	});

	function setOrder(order: string[] | undefined) {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration(LANGUAGE_ORDER_KEY, order);
		configurationService.onDidChangeConfigurationEmitter.fire(stubInterface<IConfigurationChangeEvent>({
			affectsConfiguration: (key: string) => key === LANGUAGE_ORDER_KEY,
		}));
	}

	function items() {
		const schema = getLanguageOrderSchema();
		return { ids: (schema.items as { enum: string[] }).enum, labels: schema.enumItemLabels };
	}

	it('lists installed languages alphabetically by name, with labels', () => {
		ctx.disposables.add(ctx.instantiationService.createInstance(LanguageOrderContribution));
		expect(items()).toEqual({ ids: ['python', 'r'], labels: ['Python', 'R'] });
	});

	it('updates when a language is installed', () => {
		ctx.disposables.add(ctx.instantiationService.createInstance(LanguageOrderContribution));
		languageIds = ['r', 'python', 'julia'];
		onDidChangeLanguageIds.fire();
		expect(items().ids).toEqual(['julia', 'python', 'r']);
	});

	it('falls back to the runtime language name', () => {
		languageIds = ['zig'];
		vi.spyOn(ctx.get(ILanguageRuntimeService), 'registeredRuntimes', 'get').mockReturnValue([
			stubInterface<ILanguageRuntimeMetadata>({ languageId: 'zig', languageName: 'Zig Language' }),
		]);
		ctx.disposables.add(ctx.instantiationService.createInstance(LanguageOrderContribution));
		expect(items().labels).toEqual(['Zig Language']);
	});

	it('falls back to the ID when no runtime names the language', () => {
		languageIds = ['zig'];
		ctx.disposables.add(ctx.instantiationService.createInstance(LanguageOrderContribution));
		expect(items().labels).toEqual(['zig']);
	});

	it('allows saved languages that are not installed, so the value has no error', () => {
		ctx.disposables.add(ctx.instantiationService.createInstance(LanguageOrderContribution));
		setOrder(['zed', 'r']);
		expect(items()).toEqual({ ids: ['python', 'r', 'zed'], labels: ['Python', 'R', 'zed (not installed)'] });
		// So another scope's Settings list doesn't pick up, and then save, this scope's `zed`.
		expect(getInstalledLanguageIds()).toEqual(['python', 'r']);
	});

	it('does not update the schema when a reorder leaves the languages unchanged', () => {
		setOrder(['zed', 'r']);
		ctx.disposables.add(ctx.instantiationService.createInstance(LanguageOrderContribution));
		const notify = vi.spyOn(Registry.as<IConfigurationRegistry>(Extensions.Configuration), 'notifyConfigurationSchemaUpdated');
		setOrder(['r', 'zed']);
		expect(notify).not.toHaveBeenCalled();
	});
});
