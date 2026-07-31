/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer, bufferToStream } from '../../../../base/common/buffer.js';
import { Schemas } from '../../../../base/common/network.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { CellKind, ICellDto2, NotebookData, TransientOptions } from '../../notebook/common/notebookCommon.js';
import { INotebookSerializer, INotebookService } from '../../notebook/common/notebookService.js';
import { parseQuarto } from '../common/quartoParser.js';
import { QuartoNodeType } from '../common/quartoTypes.js';
import { isQuartoDocument, QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY } from '../common/positronQuartoConfig.js';
import { fenceLanguageToCellLanguage, QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE } from '../common/quartoShadowNotebook.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { QuartoShadowNotebookSync } from './quartoShadowNotebookSync.js';

export const IQuartoShadowNotebookService = createDecorator<IQuartoShadowNotebookService>('quartoShadowNotebookService');

/**
 * Owns a hidden shadow notebook for every open Quarto/R Markdown text model.
 *
 * The shadow notebook shares the .qmd file's URI, contains only the
 * document's code cells (standard `vscode-notebook-cell` URIs), and is
 * mirrored to the extension host so language clients that declare
 * `notebookDocumentSync` receive ordered, cross-cell notebook documents with
 * zero changes in language extensions. See
 * `common/quartoShadowNotebook.ts` for the sync model.
 */
export interface IQuartoShadowNotebookService {
	readonly _serviceBrand: undefined;

	/**
	 * Fired when a shadow notebook has been created and is mirroring its
	 * Quarto document.
	 */
	readonly onDidAddShadowNotebook: Event<NotebookTextModel>;

	/**
	 * @returns The shadow notebook currently mirroring the given Quarto
	 * document, or undefined if none exists (feature disabled, document not
	 * open, or creation still in flight).
	 */
	getShadowNotebook(resource: URI): NotebookTextModel | undefined;
}

/**
 * Serializer for the shadow notebook type. Only `dataToNotebook` is ever
 * used (once, when the notebook model is created from the .qmd text);
 * serialization must never happen because the notebook's resource IS the
 * .qmd file and writing code-cells-only content would destroy the prose.
 */
class QuartoShadowNotebookSerializer implements INotebookSerializer {

	readonly options: TransientOptions = {
		transientOutputs: true,
		transientCellMetadata: {},
		transientDocumentMetadata: {},
		cellContentMetadata: {},
	};

	constructor(private readonly _logService: ILogService) { }

	async dataToNotebook(data: VSBuffer): Promise<NotebookData> {
		const document = parseQuarto(data.toString(), this._logService);
		const cells: ICellDto2[] = [];
		for (const block of document.blocks) {
			if (block.type !== QuartoNodeType.CodeBlock) {
				continue;
			}
			cells.push({
				source: block.content,
				language: fenceLanguageToCellLanguage(block.language),
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [],
			});
		}
		return { cells, metadata: {} };
	}

	async notebookToData(): Promise<VSBuffer> {
		throw new Error('Quarto shadow notebooks must never be serialized: the resource is the .qmd file itself.');
	}

	async save(): Promise<never> {
		throw new Error('Quarto shadow notebooks must never be saved: the resource is the .qmd file itself.');
	}

	async searchInNotebooks(): Promise<{ results: never[]; limitHit: boolean }> {
		return { results: [], limitHit: false };
	}
}

/**
 * How many times to re-create a shadow notebook that was disposed
 * externally before giving up (see `_handleExternalDispose`).
 */
const MAX_RECREATIONS = 3;

/**
 * Tracks one Quarto text model's shadow notebook through its async creation
 * and disposal.
 */
class ShadowNotebookEntry extends Disposable {

	private _notebook: NotebookTextModel | undefined;
	private _sync: QuartoShadowNotebookSync | undefined;

	/** Whether this entry is being disposed (vs. the notebook dying on us). */
	private _disposing = false;

	/** How many times the notebook was re-created after external disposal. */
	private _recreations = 0;

