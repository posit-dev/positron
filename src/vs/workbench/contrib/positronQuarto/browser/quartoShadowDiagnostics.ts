/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { Constants } from '../../../../base/common/uint.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMarker, IMarkerData, IMarkerService, IRelatedInformation } from '../../../../platform/markers/common/markers.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { QUARTO_SHADOW_DIAGNOSTICS_OWNER_PREFIX } from '../common/positronQuartoConfig.js';
import { toDocumentRange } from '../common/quartoPositionMapping.js';
import { fenceLanguageToCellLanguage } from '../common/quartoShadowNotebook.js';
import { findShadowCellUriLeak } from '../common/quartoShadowUriLeakGuard.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../common/quartoTypes.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { QuartoShadowLanguageBridge } from './quartoShadowLanguageBridge.js';
import { IQuartoShadowNotebookService } from './quartoShadowNotebookService.js';

/**
 * Re-projects language server diagnostics from a shadow notebook's cells onto
 * the `.qmd` document, and keeps the raw cell markers out of the Problems
 * pane.
 *
 * Language servers publish per-cell diagnostics against the shadow cells'
 * `vscode-notebook-cell:` URIs. Those markers reach `IMarkerService` (the
 * extension host mirrors every `DiagnosticCollection` to it), but the cell
 * resources are hidden implementation detail the user can't open. One
 * instance of this class per shadow notebook:
 *
 * - copies each cell's markers to the `.qmd` resource with ranges translated
 *   to document coordinates, under an owner derived from the source owner
 *   ({@link QUARTO_SHADOW_DIAGNOSTICS_OWNER_PREFIX}), so multiple servers
 *   never clobber each other and diagnostics from other sources (e.g. the
 *   Quarto extension's own prose diagnostics) pass through untouched;
 * - installs marker read exclusions (`IMarkerService.installResourceExclusion`)
 *   for the cell resources so the raw cell markers never show in the Problems
 *   pane or problem counts. Exclusions only affect presentation reads: the
 *   extension host bridge reads with `ignoreResourceFilters`, so the
 *   extension-side `DiagnosticCollection`s that code action providers read
 *   are untouched.
 *
 * Re-projection runs on three signals: a marker change touching a cell
 * resource (server re-published), a reparse of the Quarto document (cell line
 * offsets may have shifted while the cell-space markers stayed the same), and
 * a notebook content change (cells spliced in or out). The reaction is always
 * DEFERRED via a scheduler: `changeOne` inside an `onMarkerChanged` handler
 * re-enters the marker service's microtask emitter mid-dispatch and the
 * change is coalesced into the in-flight batch, so other listeners (e.g. the
 * editor's marker decorations) never observe it. Deferring also collapses
 * marker event storms into a single re-projection.
 */
export class QuartoShadowNotebookDiagnostics extends Disposable {

	/** The `.qmd` document's URI (shared by the shadow notebook). */
	private readonly _documentUri: URI;

	/** Deferred re-projection (see class JSDoc for why it must be deferred). */
	private readonly _reprojectScheduler = this._register(new RunOnceScheduler(() => this._reproject(), 0));

	/**
	 * Marker read exclusions, keyed by cell URI string. An exclusion for a
	 * cell that was spliced away is retained until the cell's markers are
	 * gone (the server clears them on didClose), so stale markers never flash
	 * back into the Problems pane.
	 */
	private readonly _exclusions = this._register(new DisposableMap<string>());

	/**
	 * Serialized markers written per projected owner. `onDidParse` fires on
	 * every reparse (i.e. every debounced keystroke), so re-projections that
	 * produce identical markers must not write: a redundant `changeOne` still
	 * fires a marker event and would churn the Problems pane and marker
	 * decorations on every keystroke.
	 */
	private readonly _writtenByOwner = new Map<string, string>();

	constructor(
		private readonly _notebook: NotebookTextModel,
		private readonly _documentModel: IQuartoDocumentModel,
		private readonly _bridge: QuartoShadowLanguageBridge,
		@IMarkerService private readonly _markerService: IMarkerService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._documentUri = this._notebook.uri;

		// Install exclusions synchronously at creation and on every notebook
		// change, so a new cell's markers are hidden before a server can
		// possibly publish against it (the server only learns of the cell
		// through the ext host sync that follows the same change).
		this._updateExclusions();
		this._reprojectScheduler.schedule();

		this._register(this._notebook.onDidChangeContent(() => {
			this._updateExclusions();
			this._reprojectScheduler.schedule();
		}));

		// A reparse may shift cell line offsets (edit in the prose above a
		// cell) without changing the cell-space markers.
		this._register(this._documentModel.onDidParse(() => this._reprojectScheduler.schedule()));

		// A cell's markers changed (server published). Only schedule here;
		// mutating markers inside the handler is the re-entrancy hazard the
		// scheduler exists for.
		this._register(this._markerService.onMarkerChanged(resources => {
			if (resources.some(resource => this._isOwnCellResource(resource))) {
				this._reprojectScheduler.schedule();
			}
		}));
	}

