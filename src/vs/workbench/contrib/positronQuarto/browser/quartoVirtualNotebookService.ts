/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Schemas } from '../../../../base/common/network.js';
import { basename } from '../../../../base/common/resources.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { EndOfLinePreference, ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService, LogLevel } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { CellEditType, CellKind, ICellDto2, NotebookData } from '../../notebook/common/notebookCommon.js';
import { INotebookSerializer, INotebookService } from '../../notebook/common/notebookService.js';
import {
	QUARTO_NATIVE_LANGUAGE_FEATURES_KEY,
	isQuartoDocument,
	isQuartoOrRmdFile,
	usingNativeEmbeddedFeatures,
} from '../common/positronQuartoConfig.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../common/quartoTypes.js';
import { QUARTO_CELLS_SCHEME, QUARTO_CELLS_VIEW_TYPE } from '../common/quartoVirtualNotebookTypes.js';
import { diffCellRuns, ICellRun, ICellSplice } from '../common/quartoCellDiff.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';

/**
 * Schemes whose documents are the ones a user edits, and so the only ones worth
 * a virtual notebook. Everything else with a `.qmd` path (Git diffs, local
 * history, other read-only providers) is a snapshot of some other revision.
 */
const EDITABLE_SCHEMES = new Set<string>([
	Schemas.file,
	Schemas.untitled,
	Schemas.vscodeRemote,
]);

/**
 * A single code cell of a Quarto virtual notebook.
 */
export interface IQuartoVirtualCell {
	/** The `vscode-notebook-cell` URI of this cell. */
	readonly cellUri: URI;
	/** Handle of the notebook cell this maps to. */
	readonly handle: number;
	/** Language of the cell, for example `r` or `python`. */
	readonly language: string;
	/** 1-based line in the source document of the first line of code. */
	readonly codeStartLine: number;
	/** 1-based line in the source document of the last line of code. */
	readonly codeEndLine: number;
	/** The text model bound to this notebook cell. */
	readonly textModel: ITextModel;
}

export interface IQuartoVirtualNotebookService {
	readonly _serviceBrand: undefined;

	/** Notebook URI for an open Quarto document, if a virtual notebook exists. */
	getNotebookUri(sourceUri: URI): URI | undefined;

	/** Cells of the virtual notebook for a source document, in document order. */
	getCells(sourceUri: URI): readonly IQuartoVirtualCell[];

	/**
	 * Cells of every virtual notebook. For callers that need to know what the
	 * open Quarto documents contain overall rather than what one of them holds.
	 */
	getAllCells(): readonly IQuartoVirtualCell[];

	/** The cell whose code contains the given 1-based source line, if any. */
	getCellAtLine(sourceUri: URI, lineNumber: number): IQuartoVirtualCell | undefined;

	/** Reverse lookup: the source document owning a cell URI, if it is ours. */
	getSourceUriForCell(cellUri: URI): URI | undefined;

	/**
	 * Re-parse and re-sync right now if either is pending, so that the cells of
	 * a source document match its current content on return.
	 */
	ensureSynchronized(sourceUri: URI): void;

	/**
	 * Resolves once any in-flight notebook creation for a source document has
	 * settled. Creation is asynchronous, so callers that need to observe the
	 * result of opening a document have to wait for it.
	 */
	whenReady(sourceUri: URI): Promise<void>;
}

export const IQuartoVirtualNotebookService =
	createDecorator<IQuartoVirtualNotebookService>('quartoVirtualNotebookService');

/**
 * Serializer for the hidden notebooks. `INotebookService.createNotebookTextModel`
 * requires one, but these notebooks are never read from or written to disk, so
 * the data paths are inert and the persistence paths throw.
 */
class QuartoCellsSerializer implements INotebookSerializer {
	readonly options = {
		transientOutputs: true,
		transientCellMetadata: {},
		transientDocumentMetadata: {},
		cellContentMetadata: {},
	};

	async dataToNotebook(): Promise<NotebookData> {
		return { cells: [], metadata: {} };
	}

	async notebookToData(): Promise<VSBuffer> {
		return VSBuffer.fromString('');
	}

	async save(): Promise<never> {
		throw new Error('Quarto virtual notebooks are never saved');
	}

	async searchInNotebooks(): Promise<{ results: never[]; limitHit: boolean }> {
		return { results: [], limitHit: false };
	}
}

