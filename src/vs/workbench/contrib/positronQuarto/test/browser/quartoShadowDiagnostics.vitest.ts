/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IMarkerData, IMarkerService, MarkerSeverity, MarkerTag } from '../../../../../platform/markers/common/markers.js';
import { PositronMarkerService } from '../../../../../platform/markers/common/positronMarkerService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { QuartoShadowDiagnosticsContribution, QuartoShadowNotebookDiagnostics } from '../../browser/quartoShadowDiagnostics.js';
import { QuartoShadowLanguageBridge } from '../../browser/quartoShadowLanguageBridge.js';
import { IQuartoShadowNotebookService } from '../../browser/quartoShadowNotebookService.js';
import { QuartoShadowNotebookSync } from '../../browser/quartoShadowNotebookSync.js';
import { QUARTO_SHADOW_DIAGNOSTICS_OWNER_PREFIX } from '../../common/positronQuartoConfig.js';
import { QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE } from '../../common/quartoShadowNotebook.js';

/** The document model's reparse debounce (quartoDocumentModel.ts). */
const REPARSE_DEBOUNCE_MS = 100;

function qmd(...cells: [language: string, code: string][]): string {
	const parts = ['---', 'title: test', '---', '', 'Some prose.', ''];
	for (const [language, code] of cells) {
		parts.push('```{' + language + '}', code, '```', '', 'More prose.', '');
	}
	return parts.join('\n');
}

/** 1-based line number of the first line containing `needle`. */
function lineOf(content: string, needle: string): number {
	const index = content.split('\n').findIndex(line => line.includes(needle));
	if (index < 0) {
		throw new Error(`No line contains: ${needle}`);
	}
	return index + 1;
}

function cellMarker(overrides: Partial<IMarkerData> = {}): IMarkerData {
	return {
		severity: MarkerSeverity.Error,
		message: 'undefined name',
		startLineNumber: 1,
		startColumn: 1,
		endLineNumber: 1,
		endColumn: 6,
		...overrides,
	};
}