	override dispose(): void {
		// Remove the projected markers. The exclusions are disposed with the
		// store below; any markers still on the cell resources reappear in
		// reads until the servers clear them (didClose follows immediately on
		// the paths that dispose this: document close, setting off, splice).
		for (const owner of this._writtenByOwner.keys()) {
			this._markerService.changeOne(owner, this._documentUri, []);
		}
		this._writtenByOwner.clear();
		super.dispose();
	}

	/** Whether a changed marker resource is (or recently was) one of our cells. */
	private _isOwnCellResource(resource: URI): boolean {
		const key = resource.toString();
		return this._exclusions.has(key) || this._notebook.cells.some(cell => cell.uri.toString() === key);
	}

	/**
	 * Reconcile the exclusion set with the notebook's cells: install
	 * exclusions for new cells, and release exclusions of removed cells once
	 * their markers are gone.
	 */
	private _updateExclusions(): void {
		const liveKeys = new Set<string>();
		for (const cell of this._notebook.cells) {
			const key = cell.uri.toString();
			liveKeys.add(key);
			if (!this._exclusions.has(key)) {
				const exclusion = this._markerService.installResourceExclusion?.(cell.uri);
				if (exclusion) {
					this._exclusions.set(key, exclusion);
				}
			}
		}
		for (const key of [...this._exclusions.keys()]) {
			if (liveKeys.has(key)) {
				continue;
			}
			// Spliced-away cell: keep hiding it while stale markers linger.
			const lingering = this._markerService.read({ resource: URI.parse(key), ignoreResourceFilters: true });
			if (lingering.length === 0) {
				this._exclusions.deleteAndDispose(key);
			}
		}
	}

	/** Copy the cells' markers onto the `.qmd` resource, translated. */
	private _reproject(): void {
		if (this._store.isDisposed) {
			return;
		}
		this._updateExclusions();

		// Collect the translated markers, grouped by projected owner.
		const markersByOwner = new Map<string, IMarkerData[]>();
		for (let i = 0; i < this._notebook.cells.length; i++) {
			const notebookCell = this._notebook.cells[i];
			// Same-instant index correspondence between notebook cells and
			// parse cells, with a language check guarding the brief window
			// where a structural reparse races the sync (mismatched cells are
			// skipped; the onDidParse that follows the sync re-projects them).
			const parseCell = this._documentModel.cells[i];
			if (!parseCell || notebookCell.language !== fenceLanguageToCellLanguage(parseCell.language)) {
				continue;
			}
			for (const marker of this._markerService.read({ resource: notebookCell.uri, ignoreResourceFilters: true })) {
				const projected = this._toProjectedMarker(marker, parseCell);
				if (!projected) {
					continue;
				}
				const owner = `${QUARTO_SHADOW_DIAGNOSTICS_OWNER_PREFIX}/${marker.owner}`;
				let markers = markersByOwner.get(owner);
				if (!markers) {
					markers = [];
					markersByOwner.set(owner, markers);
				}
				markers.push(projected);
			}
		}

		// Write the projection (skipping owners whose markers are unchanged),
		// then clear owners that went quiet (server cleared its diagnostics
		// or the reporting cells disappeared). Writes target only the .qmd
		// resource, which is not a cell resource, so a re-projection can
		// never re-trigger itself.
		for (const [owner, markers] of markersByOwner) {
			const serialized = JSON.stringify(markers);
			if (this._writtenByOwner.get(owner) !== serialized) {
				this._writtenByOwner.set(owner, serialized);
				this._markerService.changeOne(owner, this._documentUri, markers);
			}
		}
		for (const owner of [...this._writtenByOwner.keys()]) {
			if (!markersByOwner.has(owner)) {
				this._writtenByOwner.delete(owner);
				this._markerService.changeOne(owner, this._documentUri, []);
			}
		}
	}

