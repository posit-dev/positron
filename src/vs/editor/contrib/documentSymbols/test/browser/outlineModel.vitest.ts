/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { DocumentSymbol, SymbolKind } from '../../../../common/languages.js';
import { LanguageFeatureDebounceService } from '../../../../common/services/languageFeatureDebounce.js';
import { LanguageFeaturesService } from '../../../../common/services/languageFeaturesService.js';
import { IModelService } from '../../../../common/services/model.js';
import { createModelServices, createTextModel } from '../../../../test/common/testTextModel.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { OutlineModel, OutlineModelService } from '../../browser/outlineModel.js';

describe('OutlineModelService', () => {
	const ctx = createTestContainer().build();

	function createService(languageFeatures: LanguageFeaturesService): OutlineModelService {
		const modelService = createModelServices(ctx.disposables.add(new DisposableStore())).get(IModelService);
		const debounces = new LanguageFeatureDebounceService(new NullLogService(),
			stubInterface<IEnvironmentService>({ isBuilt: true, isExtensionDevelopment: false }));
		return ctx.disposables.add(new OutlineModelService(languageFeatures, debounces, modelService));
	}

	/**
	 * A source document whose provider answers from another document's
	 * providers, the way a Quarto document answers from its hidden code cells.
	 * Registering a provider for the cell is what changes the source's answer.
	 */
	function dependentDocument() {
		const languageFeatures = new LanguageFeaturesService();
		const source = ctx.disposables.add(createTextModel('# Intro', 'quarto', undefined, URI.file('/test/doc.qmd')));
		const cell = ctx.disposables.add(createTextModel('x <- 1', undefined, undefined, URI.file('/test/cell.r')));
		const cellSymbol: DocumentSymbol = {
			name: 'x', detail: '', kind: SymbolKind.Variable, tags: [],
			range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 },
			selectionRange: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 },
		};
		ctx.disposables.add(languageFeatures.documentSymbolProvider.register({ pattern: '**/doc.qmd' }, {
			provideDocumentSymbols: async () => {
				const downstream = languageFeatures.documentSymbolProvider.ordered(cell);
				return downstream.length > 0 ? [cellSymbol] : [];
			},
		}));
		const registerCellProvider = () => ctx.disposables.add(
			languageFeatures.documentSymbolProvider.register({ pattern: '**/cell.r' }, { provideDocumentSymbols: () => [] }));
		return { languageFeatures, source, registerCellProvider };
	}

	it('asks again when a provider registers for another document, since an answer can depend on it', async () => {
		// The cell's language server registers after the first request, and the
		// Quarto document's own provider list does not change when it does, so a
		// cache keyed on that list alone keeps the empty first answer until the
		// next edit.
		const { languageFeatures, source, registerCellProvider } = dependentDocument();
		const service = createService(languageFeatures);

		const before = await service.getOrCreate(source, CancellationToken.None);
		registerCellProvider();
		const after = await service.getOrCreate(source, CancellationToken.None);

		expect({
			before: before.getTopLevelSymbols().map(s => s.name),
			after: after.getTopLevelSymbols().map(s => s.name),
		}).toEqual({
			before: [],
			after: ['x'],
		});
	});

	it('asks again for a consumer that reacts to the same registry change', async () => {
		// The Outline refreshes from its own listener on the registry, and the
		// first Outline in a window subscribes before this service is built. Its
		// refresh therefore runs before any listener the service adds, so the
		// cache check cannot depend on the service having heard the change first.
		const { languageFeatures, source, registerCellProvider } = dependentDocument();
		let refreshed: Promise<OutlineModel> | undefined;
		const refresh = languageFeatures.documentSymbolProvider.onDidChange(() => {
			refreshed = service.getOrCreate(source, CancellationToken.None);
		});
		const service = createService(languageFeatures);

		await service.getOrCreate(source, CancellationToken.None);
		registerCellProvider();
		const result = await refreshed;
		// Teardown unregisters the providers, which fires this again after the
		// source model is gone.
		refresh.dispose();

		expect(result?.getTopLevelSymbols().map(s => s.name)).toEqual(['x']);
	});

	it('keeps the cached answer for other documents when an unrelated provider registers', async () => {
		// Only Quarto documents answer from other documents' providers. Asking
		// every open document again, which includes every cell of an open
		// notebook, would be work that cannot change the answer.
		const languageFeatures = new LanguageFeaturesService();
		const script = ctx.disposables.add(createTextModel('x = 1', undefined, undefined, URI.file('/test/script.py')));
		let asked = 0;
		ctx.disposables.add(languageFeatures.documentSymbolProvider.register({ pattern: '**/script.py' }, {
			provideDocumentSymbols: () => {
				asked++;
				return [];
			},
		}));
		const service = createService(languageFeatures);

		await service.getOrCreate(script, CancellationToken.None);
		ctx.disposables.add(languageFeatures.documentSymbolProvider.register({ pattern: '**/other.r' }, {
			provideDocumentSymbols: () => [],
		}));
		await service.getOrCreate(script, CancellationToken.None);

		expect(asked).toBe(1);
	});
});