describe('QuartoShadowNotebookDiagnostics', () => {
	/** Live per-test documents, keyed by URI; the service stubs read them. */
	const documents = new Map<string, QuartoDocumentModel>();
	const shadows = new Map<string, { notebook: NotebookTextModel; sync: QuartoShadowNotebookSync }>();
	const onDidAddShadowNotebook = new Emitter<NotebookTextModel>();
	const markerService = new PositronMarkerService();

	const ctx = createTestContainer().withWorkbenchServices()
		.stub(IMarkerService, markerService)
		.stub(IQuartoDocumentModelService, {
			hasModel: (uri: URI) => documents.has(uri.toString()),
			getModelForUri: (uri: URI) => {
				const model = documents.get(uri.toString());
				if (!model) {
					throw new Error(`No document model for ${uri.toString()}`);
				}
				return model;
			},
		})
		.stub(IQuartoShadowNotebookService, {
			onDidAddShadowNotebook: onDidAddShadowNotebook.event,
			getShadowNotebook: (uri: URI) => shadows.get(uri.toString())?.notebook,
		})
		.build();

	beforeEach(() => {
		vi.useFakeTimers();
		documents.clear();
		shadows.clear();
		// The marker service is shared across tests; remove residue.
		for (const marker of markerService.read({ ignoreResourceFilters: true })) {
			markerService.changeOne(marker.owner, marker.resource, []);
		}
	});

	/** Create a .qmd text model with a live document model and shadow notebook. */
	function createDocument(content: string, path = '/test.qmd') {
		const uri = URI.file(path);
		const textModel = ctx.disposables.add(createTextModel(content, null, undefined, uri));
		const documentModel = ctx.disposables.add(new QuartoDocumentModel(textModel, new NullLogService()));
		documents.set(uri.toString(), documentModel);
		const notebook: NotebookTextModel = ctx.disposables.add(ctx.instantiationService.createInstance(
			NotebookTextModel,
			QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE,
			uri,
			[],
			{},
			{ transientOutputs: true, transientCellMetadata: {}, transientDocumentMetadata: {}, cellContentMetadata: {} },
		));
		const sync = ctx.disposables.add(ctx.instantiationService.createInstance(QuartoShadowNotebookSync, documentModel, notebook));
		shadows.set(uri.toString(), { notebook, sync });
		return { uri, textModel, documentModel, notebook };
	}

	function createProjector(doc: ReturnType<typeof createDocument>): QuartoShadowNotebookDiagnostics {
		const bridge = ctx.instantiationService.createInstance(QuartoShadowLanguageBridge);
		return ctx.disposables.add(ctx.instantiationService.createInstance(
			QuartoShadowNotebookDiagnostics, doc.notebook, doc.documentModel, bridge));
	}

	/**
	 * Let a marker change settle: `changeOne` fires its event on a microtask,
	 * the projector reacts on a deferred 0ms scheduler, and its own write
	 * fires another microtask event. Interleave microtask flushes with timer
	 * advances until the chain has run out (the advance also covers the
	 * document model's reparse debounce).
	 */
	async function settle(): Promise<void> {
		for (let i = 0; i < 5; i++) {
			await Promise.resolve();
			vi.advanceTimersByTime(REPARSE_DEBOUNCE_MS);
			await Promise.resolve();
		}
	}

	/** The projected markers on a document, normalized for assertions. */
	function projectedMarkers(uri: URI) {
		return markerService.read({ resource: uri }).map(marker => ({
			owner: marker.owner,
			message: marker.message,
			range: {
				startLineNumber: marker.startLineNumber,
				startColumn: marker.startColumn,
				endLineNumber: marker.endLineNumber,
				endColumn: marker.endColumn,
			},
		}));
	}

	it('projects a cell marker onto the .qmd at document coordinates, preserving metadata', async () => {
		const content = qmd(['python', 'x = undefined_name']);
		const doc = createDocument(content);
		createProjector(doc);

		markerService.changeOne('ruff', doc.notebook.cells[0].uri, [cellMarker({
			severity: MarkerSeverity.Warning,
			source: 'Ruff',
			code: 'F821',
			tags: [MarkerTag.Unnecessary],
			startColumn: 5,
			endColumn: 19,
		})]);
		await settle();

		const codeLine = lineOf(content, 'x = undefined_name');
		const markers = markerService.read({ resource: doc.uri });
		expect(markers.map(marker => ({
			owner: marker.owner,
			severity: marker.severity,
			message: marker.message,
			source: marker.source,
			code: marker.code,
			tags: marker.tags,
			range: {
				startLineNumber: marker.startLineNumber,
				startColumn: marker.startColumn,
				endLineNumber: marker.endLineNumber,
				endColumn: marker.endColumn,
			},
		}))).toEqual([{
			owner: `${QUARTO_SHADOW_DIAGNOSTICS_OWNER_PREFIX}/ruff`,
			severity: MarkerSeverity.Warning,
			message: 'undefined name',
			source: 'Ruff',
			code: 'F821',
			tags: [MarkerTag.Unnecessary],
			range: { startLineNumber: codeLine, startColumn: 5, endLineNumber: codeLine, endColumn: 19 },
		}]);
	});

	it('maps relatedInformation cell entries onto the .qmd and passes real-file entries through', async () => {
		const content = qmd(['python', 'x = 1\ny = x'], ['python', 'z = y']);
		const doc = createDocument(content);
		createProjector(doc);
		const realFile = URI.file('/elsewhere.py');

		markerService.changeOne('pyrefly', doc.notebook.cells[1].uri, [cellMarker({
			relatedInformation: [
				{
					// First cell, second code line ('y = x').
					resource: doc.notebook.cells[0].uri,
					message: 'defined here',
					startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2,
				},
				{
					resource: realFile,
					message: 'imported here',
					startLineNumber: 7, startColumn: 1, endLineNumber: 7, endColumn: 5,
				},
			],
		})]);
		await settle();

		const [marker] = markerService.read({ resource: doc.uri });
		expect(marker.relatedInformation?.map(info => ({
			resource: info.resource.toString(),
			message: info.message,
			startLineNumber: info.startLineNumber,
		}))).toEqual([
			{ resource: doc.uri.toString(), message: 'defined here', startLineNumber: lineOf(content, 'y = x') },
			{ resource: realFile.toString(), message: 'imported here', startLineNumber: 7 },
		]);
	});

	it('suppresses raw cell markers from regular reads while ignoreResourceFilters readers still see them', async () => {
		const doc = createDocument(qmd(['python', 'x = 1']));
		createProjector(doc);
		const cellUri = doc.notebook.cells[0].uri;

		markerService.changeOne('ruff', cellUri, [cellMarker()]);
		await settle();

		expect({
			regularReadOfCell: markerService.read({ resource: cellUri }),
			cellResourcesInGlobalRead: markerService.read().filter(marker => marker.resource.scheme === 'vscode-notebook-cell'),
			// The path the extension host bridge reads through: the raw data
			// must stay (it backs the DiagnosticCollections code actions read).
			rawReadOfCell: markerService.read({ resource: cellUri, ignoreResourceFilters: true }).map(m => m.message),
			projected: projectedMarkers(doc.uri).map(m => m.message),
		}).toEqual({
			regularReadOfCell: [],
			cellResourcesInGlobalRead: [],
			rawReadOfCell: ['undefined name'],
			projected: ['undefined name'],
		});
	});

	it('keys projected owners per source owner so servers never clobber each other', async () => {
		const doc = createDocument(qmd(['python', 'x = 1']));
		createProjector(doc);
		const cellUri = doc.notebook.cells[0].uri;

		markerService.changeOne('ruff', cellUri, [cellMarker({ message: 'from ruff' })]);
		markerService.changeOne('pyrefly', cellUri, [cellMarker({ message: 'from pyrefly' })]);
		await settle();
		const bothProjected = projectedMarkers(doc.uri).map(m => ({ owner: m.owner, message: m.message }));

		// One server clears; the other's projection must survive.
		markerService.changeOne('ruff', cellUri, []);
		await settle();

		expect({
			bothProjected: bothProjected.sort((a, b) => a.owner.localeCompare(b.owner)),
			afterRuffCleared: projectedMarkers(doc.uri).map(m => ({ owner: m.owner, message: m.message })),
		}).toEqual({
			bothProjected: [
				{ owner: `${QUARTO_SHADOW_DIAGNOSTICS_OWNER_PREFIX}/pyrefly`, message: 'from pyrefly' },
				{ owner: `${QUARTO_SHADOW_DIAGNOSTICS_OWNER_PREFIX}/ruff`, message: 'from ruff' },
			],
			afterRuffCleared: [
				{ owner: `${QUARTO_SHADOW_DIAGNOSTICS_OWNER_PREFIX}/pyrefly`, message: 'from pyrefly' },
			],
		});
	});

	it('passes .qmd markers from other sources (e.g. Quarto prose diagnostics) through untouched', async () => {
		const doc = createDocument(qmd(['python', 'x = 1']));
		createProjector(doc);

		// The Quarto extension writes its own markers directly on the .qmd.
		markerService.changeOne('quarto', doc.uri, [cellMarker({ message: 'broken cross-reference', startLineNumber: 5, endLineNumber: 5 })]);
		markerService.changeOne('ruff', doc.notebook.cells[0].uri, [cellMarker({ message: 'from a cell' })]);
		await settle();
		const withBoth = projectedMarkers(doc.uri).map(m => ({ owner: m.owner, message: m.message }));

		// The cell diagnostics clearing must not touch the prose marker.
		markerService.changeOne('ruff', doc.notebook.cells[0].uri, []);
		await settle();

		expect({
			withBoth: withBoth.sort((a, b) => a.owner.localeCompare(b.owner)),
			afterCellCleared: projectedMarkers(doc.uri).map(m => ({ owner: m.owner, message: m.message })),
		}).toEqual({
			withBoth: [
				{ owner: 'quarto', message: 'broken cross-reference' },
				{ owner: `${QUARTO_SHADOW_DIAGNOSTICS_OWNER_PREFIX}/ruff`, message: 'from a cell' },
			],
			afterCellCleared: [{ owner: 'quarto', message: 'broken cross-reference' }],
		});
	});

	it('drops markers starting beyond the cell code and clamps markers overrunning the cell end', async () => {
		const content = qmd(['python', 'x = 1\ny = 2']);
		const doc = createDocument(content);
		createProjector(doc);

		markerService.changeOne('ruff', doc.notebook.cells[0].uri, [
			// A stale marker beyond the 2 code lines: dropped.
			cellMarker({ message: 'stale', startLineNumber: 5, endLineNumber: 5 }),
			// Starts inside, overruns the cell: end clamped to the last code line.
			cellMarker({ message: 'overrun', startLineNumber: 2, endLineNumber: 4, endColumn: 3 }),
		]);
		await settle();

		const lastCodeLine = lineOf(content, 'y = 2');
		expect(projectedMarkers(doc.uri).map(m => ({ message: m.message, startLineNumber: m.range.startLineNumber, endLineNumber: m.range.endLineNumber }))).toEqual([
			{ message: 'overrun', startLineNumber: lastCodeLine, endLineNumber: lastCodeLine },
		]);
	});

	it('re-projects at shifted positions when prose above the cell changes', async () => {
		const content = qmd(['python', 'x = 1']);
		const doc = createDocument(content);
		createProjector(doc);
		markerService.changeOne('ruff', doc.notebook.cells[0].uri, [cellMarker()]);
		await settle();
		const lineBefore = projectedMarkers(doc.uri)[0].range.startLineNumber;

		// Insert prose above the cell: the cell's text (and so the server's
		// cell-space markers) is unchanged, but its document offset shifts.
		doc.textModel.setValue(content.replace('Some prose.', 'Some prose.\nMore prose above the cell.'));
		await settle();

		expect({
			lineBefore,
			lineAfter: projectedMarkers(doc.uri)[0].range.startLineNumber,
		}).toEqual({ lineBefore, lineAfter: lineBefore + 1 });
	});

	it('converges after a storm of marker changes and stays quiet on no-op reparses', async () => {
		const content = qmd(['python', 'x = 1']);
		const doc = createDocument(content);
		createProjector(doc);
		const cellUri = doc.notebook.cells[0].uri;

		// Storm: many rapid publishes for the same cell.
		for (let i = 0; i < 20; i++) {
			markerService.changeOne('ruff', cellUri, [cellMarker({ message: `round ${i}` })]);
		}
		await settle();

		// Steady state: no further .qmd marker events (a re-projection loop
		// or a redundant rewrite on the next reparse would fire one).
		let qmdEvents = 0;
		const listener = markerService.onMarkerChanged(resources => {
			if (resources.some(resource => resource.toString() === doc.uri.toString())) {
				qmdEvents++;
			}
		});
		// A no-op reparse: identical content still fires onDidParse.
		doc.textModel.setValue(content);
		await settle();
		listener.dispose();

		expect({
			projected: projectedMarkers(doc.uri).map(m => m.message),
			qmdEventsAfterSettle: qmdEvents,
		}).toEqual({ projected: ['round 19'], qmdEventsAfterSettle: 0 });
	});

	it('cleans up projected markers on splice and releases the suppression once stale markers clear', async () => {
		const content = qmd(['python', 'x = 1'], ['python', 'y = 2']);
		const doc = createDocument(content);
		createProjector(doc);
		const secondCellUri = doc.notebook.cells[1].uri;
		markerService.changeOne('ruff', secondCellUri, [cellMarker({ message: 'in removed cell' })]);
		await settle();
		const projectedBefore = projectedMarkers(doc.uri).map(m => m.message);

		// Remove the second cell from the document.
		doc.textModel.setValue(qmd(['python', 'x = 1']));
		await settle();
		// The server hasn't cleared the dead cell's markers yet: its
		// projection is gone AND the stale raw markers must stay hidden.
		const afterSplice = {
			projected: projectedMarkers(doc.uri),
			staleCellRead: markerService.read({ resource: secondCellUri }),
		};

		// The server clears the dead cell (didClose): the suppression is
		// released, so a later marker on that URI (no longer ours) shows.
		markerService.changeOne('ruff', secondCellUri, []);
		await settle();
		markerService.changeOne('someone-else', secondCellUri, [cellMarker({ message: 'not ours anymore' })]);
		await settle();

		expect({
			projectedBefore,
			afterSplice,
			afterRelease: markerService.read({ resource: secondCellUri }).map(m => m.message),
		}).toEqual({
			projectedBefore: ['in removed cell'],
			afterSplice: { projected: [], staleCellRead: [] },
			afterRelease: ['not ours anymore'],
		});
	});

	it('attaches via the contribution and cleans up when the shadow notebook is disposed (document close / setting off)', async () => {
		const doc = createDocument(qmd(['python', 'x = 1']));
		const cellUri = doc.notebook.cells[0].uri;
		const contribution = ctx.disposables.add(ctx.instantiationService.createInstance(QuartoShadowDiagnosticsContribution));
		onDidAddShadowNotebook.fire(doc.notebook);

		markerService.changeOne('ruff', cellUri, [cellMarker()]);
		await settle();
		const whileAlive = {
			projected: projectedMarkers(doc.uri).map(m => m.message),
			cellHidden: markerService.read({ resource: cellUri }).length === 0,
		};

		// Turning the setting off (or closing the document) disposes the
		// shadow notebook; the projection and the suppression must go too.
		doc.notebook.dispose();
		await settle();

		expect({
			whileAlive,
			afterDispose: {
				projected: projectedMarkers(doc.uri),
				// Suppression released: the not-yet-cleared cell marker is
				// visible again (the server clears it moments later).
				cellRead: markerService.read({ resource: cellUri }).map(m => m.message),
			},
		}).toEqual({
			whileAlive: { projected: ['undefined name'], cellHidden: true },
			afterDispose: { projected: [], cellRead: ['undefined name'] },
		});
		contribution.dispose();
	});
});