/**
 * The URI of the hidden notebook for a source document: the source URI under our
 * own scheme, since the extension host cannot hold a text document and a notebook
 * document at the same URI.
 *
 * The path is kept because a cell URI carries the path of the notebook it belongs
 * to, and that path is how a language client tells our cells from the cells of a
 * real notebook: both clients select on `**\/*.{qmd,rmd}`. An untitled document
 * has no extension to select on ("Untitled-1", from _Quarto: New Document_), so
 * it gets a Quarto one. Otherwise its cells reach no language server and the
 * document silently has no language features.
 */
function quartoNotebookUri(sourceUri: URI): URI {
	return sourceUri.with({
		scheme: QUARTO_CELLS_SCHEME,
		path: isQuartoOrRmdFile(sourceUri.path) ? sourceUri.path : `${sourceUri.path}.qmd`,
	});
}

/**
 * The hidden notebook backing a single Quarto document, and the machinery that
 * keeps it in sync with the source text model.
 */
class QuartoVirtualNotebook extends Disposable {
	private _cells: IQuartoVirtualCell[] = [];
	private _notebook: NotebookTextModel | undefined;

	readonly notebookUri: URI;

	constructor(
		readonly sourceUri: URI,
		private readonly _documentModel: IQuartoDocumentModel,
		private readonly _modelService: IModelService,
		private readonly _notebookService: INotebookService,
		private readonly _languageService: ILanguageService,
		private readonly _logService: ILogService,
	) {
		super();
		this.notebookUri = quartoNotebookUri(sourceUri);

		// onDidParse rather than onDidChangeCells: cells also need re-syncing when
		// they merely move, which happens whenever prose above a chunk grows or
		// shrinks. onDidChangeCells stays quiet for that, and stale line spans
		// would silently misplace every mapped position.
		this._register(this._documentModel.onDidParse(() => this._sync()));
	}

	get cells(): readonly IQuartoVirtualCell[] {
		return this._cells;
	}

	async initialize(): Promise<void> {
		if (this._notebookService.getNotebookTextModel(this.notebookUri)) {
			// Throwing rather than returning: without a notebook this object can
			// never produce a cell, and the caller's failure path removes it so a
			// later edit can try again. Returning would leave it registered and
			// permanently inert.
			throw new Error(`A Quarto virtual notebook already exists for ${this.notebookUri.toString()}`);
		}

		const notebook = await this._notebookService.createNotebookTextModel(
			QUARTO_CELLS_VIEW_TYPE, this.notebookUri);
		if (this._store.isDisposed) {
			// The source document closed while creation was in flight.
			notebook.dispose();
			return;
		}

		this._notebook = notebook;
		this._sync();
		this._logService.debug(
			`[QuartoVirtualNotebook] Created ${this.notebookUri.toString()} with ${this._cells.length} cells`);
	}

	/** Bring the cells in line with the source document. */
	synchronize(): void {
		// A pending re-parse fires onDidParse, which syncs. Sync again anyway:
		// it is cheap, idempotent, and covers the case where nothing was pending.
		this._documentModel.synchronize();
		this._sync();
	}

	/** How a cell looks to the diff. A disposed model has no code, so it matches nothing. */
	private static _runOf(cell: IQuartoVirtualCell): ICellRun {
		return {
			language: cell.language,
			// EndOfLinePreference.LF: the model's own EOL is platform dependent (a
			// single-line model created on Windows defaults to CRLF), but
			// getCellCode always joins with LF. Reading with the model's own EOL
			// here would compare CRLF against LF forever for such a cell, so
			// sameCell would never match it and every edit would replace it.
			code: cell.textModel.isDisposed() ? undefined : cell.textModel.getValue(EndOfLinePreference.LF),
		};
	}

