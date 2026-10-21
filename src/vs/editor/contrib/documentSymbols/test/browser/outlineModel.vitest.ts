/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { CancellationError, transformErrorForSerialization, transformErrorFromSerialization } from '../../../../../base/common/errors.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { DocumentSymbol, SymbolKind } from '../../../../common/languages.js';
import { ITextModel } from '../../../../common/model.js';
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

	/** A one-line variable symbol named `name` on a line `lineLength` characters long. */
	function variableSymbol(name: string, lineLength: number): DocumentSymbol {
		return {
			name, detail: '', kind: SymbolKind.Variable, tags: [],
			range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: lineLength + 1 },
			selectionRange: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: name.length + 1 },
		};
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
		const cellSymbol = variableSymbol('x', 'x <- 1'.length);
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

	/**
	 * The way a language server's own cancellation reaches this layer: the
	 * extension throws a CancellationError, and the extension host RPC rejects
	 * with it rebuilt as a plain Error named 'Canceled'.
	 */
	function providerCancellation(): Error {
		return transformErrorFromSerialization(transformErrorForSerialization(new CancellationError()));
	}

	/**
	 * A script whose provider cancels its first `cancellations` requests on its
	 * own, then answers with one symbol. `stopCancelling` makes it answer from
	 * the next request on.
	 */
	function scriptCancelledByProvider(cancellations: number) {
		const languageFeatures = new LanguageFeaturesService();
		const script = ctx.disposables.add(createTextModel('x = 1', undefined, undefined, URI.file('/test/script.py')));
		let cancelsLeft = cancellations;
		ctx.disposables.add(languageFeatures.documentSymbolProvider.register({ pattern: '**/script.py' }, {
			provideDocumentSymbols: async () => {
				if (cancelsLeft-- > 0) {
					throw providerCancellation();
				}
				return [variableSymbol('x', 'x = 1'.length)];
			},
		}));
		return { languageFeatures, script, stopCancelling: () => { cancelsLeft = 0; } };
	}

	/** Runs `getOrCreate` to completion, including the backoff between retries. */
	async function getOrCreateWithRetries(service: OutlineModelService, textModel: ITextModel): Promise<OutlineModel> {
		const created = service.getOrCreate(textModel, CancellationToken.None);
		await vi.runAllTimersAsync();
		return created;
	}

	describe('when the provider cancels a request the caller did not cancel', () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('asks again', async () => {
			// Pyrefly cancels an in-flight documentSymbol request when a configuration
			// change arrives behind it, which happens while a reloaded window settles.
			// Answering that cancellation with no symbols left the Outline empty.
			const { languageFeatures, script } = scriptCancelledByProvider(1);
			const service = createService(languageFeatures);

			const model = await getOrCreateWithRetries(service, script);

			expect(model.getTopLevelSymbols().map(s => s.name)).toEqual(['x']);
		});

		it('keeps asking with a backoff while the cancellations continue', async () => {
			// Configuration changes can arrive in a burst, so an immediate retry can
			// be cancelled too. The Outline only asks again on an edit, so an empty
			// answer here is what it would show.
			const { languageFeatures, script } = scriptCancelledByProvider(3);
			const service = createService(languageFeatures);

			const model = await getOrCreateWithRetries(service, script);

			expect(model.getTopLevelSymbols().map(s => s.name)).toEqual(['x']);
		});

		it('gives up after a bounded number of tries and does not keep the empty answer', async () => {
			// The cache is keyed on the document version, so a cached empty answer
			// would last until the next edit even though the provider can now answer.
			const { languageFeatures, script, stopCancelling } = scriptCancelledByProvider(Number.POSITIVE_INFINITY);
			const service = createService(languageFeatures);

			const first = await getOrCreateWithRetries(service, script);
			stopCancelling();
			const second = await getOrCreateWithRetries(service, script);

			expect({
				first: first.getTopLevelSymbols().map(s => s.name),
				firstProviderCancelled: first.providerCancelled,
				second: second.getTopLevelSymbols().map(s => s.name),
			}).toEqual({
				first: [],
				firstProviderCancelled: true,
				second: ['x'],
			});
		});
	});

	it('does not ask again when the caller cancelled the request', async () => {
		// The provider rejects with the same cancellation error either way; only
		// the caller's token tells a cancelled caller from a provider that gave up.
		const languageFeatures = new LanguageFeaturesService();
		const script = ctx.disposables.add(createTextModel('x = 1', undefined, undefined, URI.file('/test/script.py')));
		let asked = 0;
		ctx.disposables.add(languageFeatures.documentSymbolProvider.register({ pattern: '**/script.py' }, {
			provideDocumentSymbols: (_model, token) => {
				asked++;
				return new Promise<DocumentSymbol[]>((_resolve, reject) => {
					ctx.disposables.add(token.onCancellationRequested(() => reject(providerCancellation())));
				});
			},
		}));
		const source = ctx.disposables.add(new CancellationTokenSource());

		const created = OutlineModel.create(languageFeatures.documentSymbolProvider, script, source.token);
		source.cancel();
		const model = await created;

		expect({ asked, providerCancelled: model.providerCancelled }).toEqual({ asked: 1, providerCancelled: false });
	});
});