	constructor(
		private readonly _textModel: ITextModel,
		private readonly _onDidCreate: (notebook: NotebookTextModel) => void,
		@INotebookService private readonly _notebookService: INotebookService,
		@IQuartoDocumentModelService private readonly _quartoDocumentModelService: IQuartoDocumentModelService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		void this._create();
	}

	/** The live shadow notebook, once creation has completed. */
	get notebook(): NotebookTextModel | undefined {
		return this._notebook;
	}

	override dispose(): void {
		this._disposing = true;
		this._sync?.dispose();
		this._sync = undefined;
		// Disposing the notebook removes it from INotebookService, which
		// mirrors a notebook close to the extension host (didClose in
		// language clients).
		this._notebook?.dispose();
		this._notebook = undefined;
		super.dispose();
	}

	private async _create(): Promise<void> {
		let notebook: NotebookTextModel;
		try {
			// Creating through INotebookService (not the editor model
			// resolver) is what mirrors the notebook to the extension host:
			// MainThreadNotebooksAndEditors builds its state from
			// INotebookService.listNotebookDocuments(). Crucially it also
			// means NO working copy exists for the notebook, so mirrored
			// edits can never make it dirty (no backup writes, no Save All
			// participation, no restore-on-reload) and there is no
			// 3-minute reference expiry: this entry owns the model outright.
			notebook = await this._notebookService.createNotebookTextModel(
				QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE,
				this._textModel.uri,
				bufferToStream(VSBuffer.fromString(this._textModel.getValue())),
			);
		} catch (err) {
			this._logService.error(`[QuartoShadowNotebook] Failed to create shadow notebook for ${this._textModel.uri.toString()}`, err);
			return;
		}

		// The text model may have closed (or this entry been disposed)
		// while the serializer ran.
		if (this._store.isDisposed || this._textModel.isDisposed()) {
			notebook.dispose();
			return;
		}

		this._notebook = notebook;
		const externalDisposeListener = notebook.onWillDispose(() => {
			externalDisposeListener.dispose();
			this._handleExternalDispose();
		});
		this._register(externalDisposeListener);

		const documentModel = this._quartoDocumentModelService.getModel(this._textModel);
		this._sync = this._instantiationService.createInstance(QuartoShadowNotebookSync, documentModel, notebook);
		this._onDidCreate(notebook);
	}

	/**
	 * The notebook was disposed by someone else while the Quarto document is
	 * still open. This can happen if another party resolved the .qmd URI as
	 * a notebook editor model (e.g. an extension calling
	 * `vscode.workspace.openNotebookDocument`): the resulting working copy
	 * wraps our model and disposes it when the last reference is released.
	 * Re-create the shadow so language features keep working, with a cap to
	 * avoid a pathological dispose/create loop.
	 */
	private _handleExternalDispose(): void {
		if (this._disposing || this._store.isDisposed) {
			return;
		}
		this._sync?.dispose();
		this._sync = undefined;
		this._notebook = undefined;
		if (this._textModel.isDisposed()) {
			return;
		}
		if (this._recreations >= MAX_RECREATIONS) {
			this._logService.error(`[QuartoShadowNotebook] Shadow notebook for ${this._textModel.uri.toString()} was disposed externally ${this._recreations + 1} times; giving up.`);
			return;
		}
		this._recreations++;
		this._logService.warn(`[QuartoShadowNotebook] Shadow notebook for ${this._textModel.uri.toString()} was disposed externally; re-creating.`);
		void this._create();
	}
}

/**
 * Implementation of the Quarto shadow notebook service.
 */
export class QuartoShadowNotebookService extends Disposable implements IQuartoShadowNotebookService {
	declare readonly _serviceBrand: undefined;

	/** Shadow notebook entries keyed by text model URI. */
	private readonly _entries = this._register(new DisposableMap<string, ShadowNotebookEntry>());

	private readonly _onDidAddShadowNotebook = this._register(new Emitter<NotebookTextModel>());
	readonly onDidAddShadowNotebook: Event<NotebookTextModel> = this._onDidAddShadowNotebook.event;