	/**
	 * Reconcile the cells with the source document, replacing only the cells
	 * whose position or language changed. The rest keep their handle, URI, and
	 * text model, so a language server sees a didChange rather than a close and
	 * reopen of every cell.
	 */
	private _sync(): void {
		if (!this._notebook || this._store.isDisposed) {
			return;
		}

		const sourceCells = this._documentModel.cells;
		const codes = sourceCells.map(cell => this._documentModel.getCellCode(cell));

		// An unchanged count and language at every index means position alone
		// identifies each cell, so any content difference is an edit rather than a
		// different chunk. diffCellRuns matches on (language, code) with no notion
		// of position, and would read that edit as a remove plus an insert,
		// recreating the text model on every keystroke. Let the refresh below take
		// the new text across in place instead.
		const sameShape = sourceCells.length === this._cells.length
			&& this._cells.every(cell => !cell.textModel.isDisposed())
			&& sourceCells.every((sourceCell, index) => sourceCell.language === this._cells[index].language);

		if (!sameShape) {
			const runs: ICellRun[] = sourceCells.map((cell, index) => ({
				language: cell.language,
				code: codes[index],
			}));

			const splice = diffCellRuns(this._cells.map(QuartoVirtualNotebook._runOf), runs);
			if (splice.removeCount > 0 || splice.insertCount > 0) {
				this._spliceCells(this._notebook, splice, sourceCells, codes);
			}
		}

		// Spans go stale whenever a chunk moves, which happens whenever anything
		// above it changes size, so every surviving cell is refreshed here. Content
		// comes across too, for the cells the splice did not rewrite.
		this._cells = this._cells.map((cell, index) => {
			const sourceCell = sourceCells[index];
			const code = codes[index];
			if (!cell.textModel.isDisposed() && cell.textModel.getValue(EndOfLinePreference.LF) !== code) {
				cell.textModel.applyEdits([{ range: cell.textModel.getFullModelRange(), text: code }]);
			}
			return {
				...cell,
				codeStartLine: sourceCell.codeStartLine,
				codeEndLine: sourceCell.codeEndLine,
			};
		});
	}

	/**
	 * Apply one contiguous replacement to the notebook and to `_cells`. The
	 * notebook comes from the caller, which has already narrowed it, rather
	 * than being re-read from `this._notebook`: `_sync` cannot survive this
	 * returning without splicing, since it assumes afterwards that `this._cells`
	 * and `sourceCells` line up index for index.
	 */
	private _spliceCells(
		notebook: NotebookTextModel,
		splice: ICellSplice,
		sourceCells: readonly QuartoCodeCell[],
		codes: readonly string[]
	): void {
		const dtos: ICellDto2[] = [];
		for (let index = splice.prefix; index < splice.prefix + splice.insertCount; index++) {
			const sourceCell = sourceCells[index];
			dtos.push({
				source: codes[index],
				language: sourceCell.language,
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [],
			});
		}

		// Drop the outgoing cells from `_cells` before disposing their models, so
		// that a listener woken by the dispose below, or by the notebook edit
		// after it, can never read `_cells` back to a model that is already gone.
		// `applyEdits` and `createModel` both fire their change events inline, so
		// there is no later point at which removing them would still be in time.
		const removed = this._cells.slice(splice.prefix, splice.prefix + splice.removeCount);
		const kept = this._cells.length - splice.removeCount;
		this._cells = [
			...this._cells.slice(0, splice.prefix),
			...this._cells.slice(splice.prefix + splice.removeCount),
		];

		// The whole point of this class is how few cells it touches, and that is
		// invisible from the editor: the only other evidence is didOpen/didClose
		// traffic in a language server log, interleaved with the Quarto
		// extension's own virtual document churn. One line per structural change
		// says what was decided. Nothing is logged for a content-only edit, which
		// takes the in-place path and would otherwise log on every keystroke.
		//
		// `=== LogLevel.Trace` rather than `<=`, because LogLevel.Off is 0 and
		// Trace is 1, so `<=` is also true when logging is turned off.
		if (this._logService.getLevel() === LogLevel.Trace) {
			this._logService.trace(
				`[QuartoVirtualNotebook] ${basename(this.sourceUri)}: spliced at ${splice.prefix}, ` +
				`removed ${splice.removeCount}, inserted ${splice.insertCount}, kept ${kept}`);
		}

		for (const cell of removed) {
			if (!cell.textModel.isDisposed()) {
				cell.textModel.dispose();
			}
		}

		notebook.applyEdits(
			[{
				editType: CellEditType.Replace,
				index: splice.prefix,
				count: splice.removeCount,
				cells: dtos,
			}],
			true, undefined, () => undefined, undefined, false
		);

		// Creating a model at the cell URI is what binds it: NotebookTextModel
		// watches onModelAdded and adopts any model whose URI parses as one of its
		// cells, which is what makes the extension host see a real TextDocument.
		const inserted = notebook.cells
			.slice(splice.prefix, splice.prefix + splice.insertCount)
			.map((notebookCell, offset) => {
				const sourceCell = sourceCells[splice.prefix + offset];
				const textModel = this._modelService.createModel(
					notebookCell.getValue(),
					this._languageService.createById(sourceCell.language),
					notebookCell.uri
				);
				return {
					cellUri: notebookCell.uri,
					handle: notebookCell.handle,
					language: sourceCell.language,
					codeStartLine: sourceCell.codeStartLine,
					codeEndLine: sourceCell.codeEndLine,
					textModel,
				};
			});

		// The removed cells are already gone from `_cells` (see above), so the tail
		// to keep starts at `splice.prefix`, not `splice.prefix + splice.removeCount`.
		this._cells = [
			...this._cells.slice(0, splice.prefix),
			...inserted,
			...this._cells.slice(splice.prefix),
		];
	}

