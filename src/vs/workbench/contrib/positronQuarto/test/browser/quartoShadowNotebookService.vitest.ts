/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { VSBuffer, VSBufferReadableStream, streamToBuffer } from '../../../../../base/common/buffer.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { INotebookSerializer, INotebookService } from '../../../notebook/common/notebookService.js';
import { QuartoShadowNotebookService } from '../../browser/quartoShadowNotebookService.js';
import { IQuartoDocumentModelService, QuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY } from '../../common/positronQuartoConfig.js';
import { QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE } from '../../common/quartoShadowNotebook.js';

const QMD_CONTENT = [
	'---',
	'title: test',
	'---',
	'',
	'Some prose.',
	'',
	'```{python}',
	'x = 1',
	'```',
	'',
	'```{r}',
	'y <- 2',
	'```',
	'',
].join('\n');

describe('QuartoShadowNotebookService', () => {
	const configurationService = new TestConfigurationService();

	/**
	 * Mini INotebookService faithful to the production behavior the service
	 * relies on: one notebook per URI, created through the registered
	 * serializer, removed from the registry when the model disposes.
	 */
	let registeredSerializer: INotebookSerializer | undefined;
	const notebooksByUri = new Map<string, NotebookTextModel>();
	const notebookServiceStub: Partial<INotebookService> = {
		getContributedNotebookType: () => undefined,
		registerContributedNotebookType: vi.fn(() => toDisposable(() => { })),
		registerNotebookSerializer: vi.fn((_viewType, _extensionData, serializer) => {
			registeredSerializer = serializer;
			return toDisposable(() => { registeredSerializer = undefined; });
		}),
		createNotebookTextModel: async (viewType: string, uri: URI, stream?: VSBufferReadableStream) => {
			if (notebooksByUri.has(uri.toString())) {
				throw new Error(`notebook for ${uri} already exists`);
			}
			const bytes = stream ? await streamToBuffer(stream) : VSBuffer.fromByteArray([]);
			const data = await registeredSerializer!.dataToNotebook(bytes);
			const notebook: NotebookTextModel = ctx.instantiationService.createInstance(
				NotebookTextModel, viewType, uri, data.cells, data.metadata, registeredSerializer!.options);
			notebooksByUri.set(uri.toString(), notebook);
			Event.once(notebook.onWillDispose)(() => notebooksByUri.delete(uri.toString()));
			return notebook;
		},
	};

	// Fresh per test (created in beforeEach) so its text-model listeners are
	// disposed with the test; the stub delegates to the current instance.
	let quartoDocumentModelService: QuartoDocumentModelService;
	const quartoDocumentModelServiceStub: Partial<IQuartoDocumentModelService> = {
		getModel: textModel => quartoDocumentModelService.getModel(textModel),
	};

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IConfigurationService, configurationService)
		.stub(INotebookService, notebookServiceStub)
		.stub(IQuartoDocumentModelService, quartoDocumentModelServiceStub)
		.build();

	beforeEach(async () => {
		notebooksByUri.clear();
		quartoDocumentModelService = ctx.disposables.add(new QuartoDocumentModelService(new NullLogService()));
		await configurationService.setUserConfiguration(QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY, true);
	});

	function createService(): QuartoShadowNotebookService {
		return ctx.disposables.add(ctx.instantiationService.createInstance(QuartoShadowNotebookService));
	}

	function openTextModel(path: string, content: string = QMD_CONTENT) {
		const modelService = ctx.get(IModelService);
		const model = modelService.createModel(content, null, URI.file(path));
		ctx.disposables.add(toDisposable(() => {
			if (!model.isDisposed()) {
				modelService.destroyModel(model.uri);
			}
		}));
		return model;
	}

	function waitForShadow(service: QuartoShadowNotebookService): Promise<NotebookTextModel> {
		return Event.toPromise(service.onDidAddShadowNotebook);
	}

	/** Let the service's async creation path settle without creating anything. */
	async function settle(): Promise<void> {
		for (let i = 0; i < 10; i++) {
			await Promise.resolve();
		}
	}

	it('creates a shadow notebook for a Quarto document opened before the service starts', async () => {
		const model = openTextModel('/before.qmd');
		const service = createService();
		const notebook = await waitForShadow(service);

		expect(notebook.uri.toString()).toBe(model.uri.toString());
		expect(notebook.viewType).toBe(QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE);
		expect(notebook.cells.map(cell => ({ language: cell.language, text: cell.getValue() }))).toEqual([
			{ language: 'python', text: 'x = 1' },
			{ language: 'r', text: 'y <- 2' },
		]);
		expect(service.getShadowNotebook(model.uri)).toBe(notebook);
	});

	it('creates a shadow notebook when a Quarto document opens later', async () => {
		const service = createService();
		const shadowPromise = waitForShadow(service);
		const model = openTextModel('/after.qmd');
		const notebook = await shadowPromise;

		expect(notebook.uri.toString()).toBe(model.uri.toString());
	});

	it('supports .Rmd documents', async () => {
		const service = createService();
		const shadowPromise = waitForShadow(service);
		openTextModel('/report.Rmd', '```{r}\nplot(1)\n```\n');
		const notebook = await shadowPromise;

		expect(notebook.cells.map(cell => cell.language)).toEqual(['r']);
	});

	it('ignores non-Quarto documents', async () => {
		const service = createService();
		const model = openTextModel('/script.py', 'x = 1');
		await settle();

		expect(service.getShadowNotebook(model.uri)).toBeUndefined();
		expect(notebooksByUri.size).toBe(0);
	});

	it('disposes the shadow notebook when the Quarto document closes', async () => {
		const service = createService();
		const shadowPromise = waitForShadow(service);
		const model = openTextModel('/closing.qmd');
		const notebook = await shadowPromise;

		let notebookDisposed = false;
		ctx.disposables.add(notebook.onWillDispose(() => { notebookDisposed = true; }));

		ctx.get(IModelService).destroyModel(model.uri);

		expect(notebookDisposed).toBe(true);
		expect(service.getShadowNotebook(model.uri)).toBeUndefined();
	});

	it('does not create shadows while the setting is disabled', async () => {
		await configurationService.setUserConfiguration(QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY, false);
		const service = createService();
		const model = openTextModel('/disabled.qmd');
		await settle();

		expect(service.getShadowNotebook(model.uri)).toBeUndefined();
	});

	it('tears down and re-creates shadows when the setting is toggled', async () => {
		const service = createService();
		const shadowPromise = waitForShadow(service);
		const model = openTextModel('/toggled.qmd');
		const notebook = await shadowPromise;

		// Disable: the shadow is disposed.
		let notebookDisposed = false;
		ctx.disposables.add(notebook.onWillDispose(() => { notebookDisposed = true; }));
		await configurationService.setUserConfiguration(QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY, false);
		configurationService.onDidChangeConfigurationEmitter.fire({
			affectsConfiguration: key => key === QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY,
			affectedKeys: new Set([QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY]),
			source: 2 /* ConfigurationTarget.USER */,
			change: { keys: [QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY], overrides: [] },
		});
		expect(notebookDisposed).toBe(true);
		expect(service.getShadowNotebook(model.uri)).toBeUndefined();

		// Re-enable: a shadow is created for the still-open document.
		const recreatedPromise = waitForShadow(service);
		await configurationService.setUserConfiguration(QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY, true);
		configurationService.onDidChangeConfigurationEmitter.fire({
			affectsConfiguration: key => key === QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY,
			affectedKeys: new Set([QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY]),
			source: 2 /* ConfigurationTarget.USER */,
			change: { keys: [QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY], overrides: [] },
		});
		const recreated = await recreatedPromise;
		expect(recreated.uri.toString()).toBe(model.uri.toString());
	});

	it('re-creates a shadow notebook that was disposed externally', async () => {
		const service = createService();
		const shadowPromise = waitForShadow(service);
		const model = openTextModel('/killed.qmd');
		const notebook = await shadowPromise;

		// Simulate an external party (e.g. a transient notebook editor model
		// reference) disposing the notebook while the document is still open.
		const recreatedPromise = waitForShadow(service);
		notebook.dispose();
		const recreated = await recreatedPromise;

		expect(recreated).not.toBe(notebook);
		expect(recreated.uri.toString()).toBe(model.uri.toString());
		expect(service.getShadowNotebook(model.uri)).toBe(recreated);
	});

	it('mirrors edits of the text model into the shadow notebook', async () => {
		vi.useFakeTimers();
		const service = createService();
		const shadowPromise = waitForShadow(service);
		const model = openTextModel('/live.qmd');
		const notebook = await shadowPromise;

		model.setValue(QMD_CONTENT.replace('x = 1', 'x = 42'));
		vi.advanceTimersByTime(100); // QuartoDocumentModel reparse debounce

		expect(notebook.cells[0].getValue()).toBe('x = 42');
	});
});
