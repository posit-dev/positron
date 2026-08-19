/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { ILogService, LogLevel } from '../../../../../platform/log/common/log.js';
import {
	IMarker,
	IMarkerData,
	IRelatedInformation,
	MarkerSeverity,
} from '../../../../../platform/markers/common/markers.js';
import { MarkerService } from '../../../../../platform/markers/common/markerService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IQuartoDocumentModel } from '../../common/quartoTypes.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { QUARTO_EMBEDDED_DIAGNOSTICS_OWNER } from '../../common/quartoVirtualNotebookTypes.js';
import { IQuartoVirtualCell, IQuartoVirtualNotebookService } from '../../browser/quartoVirtualNotebookService.js';
import { QuartoEmbeddedDiagnostics } from '../../browser/quartoEmbeddedDiagnostics.js';

// The source document, with two chunks:
//
//    1  # Intro
//    2
//    3  ```{r}
//    4  x <- 1
//    5  y <- 2
//    6  z <- 3
//    7  ```
//    8  ```{python}
//    9  a = 1
//   10  b = 2
//   11  c = 3
//   12  ```
const SOURCE_URI = URI.file('/test/doc.qmd');
const NOTEBOOK_URI = URI.parse('quarto-cells:/test/doc.qmd');
const R_CELL_URI = URI.parse('vscode-notebook-cell:/test/doc.qmd#ch0');
const PYTHON_CELL_URI = URI.parse('vscode-notebook-cell:/test/doc.qmd#ch1');
/** A file that has nothing to do with any Quarto document. */
const OTHER_URI = URI.file('/test/other.R');

/**
 * Waits for everything a marker change sets off. Marker changes are delivered on
 * a microtask and the republish is deferred onto another one, so a macrotask is
 * the reliable way to be past both.
 */
function settle(): Promise<void> {
	return new Promise<void>(resolve => setTimeout(resolve, 0));
}

function marker(overrides: Partial<IMarkerData> = {}): IMarkerData {
	return {
		severity: MarkerSeverity.Error,
		message: 'object not found',
		source: 'ark',
		code: 'E1',
		// Line 2 of the cell, which is line 5 of the source for the R chunk.
		startLineNumber: 2,
		startColumn: 3,
		endLineNumber: 2,
		endColumn: 8,
		...overrides,
	};
}

/** The fields worth comparing, in the order a reader wants them. */
function summarize(m: IMarker | IRelatedInformation) {
	const asMarker = m as IMarker;
	return {
		resource: m.resource.path,
		message: m.message,
		...(asMarker.owner === undefined ? {} : {
			owner: asMarker.owner,
			severity: asMarker.severity,
			source: asMarker.source,
			code: asMarker.code,
		}),
		range: [m.startLineNumber, m.startColumn, m.endLineNumber, m.endColumn],
	};
}