	/**
	 * Dispose the cell text models. We own them: a notebook cell holds only a
	 * weak reference to its text model and drops it on disposal rather than
	 * disposing it.
	 */
	private _disposeCells(): void {
		for (const cell of this._cells) {
			if (!cell.textModel.isDisposed()) {
				cell.textModel.dispose();
			}
		}
		this._cells = [];
	}

	override dispose(): void {
		super.dispose();
		this._disposeCells();
		this._notebook?.dispose();
		this._notebook = undefined;
		this._logService.debug(
			`[QuartoVirtualNotebook] Disposed the notebook for ${this.sourceUri.toString()}`);
	}
}

/**
 * Maintains a hidden in-memory notebook for every open Quarto document, so that
 * embedded code cells are visible to language servers as ordinary notebook
 * cells. No editor is ever opened for these notebooks, which is what keeps them
 * invisible to the user while the extension host still sees them.
 */
export class QuartoVirtualNotebookService extends Disposable implements IQuartoVirtualNotebookService {
	declare readonly _serviceBrand: undefined;

	private readonly _notebooks = this._register(new DisposableMap<string, QuartoVirtualNotebook>());
	private readonly _pending = new Map<string, Promise<void>>();
	private _notebookTypeRegistered = false;

	constructor(
		@IModelService private readonly _modelService: IModelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(this._modelService.onModelAdded(model => this._onModelAdded(model)));
		this._register(this._modelService.onModelLanguageChanged(e => this._onModelAdded(e.model)));
		this._register(this._modelService.onModelRemoved(model => this._onModelRemoved(model)));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(QUARTO_NATIVE_LANGUAGE_FEATURES_KEY)) {
				this._reconcileAll();
			}
		}));

		for (const model of this._modelService.getModels()) {
			this._onModelAdded(model);
		}
	}

	/**
	 * Register the notebook type and serializer, once, the first time a notebook
	 * is actually wanted. This is deliberately not constructor work: registering
	 * the type writes to profile storage, and a user who never turns the setting
	 * on should not accumulate state for a feature they do not use.
	 */
	private _ensureNotebookTypeRegistered(): void {
		if (this._notebookTypeRegistered) {
			return;
		}

		// registerContributedNotebookType writes the type into profile-scoped
		// storage, which is rehydrated on the next window, so registering
		// unconditionally throws "ALREADY EXISTS" on every window after the
		// first. The rehydrated entry is inert (no editor contribution point is
		// created without an extension, and the filename pattern matches no real
		// file), so recognizing it and moving on is enough.
		if (!this._notebookService.getContributedNotebookType(QUARTO_CELLS_VIEW_TYPE)) {
			this._register(this._notebookService.registerContributedNotebookType(QUARTO_CELLS_VIEW_TYPE, {
				providerDisplayName: 'Positron',
				displayName: localize('positron.quartoCells', "Quarto Cells (Internal)"),
				// Matches no real file, so this type never appears in Open With.
				filenamePattern: ['*.quarto-cells-internal'],
			}));
		}

		// The serializer is not persisted, so it is registered every window.
		this._register(this._notebookService.registerNotebookSerializer(
			QUARTO_CELLS_VIEW_TYPE,
			{ id: new ExtensionIdentifier('positron.quarto-cells'), location: undefined },
			new QuartoCellsSerializer()
		));

		// Last, so that a failure part way through is retried rather than leaving
		// the type half registered and every later notebook creation failing.
		this._notebookTypeRegistered = true;
	}

	private _onModelAdded(model: ITextModel): void {
		// Only documents the user is actually editing. A Quarto check on the path
		// alone would also match the read-only models that back a Git diff or a
		// local history entry, and each of those would get its own notebook whose
		// cells hold some older revision of the file. Language servers would then
		// be syncing several versions of the same document at once.
		if (!EDITABLE_SCHEMES.has(model.uri.scheme)) {
			return;
		}
		if (!usingNativeEmbeddedFeatures(this._configurationService)) {
			return;
		}
		if (!isQuartoDocument(model.uri.path, model.getLanguageId())) {
			return;
		}

		const key = model.uri.toString();
		if (this._notebooks.has(key)) {
			return;
		}

		this._ensureNotebookTypeRegistered();

		const notebook = new QuartoVirtualNotebook(
			model.uri,
			this._documentModelService.getModel(model),
			this._modelService,
			this._notebookService,
			this._languageService,
			this._logService,
		);
		this._notebooks.set(key, notebook);

		const pending = notebook.initialize()
			.catch(err => {
				this._logService.error(
					`[QuartoVirtualNotebookService] Failed to create a notebook for ${key}`, err);
				this._notebooks.deleteAndDispose(key);
			})
			.finally(() => {
				if (this._pending.get(key) === pending) {
					this._pending.delete(key);
				}
			});
		this._pending.set(key, pending);
	}

	private _onModelRemoved(model: ITextModel): void {
		if (model.uri.scheme === Schemas.vscodeNotebookCell) {
			return;
		}
		this._notebooks.deleteAndDispose(model.uri.toString());
	}

	/** Create or drop notebooks to match the current setting value. */
	private _reconcileAll(): void {
		if (usingNativeEmbeddedFeatures(this._configurationService)) {
			for (const model of this._modelService.getModels()) {
				this._onModelAdded(model);
			}
			return;
		}

		for (const key of [...this._notebooks.keys()]) {
			this._notebooks.deleteAndDispose(key);
		}
	}

	getNotebookUri(sourceUri: URI): URI | undefined {
		return this._notebooks.get(sourceUri.toString())?.notebookUri;
	}

	getCells(sourceUri: URI): readonly IQuartoVirtualCell[] {
		return this._notebooks.get(sourceUri.toString())?.cells ?? [];
	}

	getAllCells(): readonly IQuartoVirtualCell[] {
		const cells: IQuartoVirtualCell[] = [];
		for (const notebook of this._notebooks.values()) {
			cells.push(...notebook.cells);
		}
		return cells;
	}

	getCellAtLine(sourceUri: URI, lineNumber: number): IQuartoVirtualCell | undefined {
		return this.getCells(sourceUri).find(
			cell => lineNumber >= cell.codeStartLine && lineNumber <= cell.codeEndLine
		);
	}

	getSourceUriForCell(cellUri: URI): URI | undefined {
		const key = cellUri.toString();
		for (const notebook of this._notebooks.values()) {
			if (notebook.cells.some(cell => cell.cellUri.toString() === key)) {
				return notebook.sourceUri;
			}
		}
		return undefined;
	}

	ensureSynchronized(sourceUri: URI): void {
		this._notebooks.get(sourceUri.toString())?.synchronize();
	}

	async whenReady(sourceUri: URI): Promise<void> {
		await this._pending.get(sourceUri.toString());
	}
}

/**
 * Brings the virtual notebook service into existence.
 *
 * The service watches for open Quarto documents rather than answering requests,
 * so nothing else ever asks for it, and a service nobody depends on is never
 * constructed. Taking it as a constructor dependency here is what makes it run.
 * Registering it `Eager` matters for the same reason: a delayed service hands
 * out a proxy and defers the constructor until a property is read.
 */
export class QuartoVirtualNotebookContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronQuartoVirtualNotebook';

	constructor(
		@IQuartoVirtualNotebookService private readonly _virtualNotebookService: IQuartoVirtualNotebookService,
	) {
		super();
		// The service gates itself on the setting and reacts to changes, so
		// there is nothing to do here beyond depending on it.
		void this._virtualNotebookService;
	}
}
