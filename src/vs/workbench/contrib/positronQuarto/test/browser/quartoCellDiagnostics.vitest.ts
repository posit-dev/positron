/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { timeout } from '../../../../../base/common/async.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IMarker, IMarkerData, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { MarkerService } from '../../../../../platform/markers/common/markerService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { QuartoCellDiagnostics } from '../../browser/quartoCellDiagnostics.js';
import { createQuartoCellUri } from '../../browser/quartoCellModelSync.js';
import { IQuartoCellModelService } from '../../browser/quartoCellModelService.js';
import { QUARTO_CELL_DIAGNOSTICS_OWNER } from '../../common/positronQuartoConfig.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../../common/quartoTypes.js';

const DOC_URI = URI.parse('file:///doc.qmd');
const CELL_URI = createQuartoCellUri(DOC_URI, 0);
const SERVER_OWNER = 'python';

/** A chunk whose code starts at `codeStartLine`, so cell line 3 maps to document line `codeStartLine + 2`. */
function cellAt(codeStartLine: number): QuartoCodeCell {
	return {
		id: 'c0', language: 'python', startLine: codeStartLine - 1, endLine: codeStartLine + 4,
		codeStartLine, codeEndLine: codeStartLine + 3, options: '', contentHash: '0', index: 0,
	};
}

const cellMarker: IMarkerData = {
	severity: MarkerSeverity.Error, message: 'boom',
	startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 4,
};

/** The projected markers on the document, normalized to the fields we assert. */
function projected(markerService: MarkerService): Pick<IMarker, 'message' | 'severity' | 'startLineNumber' | 'endLineNumber'>[] {
	return markerService.read({ owner: QUARTO_CELL_DIAGNOSTICS_OWNER, resource: DOC_URI })
		.map(({ message, severity, startLineNumber, endLineNumber }) => ({ message, severity, startLineNumber, endLineNumber }));
}

function setup() {
	const markerService = new MarkerService();
	const onDidParse = new Emitter<void>();
	let cell = cellAt(5);
	const documentModel = stubInterface<IQuartoDocumentModel>({
		uri: DOC_URI,
		get cells() { return [cell]; },
		onDidParse: onDidParse.event,
	});
	const cellModel = stubInterface<ITextModel>({ uri: CELL_URI });
	const cellModelService = stubInterface<IQuartoCellModelService>({ getCellModel: () => cellModel });

	const diagnostics = new QuartoCellDiagnostics(documentModel, cellModelService, markerService);
	return {
		markerService, diagnostics, onDidParse,
		shiftCellTo: (codeStartLine: number) => { cell = cellAt(codeStartLine); },
	};
}

// Re-projection is deferred (RunOnceScheduler with a 0ms delay) so it never
// writes markers inside the onMarkerChanged dispatch. Flushing drains both the
// onMarkerChanged microtask and the scheduler's timer.
const flush = () => timeout(5);

describe('QuartoCellDiagnostics', () => {
	it('re-projects a cell marker onto the document with a translated range', async () => {
		const { markerService } = setup();

		markerService.changeOne(SERVER_OWNER, CELL_URI, [cellMarker]);
		await flush();

		// Cell line 3 -> document line 7 (codeStartLine 5).
		expect(projected(markerService)).toEqual([
			{ message: 'boom', severity: MarkerSeverity.Error, startLineNumber: 7, endLineNumber: 7 },
		]);
	});

	it('re-projects on reparse when a chunk shifts without its markers changing', async () => {
		const { markerService, onDidParse, shiftCellTo } = setup();
		markerService.changeOne(SERVER_OWNER, CELL_URI, [cellMarker]);
		await flush();

		// Prose inserted above the chunk shifts it down two lines; the cell model's
		// own markers are unchanged (so no onMarkerChanged), but a reparse fires.
		shiftCellTo(7);
		onDidParse.fire();
		await flush();

		// Cell line 3 -> document line 9 (codeStartLine 7).
		expect(projected(markerService)).toEqual([
			{ message: 'boom', severity: MarkerSeverity.Error, startLineNumber: 9, endLineNumber: 9 },
		]);
	});

	it('clears the document markers on dispose', async () => {
		const { markerService, diagnostics } = setup();
		markerService.changeOne(SERVER_OWNER, CELL_URI, [cellMarker]);
		await flush();
		expect(projected(markerService)).toHaveLength(1);

		diagnostics.dispose();
		expect(projected(markerService)).toHaveLength(0);
	});
});
