/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { getLanguageOrderSchema } from '../../../../services/languageRuntime/common/languageOrderConfiguration.js';
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
	});

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
});
