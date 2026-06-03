/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceSet } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { IMarkerData, IMarkerService, IRelatedInformation } from '../../../../platform/markers/common/markers.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../common/quartoTypes.js';
import { QUARTO_CELL_DIAGNOSTICS_OWNER } from '../common/positronQuartoConfig.js';
import { toDocumentRange } from '../common/quartoPositionMapping.js';
import { IQuartoCellModelService } from './quartoCellModelService.js';
import { createQuartoCellUri } from './quartoCellModelSync.js';

/**
 * Re-projects the diagnostics that the per-language servers (Python, R) publish
 * against a Quarto document's synthetic per-cell models onto the host `.qmd`
 * document, translating their ranges from cell coordinates into document
 * coordinates.
 *
 * One instance exists per open `.qmd`, mirroring {@link QuartoCellModelSync}'s
 * lifecycle. The cell models themselves are never shown in an editor, so their
 * markers are invisible until re-projected here; the projected markers are
 * written under the shared {@link QUARTO_CELL_DIAGNOSTICS_OWNER} owner, keyed by
 * the document resource.
 *
 * Re-projection runs on two signals because the marker store holds static
 * position snapshots:
 * - {@link IMarkerService.onMarkerChanged} when a cell's markers change (the
 *   server re-analyzed an edited chunk), and
 * - {@link IQuartoDocumentModel.onDidParse} when a reparse may have shifted a
 *   chunk's line offset within the document even though its own text (and thus
 *   the server's cell-space markers) did not change.
 */
export class QuartoCellDiagnostics extends Disposable {

	private readonly _documentUri: URI;

	// The actual re-projection is deferred via a scheduler rather than run
	// inline. Writing markers directly inside the `onMarkerChanged` handler
	// would re-enter {@link IMarkerService}'s microtask emitter mid-dispatch:
	// the re-fired change for the document resource is coalesced into the
	// in-flight batch and dropped before other listeners (notably the editor's
	// marker-decorations renderer) observe it, so the squiggle would not appear
	// until the next, unrelated marker change. Deferring lets our write fire
	// its own clean event, and coalesces bursts of cell-marker changes into a
	// single re-projection.
	private readonly _reprojectScheduler = this._register(new RunOnceScheduler(() => this._reproject(), 0));

	constructor(
		private readonly _documentModel: IQuartoDocumentModel,
		private readonly _cellModelService: IQuartoCellModelService,
		private readonly _markerService: IMarkerService,
	) {
		super();

		this._documentUri = this._documentModel.uri;

		this._reprojectScheduler.schedule();

		// A cell's markers changed (server re-published after a chunk edit).
		this._register(this._markerService.onMarkerChanged(resources => {
			if (this._touchesOwnCell(resources)) {
				this._reprojectScheduler.schedule();
			}
		}));

		// A reparse may have shifted chunk line offsets without changing chunk
		// text, so the cell-space markers are unchanged but their document-space
		// projection is stale.
		this._register(this._documentModel.onDidParse(() => this._reprojectScheduler.schedule()));

		// Clear our projected markers when the document closes.
		this._register(toDisposable(() => {
			this._markerService.changeOne(QUARTO_CELL_DIAGNOSTICS_OWNER, this._documentUri, []);
		}));
	}

	/** Whether any of the changed resources is a cell of this document. */
	private _touchesOwnCell(resources: readonly URI[]): boolean {
		const ownCellUris = new ResourceSet(
			this._documentModel.cells.map(cell => createQuartoCellUri(this._documentUri, cell.index)),
		);
		return resources.some(resource => ownCellUris.has(resource));
	}

	private _reproject(): void {
		const cells = this._documentModel.cells;

		// Lookup from a cell model URI to its cell, used to translate marker and
		// related-information ranges that point back into a chunk of this document.
		const cellByUri = new Map<string, QuartoCodeCell>();
		for (const cell of cells) {
			cellByUri.set(createQuartoCellUri(this._documentUri, cell.index).toString(), cell);
		}

		const markers: IMarkerData[] = [];
		for (const cell of cells) {
			const cellModel = this._cellModelService.getCellModel(this._documentUri, cell);
			if (!cellModel) {
				continue;
			}
			for (const marker of this._markerService.read({ resource: cellModel.uri })) {
				const range = toDocumentRange(cell, marker);
				markers.push({
					severity: marker.severity,
					message: marker.message,
					source: marker.source,
					code: marker.code,
					tags: marker.tags,
					relatedInformation: this._translateRelatedInformation(marker.relatedInformation, cellByUri),
					startLineNumber: range.startLineNumber,
					startColumn: range.startColumn,
					endLineNumber: range.endLineNumber,
					endColumn: range.endColumn,
				});
			}
		}

		this._markerService.changeOne(QUARTO_CELL_DIAGNOSTICS_OWNER, this._documentUri, markers);
	}

	/**
	 * Translate related-information entries that point into a chunk of this
	 * document onto the document URI (with translated range). Entries pointing
	 * elsewhere (other files) are left untouched.
	 */
	private _translateRelatedInformation(
		related: IRelatedInformation[] | undefined,
		cellByUri: Map<string, QuartoCodeCell>,
	): IRelatedInformation[] | undefined {
		if (!related) {
			return undefined;
		}
		return related.map(info => {
			const cell = cellByUri.get(info.resource.toString());
			if (!cell) {
				return info;
			}
			const range = toDocumentRange(cell, info);
			return {
				resource: this._documentUri,
				message: info.message,
				startLineNumber: range.startLineNumber,
				startColumn: range.startColumn,
				endLineNumber: range.endLineNumber,
				endColumn: range.endColumn,
			};
		});
	}
}