	constructor(
		@IModelService private readonly _modelService: IModelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._registerNotebookType();

		this._register(this._modelService.onModelAdded(model => this._considerModel(model)));
		this._register(this._modelService.onModelRemoved(model => this._entries.deleteAndDispose(model.uri.toString())));
		this._register(this._modelService.onModelLanguageChanged(e => this._considerModel(e.model)));

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY)) {
				this._applyConfiguration();
			}
		}));

		this._applyConfiguration();
	}

	getShadowNotebook(resource: URI): NotebookTextModel | undefined {
		return this._entries.get(resource.toString())?.notebook;
	}

	/**
	 * Register the shadow notebook type and serializer, core-side.
	 *
	 * The contribution deliberately has no `extension` and no file name
	 * patterns: NotebookProviderInfoStore only registers editors (and thus
	 * "Open With..." entries) for extension-backed contributions, and with
	 * no selectors the type never matches any resource in editor
	 * resolution. Priority `option` is belt-and-braces so the type can
	 * never win a default viewType selection. The shadow notebook must
	 * never appear as an editor choice.
	 */
	private _registerNotebookType(): void {
		// The contributed type may already be present: NotebookProviderInfoStore
		// persists contributions in a memento and restores them on startup
		// (same pattern as the interactive window's registration).
		if (!this._notebookService.getContributedNotebookType(QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE)) {
			this._register(this._notebookService.registerContributedNotebookType(QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE, {
				providerDisplayName: 'Quarto',
				displayName: 'Quarto Shadow Notebook',
				filenamePattern: [],
				priority: RegisteredEditorPriority.option,
			}));
		}
		this._register(this._notebookService.registerNotebookSerializer(
			QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE,
			{ id: new ExtensionIdentifier('positron.quarto-shadow-notebook'), location: undefined },
			new QuartoShadowNotebookSerializer(this._logService),
		));
	}

	/** Whether the shadow notebook feature is enabled. */
	private _isEnabled(): boolean {
		return this._configurationService.getValue<boolean>(QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY) !== false;
	}

	/** Create shadows for open Quarto documents, or tear all of them down. */
	private _applyConfiguration(): void {
		if (this._isEnabled()) {
			for (const model of this._modelService.getModels()) {
				this._considerModel(model);
			}
		} else {
			this._entries.clearAndDisposeAll();
		}
	}

	/** Create or remove the shadow for a text model based on eligibility. */
	private _considerModel(model: ITextModel): void {
		if (!this._isEnabled()) {
			return;
		}
		const key = model.uri.toString();
		if (isShadowEligible(model)) {
			if (!this._entries.has(key)) {
				this._logService.debug(`[QuartoShadowNotebook] Creating shadow notebook for ${key}`);
				this._entries.set(key, this._instantiationService.createInstance(
					ShadowNotebookEntry,
					model,
					(notebook: NotebookTextModel) => this._onDidAddShadowNotebook.fire(notebook),
				));
			}
		} else {
			// E.g. the model's language changed away from Quarto.
			this._entries.deleteAndDispose(key);
		}
	}
}

/**
 * Whether a text model should be mirrored by a shadow notebook: an on-disk
 * (local or remote) Quarto/R Markdown document. Untitled documents are
 * excluded for now: the same-URI design relies on the file URI for the
 * language servers' config discovery and for pull-diagnostic visibility.
 */
function isShadowEligible(model: ITextModel): boolean {
	if (model.isDisposed() || model.isForSimpleWidget) {
		return false;
	}
	if (model.uri.scheme !== Schemas.file && model.uri.scheme !== Schemas.vscodeRemote) {
		return false;
	}
	return isQuartoDocument(model.uri.path, model.getLanguageId());
}

/**
 * Eagerly instantiates the shadow notebook service so shadows exist for
 * already-open Quarto documents after startup.
 */
export class QuartoShadowNotebookContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.quartoShadowNotebook';

	constructor(
		@IQuartoShadowNotebookService _quartoShadowNotebookService: IQuartoShadowNotebookService,
	) { }
}
