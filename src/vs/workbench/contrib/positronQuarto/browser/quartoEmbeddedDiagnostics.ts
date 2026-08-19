/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ResourceSet } from '../../../../base/common/map.js';
import { Schemas } from '../../../../base/common/network.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILogService, LogLevel } from '../../../../platform/log/common/log.js';
import {
	IMarker,
	IMarkerData,
	IMarkerService,
	IRelatedInformation,
} from '../../../../platform/markers/common/markers.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { CellUri } from '../../notebook/common/notebookCommon.js';
import { cellRangeToSource, ICellLineSpan } from '../common/quartoCellPositionMapping.js';
import {
	QUARTO_CELLS_SCHEME,
	QUARTO_EMBEDDED_DIAGNOSTICS_OWNER,
} from '../common/quartoVirtualNotebookTypes.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IQuartoVirtualNotebookService } from './quartoVirtualNotebookService.js';

/**
 * One cell, reduced to what remapping needs.
 *
 * The span is copied rather than read off the cell as needed. Syncing a document
 * rebuilds its cells, and a republish has to finish in the coordinates it
 * started with.
 */
interface ICellSnapshot {
	readonly cellUri: URI;
	readonly span: ICellLineSpan;
}

/** How many lines of code a cell holds. A chunk with no code holds none. */
function cellLineCount(span: ICellLineSpan): number {
	return span.codeEndLine - span.codeStartLine + 1;
}

/**
 * Whether a range published against a cell still fits inside it.
 *
 * A server computes a range against the version of a cell it last saw, and an
 * edit can arrive before its diagnostics do. Mapping a range from a longer
 * version of the cell would put a squiggle in the prose below the chunk, so it
 * is dropped instead, and the server's next publish replaces it.
 */
function fitsCell(span: ICellLineSpan, range: { startLineNumber: number; endLineNumber: number }): boolean {
	return range.startLineNumber >= 1 && range.endLineNumber <= cellLineCount(span);
}

/**
 * Whether a URI is a cell of one of our hidden notebooks, whoever holds it now.
 *
 * The notebook's own scheme is encoded in a cell's fragment, so this still
 * recognizes a cell that the service has already spliced out. That is the case
 * it exists for: the service can no longer answer for such a cell, and a cell of
 * a real notebook must not be mistaken for one.
 */
function isQuartoCellUri(resource: URI): boolean {
	return resource.scheme === Schemas.vscodeNotebookCell
		&& CellUri.parse(resource)?.notebook.scheme === QUARTO_CELLS_SCHEME;
}

/**
 * Republishes the diagnostics of a Quarto document's hidden notebook cells onto
 * the document itself.
 *
 * A language server is given the cells, so it publishes against cell URIs, in
 * cell coordinates. Nobody can open those URIs, so the squiggles and the Problems
 * entries have to be moved onto the `.qmd` before the user sees any of it. The
 * cell URIs themselves are kept out of the Problems pane by the virtual notebook,
 * which excludes each cell resource for as long as the cell exists.
 */
