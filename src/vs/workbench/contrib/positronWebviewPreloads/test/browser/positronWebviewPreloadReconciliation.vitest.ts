/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CellEditType, CellKind, IOutputDto } from '../../../notebook/common/notebookCommon.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from '../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IPositronNotebookInstance } from '../../../positronNotebook/browser/IPositronNotebookInstance.js';
import { PositronWebviewPreloadService } from '../../browser/positronWebviewPreloadsService.js';
import { NotebookPreloadOutputResults } from '../../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';

/**
 * Regression coverage for #12887: overlay webviews (display plots + raw HTML)
 * must be disposed when their output leaves the model (cleared, cell deleted,
 * replaced), while comm-backed widgets must be left alone. Drives the service
 * against a real NotebookTextModel with a stubbed output-webview service whose
 * fakes track disposal.
 */
describe('Positron - PositronWebviewPreloadService output reconciliation (#12887)', () => {
	// Track fakes the stub hands out: `disposedById` keyed by latest output ID
	// (leak/exclusion checks); `created` keeps every instance (rebuild checks).
	const disposedById = new Map<string, boolean>();
	interface FakeWebview extends INotebookOutputWebview { disposed: boolean }
	const created: FakeWebview[] = [];

	function makeFakeWebview(id: string): FakeWebview {
		disposedById.set(id, false);
		const fake: FakeWebview = {
			id,
			sessionId: 'test-session',
			disposed: false,
			// Reconciliation never touches the underlying overlay; a minimal stub suffices.
			webview: stubInterface<IOverlayWebview>(),
			onDidRender: Event.None,
			dispose: () => {
				fake.disposed = true;
				disposedById.set(id, true);
			},
		};
		created.push(fake);
		return fake;
	}

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IPositronNotebookOutputWebviewService, {
			createMultiMessageWebview: ({ displayMessage }: { displayMessage: { id: string } }) =>
				Promise.resolve(makeFakeWebview(displayMessage.id)),
			createNotebookOutputWebview: ({ id }: { id: string }) =>
				Promise.resolve(makeFakeWebview(id)),
			createRawHtmlOutputWebview: (id: string) =>
				Promise.resolve(makeFakeWebview(id)),
		})
		.build();

	let service: PositronWebviewPreloadService;

	beforeEach(() => {
		disposedById.clear();
		created.length = 0;
		// Construct after stubs so the service captures the stubbed output-webview service.
		service = ctx.disposables.add(
			ctx.instantiationService.createInstance(PositronWebviewPreloadService)
		);
	});

	const NOTEBOOK_URI = URI.parse('test:///reconcile/notebook.ipynb');

	const plotlyOutput: IOutputDto = {
		outputId: 'display-1',
		outputs: [{ mime: 'application/vnd.plotly.v1+json', data: VSBuffer.fromString('{}') }],
	};
	const widgetOutput: IOutputDto = {
		outputId: 'widget-1',
		outputs: [{ mime: 'application/vnd.jupyter.widget-view+json', data: VSBuffer.fromString('{}') }],
	};

	/** Real single-cell NotebookTextModel + a minimal instance exposing what the service reads. */
	function setupNotebook(outputs: IOutputDto[]) {
		const textModel = ctx.disposables.add(ctx.instantiationService.createInstance(
			NotebookTextModel,
			'jupyter-notebook',
			NOTEBOOK_URI,
			[{
				source: 'plot()',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs,
				metadata: {},
				internalMetadata: {},
			}],
			{},
			{ transientCellMetadata: {}, transientDocumentMetadata: {}, cellContentMetadata: {}, transientOutputs: false },
		));

		const onDidChangeModel = ctx.disposables.add(new Emitter<NotebookTextModel | undefined>());
		const instance = stubInterface<IPositronNotebookInstance>({
			getId: () => 'reconcile-notebook',
			uri: NOTEBOOK_URI,
			textModel,
			onDidChangeModel: onDidChangeModel.event,
		});

		service.attachNotebookInstance(instance);
		return { textModel, instance };
	}

	/** Await the webview a display/widget result carries (narrows out the webview-less 'preload' member). */
	async function awaitWebview(result: NotebookPreloadOutputResults | undefined) {
		if (!result || result.preloadMessageType === 'preload') {
			throw new Error(`expected a webview-bearing result, got ${result?.preloadMessageType}`);
		}
		return result.webview;
	}

	/** Clear the (only) cell's outputs, the way the Clear Output action does. */
	function clearOutputs(textModel: NotebookTextModel) {
		textModel.applyEdits(
			[{ editType: CellEditType.Output, index: 0, outputs: [], append: false }],
			true, undefined, () => undefined, undefined, false,
		);
	}

	/**
	 * Drain reconciliation. Disposal is chained off a resolved Promise, so it
	 * lands a microtask later; a few macrotask hops flush it.
	 */
	async function flushReconciliation() {
		for (let i = 0; i < 3; i++) {
			await timeout(0);
		}
	}

	it('disposes an orphaned display webview when its output is cleared', async () => {
		const { textModel, instance } = setupNotebook([plotlyOutput]);

		const result = service.addNotebookOutput({ instance, outputId: 'display-1', outputs: plotlyOutput.outputs });
		expect(result?.preloadMessageType).toBe('display');
		await awaitWebview(result);
		expect(disposedById.get('display-1'), 'webview is alive while the output exists').toBe(false);

		clearOutputs(textModel);
		await flushReconciliation();

		expect(disposedById.get('display-1'), 'cleared output must dispose its overlay webview').toBe(true);
	});

	it('disposes an orphaned display webview when the output type changes (re-run)', async () => {
		const { textModel, instance } = setupNotebook([plotlyOutput]);

		const result = service.addNotebookOutput({ instance, outputId: 'display-1', outputs: plotlyOutput.outputs });
		expect(result?.preloadMessageType).toBe('display');
		await awaitWebview(result);
		expect(disposedById.get('display-1')).toBe(false);

		// Re-running the cell replaces the plot output with a plain-text output
		// under a new output ID -- the original overlay is now orphaned.
		textModel.applyEdits(
			[{
				editType: CellEditType.Output,
				index: 0,
				outputs: [{
					outputId: 'text-2',
					outputs: [{ mime: 'application/vnd.code.notebook.stdout', data: VSBuffer.fromString('done') }],
				}],
				append: false,
			}],
			true, undefined, () => undefined, undefined, false,
		);
		await flushReconciliation();

		expect(disposedById.get('display-1'), 'a changed output type must dispose the stale overlay webview').toBe(true);
	});

	it('rebuilds a display webview when its content changes under the same output ID', async () => {
		const { instance } = setupNotebook([plotlyOutput]);

		await awaitWebview(service.addNotebookOutput({ instance, outputId: 'display-1', outputs: plotlyOutput.outputs }));
		expect(created.length, 'first render creates one webview').toBe(1);

		// A Jupyter update_display_data keeps the same output ID but swaps the
		// content. parseCellOutputs() re-runs and calls addNotebookOutput again
		// with the new bytes -- the cached webview is stale and must be rebuilt.
		const updatedOutputs = [{ mime: 'application/vnd.plotly.v1+json', data: VSBuffer.fromString('{"updated":true}') }];
		await awaitWebview(service.addNotebookOutput({ instance, outputId: 'display-1', outputs: updatedOutputs }));

		expect(created.length, 'a content change must build a second, distinct webview').toBe(2);
		expect(created[0].disposed, 'the stale webview must be disposed').toBe(true);
		expect(created[1].disposed, 'the fresh webview stays alive').toBe(false);

		// The re-parse that does NOT change content must reuse, not churn.
		await awaitWebview(service.addNotebookOutput({ instance, outputId: 'display-1', outputs: updatedOutputs }));
		expect(created.length, 'unchanged content reuses the live webview -- no rebuild').toBe(2);
	});

	it('disposes an orphaned raw HTML webview when its cell is deleted', async () => {
		const rawHtml = '<iframe src="https://example.com/map"></iframe>';
		const htmlOutput: IOutputDto = {
			outputId: 'html-1',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString(rawHtml) }],
		};
		const { textModel, instance } = setupNotebook([htmlOutput]);

		const result = service.addNotebookOutput({ instance, outputId: 'html-1', outputs: htmlOutput.outputs, rawHtml });
		expect(result?.preloadMessageType).toBe('display');
		await awaitWebview(result);
		expect(disposedById.get('html-1'), 'webview is alive while the cell exists').toBe(false);

		// Delete the whole cell, the way the Delete Cell action does.
		textModel.applyEdits(
			[{ editType: CellEditType.Replace, index: 0, count: 1, cells: [] }],
			true, undefined, () => undefined, undefined, false,
		);
		await flushReconciliation();

		expect(disposedById.get('html-1'), 'deleting the cell must dispose its overlay webview').toBe(true);
	});

	it('reconciliation disposes an overlay but spares a widget sharing the cell', async () => {
		// Widgets need a live notebook session to be created.
		const runtime = await createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, {
			runtime,
			notebookUri: NOTEBOOK_URI,
			sessionMode: LanguageRuntimeSessionMode.Notebook,
		});
		await waitForRuntimeState(session, RuntimeState.Ready);
		expect(ctx.get(IRuntimeSessionService).getNotebookSessionForNotebookUri(NOTEBOOK_URI)).toBeDefined();

		// One cell with both an overlay and a widget. Clearing removes both
		// outputs, so one reconciliation pass sees both gone: the overlay must be
		// disposed (proving the pass ran) and the widget must survive.
		const { textModel, instance } = setupNotebook([plotlyOutput, widgetOutput]);

		const display = service.addNotebookOutput({ instance, outputId: 'display-1', outputs: plotlyOutput.outputs });
		expect(display?.preloadMessageType).toBe('display');
		await awaitWebview(display);

		const widget = service.addNotebookOutput({ instance, outputId: 'widget-1', outputs: widgetOutput.outputs });
		expect(widget?.preloadMessageType).toBe('widget');
		await awaitWebview(widget);

		expect(disposedById.get('display-1')).toBe(false);
		expect(disposedById.get('widget-1')).toBe(false);

		clearOutputs(textModel);
		await flushReconciliation();

		expect(disposedById.get('display-1'), 'reconciliation ran and disposed the orphaned overlay').toBe(true);
		expect(disposedById.get('widget-1'), 'the same reconciliation pass must spare the widget webview').toBe(false);
	});
});