describe('QuartoEmbeddedDiagnostics', () => {
	let markerService: MarkerService;
	let traces: string[];
	let cells: IQuartoVirtualCell[];
	let sourceTextModel: ITextModel;
	let onDidParse: Emitter<void>;
	/** Whether the document still has a virtual notebook, cells or not. */
	let notebookExists: boolean;

	function cell(cellUri: URI, language: string, codeStartLine: number, codeEndLine: number): IQuartoVirtualCell {
		return {
			cellUri,
			handle: 0,
			language,
			codeStartLine,
			codeEndLine,
			// The remapper works off the line spans alone. A stub that throws on
			// every read is what holds it to that.
			textModel: stubInterface<ITextModel>(),
		};
	}

	beforeEach(() => {
		markerService = new MarkerService();
		traces = [];
		cells = [
			cell(R_CELL_URI, 'r', 4, 6),
			cell(PYTHON_CELL_URI, 'python', 9, 11),
		];
		// A real model, for a real onWillDispose: closing the document is how the
		// re-offsetting subscription is meant to end.
		sourceTextModel = createTextModel('', 'quarto', undefined, SOURCE_URI);
		onDidParse = new Emitter<void>();
		notebookExists = true;
	});

	afterEach(() => {
		onDidParse.dispose();
		if (!sourceTextModel.isDisposed()) {
			sourceTextModel.dispose();
		}
		markerService.dispose();
	});

	function createDiagnostics(): QuartoEmbeddedDiagnostics {
		const virtualNotebooks = stubInterface<IQuartoVirtualNotebookService>({
			getNotebookUri: uri =>
				notebookExists && uri.toString() === SOURCE_URI.toString() ? NOTEBOOK_URI : undefined,
			getCells: uri => uri.toString() === SOURCE_URI.toString() ? cells : [],
			getSourceUriForCell: uri =>
				cells.some(c => c.cellUri.toString() === uri.toString()) ? SOURCE_URI : undefined,
		});
		const logService = stubInterface<ILogService>({
			getLevel: () => LogLevel.Trace,
			trace: (message: string) => { traces.push(message); },
		});
		const modelService = stubInterface<IModelService>({
			getModel: uri => uri.toString() === SOURCE_URI.toString() ? sourceTextModel : null,
		});
		const documentModelService = stubInterface<IQuartoDocumentModelService>({
			getModel: () => stubInterface<IQuartoDocumentModel>({ onDidParse: onDidParse.event }),
		});
		return new QuartoEmbeddedDiagnostics(
			markerService, virtualNotebooks, modelService, documentModelService, logService);
	}

	/** What the Problems pane would show for the source document. */
	function sourceMarkers(): IMarker[] {
		return markerService
			.read({ resource: SOURCE_URI, owner: QUARTO_EMBEDDED_DIAGNOSTICS_OWNER })
			.slice()
			.sort((a, b) => a.startLineNumber - b.startLineNumber);
	}

	it('remaps a cell marker onto the source document', async () => {
		const diagnostics = createDiagnostics();
		markerService.changeOne('ark', R_CELL_URI, [marker()]);
		await settle();
		diagnostics.dispose();

		expect(sourceMarkers().map(summarize)).toEqual([{
			resource: SOURCE_URI.path,
			message: 'object not found',
			owner: QUARTO_EMBEDDED_DIAGNOSTICS_OWNER,
			severity: MarkerSeverity.Error,
			source: 'ark',
			code: 'E1',
			// Cell line 2 of a chunk whose code starts on source line 4.
			range: [5, 3, 5, 8],
		}]);
	});

	it('aggregates markers from every cell of the document, across owners', async () => {
		const diagnostics = createDiagnostics();
		markerService.changeOne('ark', R_CELL_URI, [marker({ message: 'r problem', startLineNumber: 1, endLineNumber: 1 })]);
		markerService.changeOne('ruff', PYTHON_CELL_URI, [marker({ message: 'python problem', startLineNumber: 3, endLineNumber: 3 })]);
		await settle();
		diagnostics.dispose();

		// Nothing here names an owner: whatever publishes on a cell is remapped,
		// so a linter nobody planned for works the same as the language server.
		expect(sourceMarkers().map(m => [m.message, m.startLineNumber])).toEqual([
			['r problem', 4],
			['python problem', 11],
		]);
	});

	it('republishes the whole set, so cleared cell markers disappear from the source', async () => {
		const diagnostics = createDiagnostics();
		markerService.changeOne('ark', R_CELL_URI, [
			marker({ message: 'first', startLineNumber: 1, endLineNumber: 1 }),
			marker({ message: 'second', startLineNumber: 2, endLineNumber: 2 }),
		]);
		await settle();
		const both = sourceMarkers().map(m => m.message);

		markerService.changeOne('ark', R_CELL_URI, [marker({ message: 'first', startLineNumber: 1, endLineNumber: 1 })]);
		await settle();
		const remaining = sourceMarkers().map(m => m.message);

		markerService.changeOne('ark', R_CELL_URI, []);
		await settle();
		const none = sourceMarkers().map(m => m.message);
		diagnostics.dispose();

		expect({ both, remaining, none }).toEqual({
			both: ['first', 'second'],
			remaining: ['first'],
			none: [],
		});
	});

	it('still reads cell markers when the cell URI is excluded from the Problems pane', async () => {
		const diagnostics = createDiagnostics();
		// This is what the virtual notebook does for every cell it creates, and
		// the remapper has to see straight through it.
		markerService.installResourceExclusion(R_CELL_URI);
		markerService.changeOne('ark', R_CELL_URI, [marker()]);
		await settle();
		diagnostics.dispose();

		expect({
			cell: markerService.read({ resource: R_CELL_URI }).length,
			source: sourceMarkers().map(m => m.startLineNumber),
		}).toEqual({
			cell: 0,
			source: [5],
		});
	});

	it('ignores markers on URIs that are not our cells, and does not remap its own output', async () => {
		const diagnostics = createDiagnostics();
		markerService.changeOne('eslint', OTHER_URI, [marker({ message: 'unrelated' })]);
		// A marker under our own owner on the source document is what a loop would
		// feed back in. Remapping it would clear it, since the cells hold nothing.
		markerService.changeOne(QUARTO_EMBEDDED_DIAGNOSTICS_OWNER, SOURCE_URI, [marker({ message: 'ours' })]);
		await settle();
		diagnostics.dispose();

		expect({
			republishes: traces.length,
			source: sourceMarkers().map(m => m.message),
		}).toEqual({
			republishes: 0,
			source: ['ours'],
		});
	});

	it('skips a marker that does not fit its cell, and says so', async () => {
		const diagnostics = createDiagnostics();
		// The R chunk holds three lines. A marker past them was computed against a
		// version of the cell that is already gone, and mapping it would put a
		// squiggle in the prose below the chunk.
		markerService.changeOne('ark', R_CELL_URI, [
			marker({ message: 'stale', startLineNumber: 99, endLineNumber: 99 }),
			marker({ message: 'current', startLineNumber: 3, endLineNumber: 3 }),
		]);
		await settle();
		diagnostics.dispose();

		expect({
			source: sourceMarkers().map(m => [m.message, m.startLineNumber]),
			trace: traces,
		}).toEqual({
			source: [['current', 6]],
			trace: ['[QuartoEmbedded] diagnostics remapped 1 marker(s) from 1 cell(s) for doc.qmd, skipped 1 outside their cell'],
		});
	});

	it('remaps relatedInformation that points at another cell, and leaves the rest alone', async () => {
		const diagnostics = createDiagnostics();
		const relatedInformation: IRelatedInformation[] = [
			{
				resource: PYTHON_CELL_URI,
				message: 'defined here',
				startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6,
			},
			{
				resource: OTHER_URI,
				message: 'and here',
				startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 4,
			},
		];
		markerService.changeOne('ark', R_CELL_URI, [marker({ relatedInformation })]);
		await settle();
		diagnostics.dispose();

		expect(sourceMarkers()[0].relatedInformation?.map(summarize)).toEqual([
			// Cell line 1 of the Python chunk, whose code starts on source line 9.
			{ resource: SOURCE_URI.path, message: 'defined here', range: [9, 1, 9, 6] },
			// A real file keeps its own coordinates.
			{ resource: OTHER_URI.path, message: 'and here', range: [3, 1, 3, 4] },
		]);
	});

	it('leaves the source document alone when the changed URI belongs to no notebook', async () => {
		const diagnostics = createDiagnostics();
		markerService.changeOne('ark', R_CELL_URI, [marker()]);
		await settle();

		// The document closed, so the notebook and its cells are gone from the
		// service. Whatever is on the source document is the closing notebook's to
		// clear, and a republish here would work from cells that no longer exist.
		cells = [];
		notebookExists = false;
		markerService.changeOne('ark', R_CELL_URI, []);
		await settle();
		diagnostics.dispose();

		expect({
			republishes: traces.length,
			source: sourceMarkers().map(m => m.startLineNumber),
		}).toEqual({
			republishes: 1,
			source: [5],
		});
	});

	it('notifies marker listeners about the source document, not only the cell', async () => {
		const diagnostics = createDiagnostics();
		const changed: string[] = [];
		const listener = markerService.onMarkerChanged(
			resources => changed.push(...resources.map(resource => resource.path)));

		markerService.changeOne('ark', R_CELL_URI, [marker()]);
		await settle();
		listener.dispose();
		diagnostics.dispose();

		// A republish made from inside the marker-changed delivery is swallowed by
		// MicrotaskEmitter, which clears its queue after delivering. The Problems
		// pane and the editor decorations both read on this event, so losing it
		// means the squiggle never appears.
		expect(changed).toEqual([R_CELL_URI.path, SOURCE_URI.path]);
	});

	it('clears the remapped set when the document loses its last chunk', async () => {
		const diagnostics = createDiagnostics();
		markerService.changeOne('ark', R_CELL_URI, [marker()]);
		await settle();
		const before = sourceMarkers().length;

		// Every chunk deleted, but the document is still open, so the notebook is
		// still there with no cells in it. Nothing else clears the remapped set in
		// this case: the notebook clears it on dispose, and it is not disposed.
		cells = [];
		onDidParse.fire();
		await settle();
		diagnostics.dispose();

		expect({ before, after: sourceMarkers().length }).toEqual({ before: 1, after: 0 });
	});

	it('skips relatedInformation that does not fit its cell', async () => {
		const diagnostics = createDiagnostics();
		// The Python chunk holds three lines. The same staleness that the primary
		// range is checked for reaches a related location too, and mapping it
		// would point the peek at the prose below that chunk.
		const relatedInformation: IRelatedInformation[] = [
			{
				resource: PYTHON_CELL_URI,
				message: 'stale',
				startLineNumber: 99, startColumn: 1, endLineNumber: 99, endColumn: 6,
			},
			{
				resource: PYTHON_CELL_URI,
				message: 'current',
				startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6,
			},
		];
		markerService.changeOne('ark', R_CELL_URI, [marker({ relatedInformation })]);
		await settle();
		diagnostics.dispose();

		expect(sourceMarkers()[0].relatedInformation?.map(summarize)).toEqual([
			{ resource: SOURCE_URI.path, message: 'current', range: [9, 1, 9, 6] },
		]);
	});

	it('re-offsets the remapped markers when the chunks move', async () => {
		const diagnostics = createDiagnostics();
		markerService.changeOne('ark', R_CELL_URI, [marker()]);
		await settle();
		const before = sourceMarkers().map(m => m.startLineNumber);

		// Two prose lines added above the R chunk, so its code starts two lines
		// further down. The server has nothing new to say, and a server that never
		// republishes would leave the squiggle where the chunk used to be.
		cells = [
			cell(R_CELL_URI, 'r', 6, 8),
			cell(PYTHON_CELL_URI, 'python', 11, 13),
		];
		onDidParse.fire();
		await settle();
		const after = sourceMarkers().map(m => m.startLineNumber);
		diagnostics.dispose();

		expect({
			before,
			after,
			// One republish for the marker and one for the parse. More than that
			// means the document was subscribed to more than once.
			republishes: traces.length,
		}).toEqual({
			before: [5],
			after: [7],
			republishes: 2,
		});
	});

	it('stops re-offsetting when the source document closes', async () => {
		const diagnostics = createDiagnostics();
		markerService.changeOne('ark', R_CELL_URI, [marker()]);
		await settle();

		sourceTextModel.dispose();
		onDidParse.fire();
		await settle();
		diagnostics.dispose();

		expect(traces.length).toBe(1);
	});

	it('stops remapping once disposed', async () => {
		const diagnostics = createDiagnostics();
		diagnostics.dispose();

		markerService.changeOne('ark', R_CELL_URI, [marker()]);
		await settle();

		expect({ republishes: traces.length, source: sourceMarkers().length })
			.toEqual({ republishes: 0, source: 0 });
	});
});