export class QuartoEmbeddedDiagnostics extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronQuartoEmbeddedDiagnostics';

	/** Source documents waiting to be republished, and whether that is scheduled. */
	private readonly _pendingSources = new ResourceSet();
	/** Cells that outlived their notebook and need their markers taken off. */
	private readonly _pendingOrphans = new ResourceSet();
	private _flushScheduled = false;

	/** Parse subscriptions, one per source document, keyed by its URI. */
	private readonly _reoffsetting = this._register(new DisposableMap<string>());

	constructor(
		@IMarkerService private readonly _markerService: IMarkerService,
		@IQuartoVirtualNotebookService private readonly _virtualNotebooks: IQuartoVirtualNotebookService,
		@IModelService private readonly _modelService: IModelService,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(this._markerService.onMarkerChanged(resources => {
			for (const resource of resources) {
				const sourceUri = this._virtualNotebooks.getSourceUriForCell(resource);
				if (sourceUri) {
					this._scheduleRepublish(sourceUri);
				} else if (isQuartoCellUri(resource)) {
					this._pendingOrphans.add(resource);
					this._scheduleFlush();
				}
			}
		}));
	}

	/**
	 * Republish a source document once the current round of marker changes is
	 * over.
	 *
	 * Deferred rather than done in the listener, for two reasons. Marker changes
	 * are delivered from a `MicrotaskEmitter`, which clears its queue after
	 * delivering, so an event fired during delivery is pushed onto that queue and
	 * then thrown away: the republish would happen, but nothing reading the
	 * Problems pane or drawing the squiggles would ever hear about it. Deferring
	 * also means the cells have finished syncing, whatever order the listeners of
	 * the parse ran in, so the spans a republish reads are the current ones.
	 */
	private _scheduleRepublish(sourceUri: URI): void {
		this._pendingSources.add(sourceUri);
		this._scheduleFlush();
	}

	private _scheduleFlush(): void {
		if (this._flushScheduled) {
			return;
		}

		this._flushScheduled = true;
		queueMicrotask(() => {
			this._flushScheduled = false;
			if (this._store.isDisposed) {
				return;
			}
			const orphans = [...this._pendingOrphans];
			this._pendingOrphans.clear();
			for (const cellUri of orphans) {
				this._clearOrphanedCell(cellUri);
			}
			const sources = [...this._pendingSources];
			this._pendingSources.clear();
			for (const sourceUri of sources) {
				this._republish(sourceUri);
			}
		});
	}

	/**
	 * Take the markers off a cell that no longer exists, whoever published them.
	 *
	 * The notebook clears a cell's markers once, as it retires it, and releases
	 * the exclusion that kept them out of the Problems pane at the same time. A
	 * publish that was already on its way from the extension host lands after
	 * both, on a URI nobody can open. Ark publishes an empty set when it sees the
	 * close and so heals this on its own, but a server that does not would leave
	 * the entry there for the rest of the session.
	 */
	private _clearOrphanedCell(cellUri: URI): void {
		const owners = new Set<string>();
		for (const marker of this._markerService.read({ resource: cellUri, ignoreResourceFilters: true })) {
			owners.add(marker.owner);
		}
		for (const owner of owners) {
			this._markerService.changeOne(owner, cellUri, []);
		}
	}

	/**
	 * Rebuild the whole remapped set for one source document.
	 *
	 * The whole set rather than the markers of the cell that changed: a cell whose
	 * diagnostics were cleared contributes nothing, and publishing the result is
	 * what makes that clearing reach the document. Patching per cell would need a
	 * record of which source markers came from which cell, and would leave the
	 * ones whose cell has since gone behind.
	 */
	private _republish(sourceUri: URI): void {
		const cells: ICellSnapshot[] = this._virtualNotebooks.getCells(sourceUri).map(cell => ({
			cellUri: cell.cellUri,
			span: { codeStartLine: cell.codeStartLine, codeEndLine: cell.codeEndLine },
		}));
		if (cells.length === 0 && !this._virtualNotebooks.getNotebookUri(sourceUri)) {
			// No notebook, so the document has closed or the setting has gone off.
			// Disposing the notebook cleared the remapped set already.
			//
			// A document that is still open and has lost its last chunk reaches
			// here too, with no cells and a notebook. That one must fall through:
			// the markers of the chunk that went are still on the document, and
			// nothing but a republish of the empty set takes them off.
			return;
		}

		this._ensureReoffsetting(sourceUri);

		const remapped: IMarkerData[] = [];
		let cellsWithMarkers = 0;
		let skipped = 0;

		for (const { cellUri, span } of cells) {
			// `ignoreResourceFilters`, because the virtual notebook excludes every
			// cell resource from the Problems pane, and these are the markers it is
			// excluding them for.
			const markers = this._markerService.read({ resource: cellUri, ignoreResourceFilters: true });
			const before = remapped.length;
			for (const marker of markers) {
				if (fitsCell(span, marker)) {
					remapped.push(this._toSourceMarker(span, marker));
				} else {
					skipped++;
				}
			}
			if (remapped.length > before) {
				cellsWithMarkers++;
			}
		}

		this._markerService.changeOne(QUARTO_EMBEDDED_DIAGNOSTICS_OWNER, sourceUri, remapped);

		// The remapped markers are indistinguishable from the ones the Quarto
		// extension publishes for the same problem, so until that path is turned
		// off this line is the only way to tell which one the user is looking at.
		//
		// `=== LogLevel.Trace` rather than `<=`, because LogLevel.Off is 0 and
		// Trace is 1, so `<=` is also true when logging is turned off.
		if (this._logService.getLevel() === LogLevel.Trace) {
			this._logService.trace(
				`[QuartoEmbedded] diagnostics remapped ${remapped.length} marker(s) from ` +
				`${cellsWithMarkers} cell(s) for ${basename(sourceUri)}` +
				(skipped > 0 ? `, skipped ${skipped} outside their cell` : ''));
		}
	}

	/**
	 * Start republishing a source document whenever it is parsed again, so that
	 * markers follow their chunk when it moves.
	 *
	 * Prose growing above a chunk shifts its code down without changing it. The
	 * server has nothing new to say, so it may not publish again, and the
	 * coordinates the markers were mapped to are now the wrong lines.
	 *
	 * Subscribed here, on the first republish, rather than when the document
	 * opens. A document nothing has published against has nothing to re-offset,
	 * and a first republish is proof that the notebook exists, which saves this
	 * from having to work out when it was created.
	 */
	private _ensureReoffsetting(sourceUri: URI): void {
		const key = sourceUri.toString();
		if (this._reoffsetting.has(key)) {
			return;
		}

		const textModel = this._modelService.getModel(sourceUri);
		if (!textModel) {
			return;
		}

		const store = new DisposableStore();
		store.add(this._documentModelService.getModel(textModel)
			.onDidParse(() => this._scheduleRepublish(sourceUri)));
		store.add(textModel.onWillDispose(() => this._reoffsetting.deleteAndDispose(key)));
		this._reoffsetting.set(key, store);
	}

	/**
	 * A cell's marker as a marker on the source document.
	 *
	 * Only the coordinates change. Everything the server said about the problem
	 * itself is carried across untouched, so a remapped entry reads exactly as it
	 * would have on a plain script. `resource` and `owner` are dropped because
	 * they belong to the marker service, which sets them from the arguments to
	 * `changeOne`, and `modelVersionId` because it refers to a version of the cell
	 * model rather than of the document.
	 *
	 * `origin` is dropped for a different reason: it is not something the server
	 * said. `MainThreadDiagnostics` stamps it with the id of the extension host
	 * that published, and uses it to skip its own markers when it tells the
	 * extension host what changed. Copying it would hide these markers from
	 * `vscode.languages.getDiagnostics`, and would start showing them again as
	 * soon as a restart changed the id.
	 */
	private _toSourceMarker(span: ICellLineSpan, marker: IMarker): IMarkerData {
		return {
			...cellRangeToSource(span, marker),
			severity: marker.severity,
			message: marker.message,
			source: marker.source,
			code: marker.code,
			tags: marker.tags,
			relatedInformation: this._toSourceRelatedInformation(marker.relatedInformation),
		};
	}

	/**
	 * Move the related information that points into a cell onto the document
	 * holding that cell, and leave everything else as it is.
	 *
	 * Any of our cells, not only the ones of the document being republished: a
	 * name defined in one Quarto document and used in another is the same kind of
	 * reference, and the lookup costs nothing extra.
	 */
	private _toSourceRelatedInformation(
		relatedInformation: IRelatedInformation[] | undefined
	): IRelatedInformation[] | undefined {
		return relatedInformation?.flatMap(related => {
			const sourceUri = this._virtualNotebooks.getSourceUriForCell(related.resource);
			if (!sourceUri) {
				return [related];
			}
			const cell = this._virtualNotebooks.getCells(sourceUri)
				.find(candidate => candidate.cellUri.toString() === related.resource.toString());
			if (!cell) {
				return [related];
			}
			if (!fitsCell(cell, related)) {
				// Stale for the same reason a primary range is, and dropped for the
				// same reason: mapping it would point the peek at the prose below
				// the chunk. One related location is worth less than the marker
				// itself, so the marker is kept and this entry goes.
				return [];
			}
			return [{
				resource: sourceUri,
				message: related.message,
				...cellRangeToSource(cell, related),
			}];
		});
	}
}