	/**
	 * Translate one cell-space marker into document space.
	 * @returns The translated marker data, or undefined when the marker is
	 * dropped: it starts beyond the cell's current code (a stale publish from
	 * a server that hasn't reparsed yet - the re-publish that follows will
	 * re-project it), or its translation still contains a shadow cell URI
	 * (fail closed, never surface a raw cell URI).
	 */
	private _toProjectedMarker(marker: IMarker, cell: QuartoCodeCell): IMarkerData | undefined {
		const codeLineCount = cell.codeEndLine - cell.codeStartLine + 1;
		if (codeLineCount <= 0 || marker.startLineNumber > codeLineCount) {
			return undefined;
		}

		// Clamp the end of partially stale markers so the projection never
		// bleeds past the cell's code into the fence or prose below.
		const clampEnd = marker.endLineNumber > codeLineCount;
		const range = toDocumentRange(cell, {
			startLineNumber: marker.startLineNumber,
			startColumn: marker.startColumn,
			endLineNumber: clampEnd ? codeLineCount : marker.endLineNumber,
			// The editor clamps decoration columns to the line's length.
			endColumn: clampEnd ? Constants.MAX_SAFE_SMALL_INTEGER : marker.endColumn,
		});

		const projected: IMarkerData = {
			severity: marker.severity,
			message: marker.message,
			source: marker.source,
			code: marker.code,
			tags: marker.tags,
			relatedInformation: this._projectRelatedInformation(marker.relatedInformation),
			startLineNumber: range.startLineNumber,
			startColumn: range.startColumn,
			endLineNumber: range.endLineNumber,
			endColumn: range.endColumn,
			// origin (the ext host id) is deliberately not carried over: the
			// projected marker is a new, workbench-owned marker, and leaving
			// origin unset lets MainThreadDiagnostics forward it to the ext
			// host mirror so `vscode.languages.getDiagnostics(qmdUri)` sees it.
			// modelVersionId is dropped too: it refers to the cell's model.
		};

		// Backstop, mirroring the bridge providers: never surface a marker
		// that still references a shadow cell (e.g. a relatedInformation or
		// code.target URI the translation above didn't cover).
		const leak = findShadowCellUriLeak(projected);
		if (leak) {
			this._logService.error(`[QuartoShadowDiagnostics] Dropping projected marker for ${this._documentUri.toString()}: shadow cell URI leaked through translation: ${URI.isUri(leak) ? leak.toString() : JSON.stringify(leak)}`);
			return undefined;
		}
		return projected;
	}

	/**
	 * Translate related-information entries that point into shadow cells (of
	 * this or any other open Quarto document) onto the owning `.qmd`.
	 * Entries pointing at real files pass through; entries at unmappable
	 * shadow cells are dropped (never surfaced raw).
	 */
	private _projectRelatedInformation(related: IRelatedInformation[] | undefined): IRelatedInformation[] | undefined {
		if (!related) {
			return undefined;
		}
		const result: IRelatedInformation[] = [];
		for (const info of related) {
			const mapped = this._bridge.mapLocationToDocument(info.resource, info);
			if (!mapped) {
				continue;
			}
			result.push({
				resource: mapped.uri,
				message: info.message,
				startLineNumber: mapped.range.startLineNumber,
				startColumn: mapped.range.startColumn,
				endLineNumber: mapped.range.endLineNumber,
				endColumn: mapped.range.endColumn,
			});
		}
		return result;
	}
}

/**
 * Creates a {@link QuartoShadowNotebookDiagnostics} for every shadow
 * notebook, for its lifetime.
 */
export class QuartoShadowDiagnosticsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.quartoShadowDiagnostics';

	/** Per-notebook projector lifecycles, keyed by document URI. */
	private readonly _projectors = this._register(new DisposableMap<string>());

	private readonly _bridge: QuartoShadowLanguageBridge;

	constructor(
		@IQuartoShadowNotebookService private readonly _shadowNotebookService: IQuartoShadowNotebookService,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IModelService modelService: IModelService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		this._bridge = this._instantiationService.createInstance(QuartoShadowLanguageBridge);

		// Fires on creation AND on re-creation after an external disposal.
		this._register(this._shadowNotebookService.onDidAddShadowNotebook(notebook => this._attach(notebook)));

		// Shadows created before this contribution subscribed (creation is
		// async, so in practice the event covers everything; this is a cheap
		// belt-and-braces sweep).
		for (const model of modelService.getModels()) {
			const notebook = this._shadowNotebookService.getShadowNotebook(model.uri);
			if (notebook) {
				this._attach(notebook);
			}
		}
	}

	/** Start projecting a shadow notebook's cell diagnostics. */
	private _attach(notebook: NotebookTextModel): void {
		const key = notebook.uri.toString();
		if (this._projectors.has(key) || !this._documentModelService.hasModel(notebook.uri)) {
			return;
		}
		const projector = this._instantiationService.createInstance(
			QuartoShadowNotebookDiagnostics,
			notebook,
			this._documentModelService.getModelForUri(notebook.uri),
			this._bridge,
		);
		// The notebook dies when the document closes, the setting is turned
		// off, or an external party disposes it (recreate then re-attaches
		// via onDidAddShadowNotebook).
		const disposeListener = notebook.onWillDispose(() => this._projectors.deleteAndDispose(key));
		this._projectors.set(key, {
			dispose: () => {
				disposeListener.dispose();
				projector.dispose();
			},
		});
	}
}
