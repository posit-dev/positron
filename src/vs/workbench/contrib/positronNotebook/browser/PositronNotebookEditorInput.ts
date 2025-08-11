/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IReference } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { EditorInputCapabilities, GroupIdentifier, IRevertOptions, ISaveOptions, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IResolvedNotebookEditorModel } from '../../notebook/common/notebookCommon.js';
import { INotebookEditorModelResolverService } from '../../notebook/common/notebookEditorModelResolverService.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { PositronNotebookInstance } from './PositronNotebookInstance.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ExtUri, joinPath } from '../../../../base/common/resources.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { Schemas } from '../../../../base/common/network.js';

/**
 * Mostly empty options object. Based on the same one in `vs/workbench/contrib/notebook/browser/notebookEditorInput.ts`
 * May be filled out later.
 */
export interface PositronNotebookEditorInputOptions {
	startDirty?: boolean;
}


/**
 * PositronDataToolEditorInput class.
 */
export class PositronNotebookEditorInput extends EditorInput {

	/**
	 * Value to keep track of what input instance we're on.
	 * Used for keeping track in the logs.
	 */
	static count = 0;

	/**
	 * Unique identifier for this specific input instance
	 */
	readonly uniqueId: string = `positron-notebook-${PositronNotebookEditorInput.count++}`;

	private _identifier = `Positron Notebook | Input(${this.uniqueId}) |`;
	//#region Static Properties
	/**
	 * Gets the type ID.
	 */
	static readonly ID: string = 'workbench.input.positronNotebook';

	/**
	 * Gets the editor ID.
	 */
	static readonly EditorID: string = 'workbench.editor.positronNotebook';

	/**
	 * Editor options. For use in resolving the editor model.
	 */
	editorOptions: IEditorOptions | undefined = undefined;

	/**
	 * Method for getting or creating a PositronNotebookEditorInput. This is mostly here to match
	 * the format of the input creation method for the vscode notebooks.
	 * @param instantiationService Service provided by vscode DI for instantiating objects with
	 * dependencies.
	 * @param resource The resource (aka file) for the notebook we're working with.
	 * @param preferredResource The preferred resource. See the definition of
	 * `EditorInputWithPreferredResource` for more info.
	 * @param viewType The view type for the notebook. Aka `'jupyter-notebook;`.
	 * @param options Options for the notebook editor input.
	 */
	static getOrCreate(instantiationService: IInstantiationService, resource: URI, preferredResource: URI | undefined, viewType: string, options: PositronNotebookEditorInputOptions = {}) {

		// In the vscode-notebooks there is some caching work done here for looking for editors that
		// exist etc. We may need that eventually but not now.
		return instantiationService.createInstance(PositronNotebookEditorInput, resource, viewType, options);
	}


	// TODO: Describe why this is here.
	// This is a reference to the model that is currently being edited in the editor.
	private _editorModelReference: IReference<IResolvedNotebookEditorModel> | null = null;

	notebookInstance: PositronNotebookInstance | undefined;

	//#endregion Static Properties
	//#region Constructor & Dispose
	/**
	 * Constructor.
	 * @param resource The resource.
	 */
	constructor(
		readonly resource: URI,
		public readonly viewType: string,
		public readonly options: PositronNotebookEditorInputOptions = {},
		// Borrow notebook resolver service from vscode notebook renderer.
		@INotebookEditorModelResolverService private readonly _notebookModelResolverService: INotebookEditorModelResolverService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
	) {
		// Call the base class's constructor.
		super();
		this._logService.info(this._identifier, 'constructor');

		this.notebookInstance = PositronNotebookInstance.getOrCreate(this, undefined, instantiationService);
	}

	/**
	 * dispose override method.
	 */
	override dispose(): void {
		// Dispose the notebook instance if it exists
		this.notebookInstance?.dispose();

		// Call the base class's dispose method
		super.dispose();
	}

	//#endregion Constructor & Dispose
	//#region AbstractEditorInput Overrides
	/**
	 * Gets the type identifier.
	 */
	override get typeId(): string {
		return PositronNotebookEditorInput.ID;
	}

	/**
	 * Gets the capabilities of this input.
	 */
	override get capabilities(): EditorInputCapabilities {
		let capabilities = EditorInputCapabilities.None;

		// Check if this is an untitled notebook
		if (this.resource.scheme === Schemas.untitled) {
			capabilities |= EditorInputCapabilities.Untitled;
		}

		// Check if the notebook is readonly
		if (this._editorModelReference?.object.isReadonly()) {
			capabilities |= EditorInputCapabilities.Readonly;
		}

		return capabilities;
	}

	override async revert(_group: GroupIdentifier, options?: IRevertOptions): Promise<void> {
		if (this._editorModelReference && this._editorModelReference.object.isDirty()) {
			await this._editorModelReference.object.revert(options);
		}
	}

	/**
	 * Gets the editor identifier.
	 */
	override get editorId(): string {
		return PositronNotebookEditorInput.EditorID;
	}

	/**
	 * Gets the display name of this input.
	 * @returns The display name of this input.
	 */
	override getName(): string {
		const extUri = new ExtUri(() => false);
		return extUri.basename(this.resource) ?? localize('positron.notebook.inputName', "Positron Notebook");
	}

	/**
	 * Determines whether the other input matches this input
	 * @param otherInput The other input.
	 * @returns true if the other input matches this input; otherwise, false.
	 */
	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof PositronNotebookEditorInput &&
			otherInput.resource.toString() === this.resource.toString();
	}

	/**
	 * Determines whether the input is dirty. Aka if it has unsaved changes.
	 * @returns true if the input is dirty; otherwise, false.
	 */
	override isDirty(): boolean {
		// Go to the editor model reference and check if it's dirty.
		return this._editorModelReference?.object.isDirty() ?? this.options.startDirty ?? false;
	}

	/**
	 * Adds functionality for saving a notebook.
	 * @param group Editor group the notebook is currently in
	 * @param options Save options
	 * @returns Input after saving
	 */
	override async save(_group: GroupIdentifier, options?: ISaveOptions): Promise<EditorInput | IUntypedEditorInput | undefined> {
		if (this._editorModelReference) {

			if (this.hasCapability(EditorInputCapabilities.Untitled)) {
				return this.saveAs(_group, options);
			} else {
				await this._editorModelReference.object.save(options);
			}

			return this;
		}

		return undefined;
	}

	/**
	 * Saves an untitled notebook to a new location.
	 * @param group Editor group the notebook is currently in
	 * @param options Save options
	 * @returns A new untyped editor input with the saved resource
	 */
	override async saveAs(_group: GroupIdentifier, options?: ISaveOptions): Promise<IUntypedEditorInput | undefined> {
		if (!this._editorModelReference) {
			return undefined;
		}

		// Get the notebook provider info to validate file extensions
		const provider = this._notebookService.getContributedNotebookType(this.viewType);
		if (!provider) {
			return undefined;
		}

		// Suggest a name for the file based on the current untitled name
		const extUri = new ExtUri(() => false);
		const suggestedName = extUri.basename(this.resource);
		const pathCandidate = await this._suggestName(provider, suggestedName);

		// Ask the user where to save the file with proper filters
		const target = await this._fileDialogService.showSaveDialog({
			title: localize('positron.notebook.saveAs', "Save Notebook As"),
			defaultUri: pathCandidate,
			filters: [
				// This will ensure that the saved file has the .ipynb extension.
				{ name: localize('positron.notebook.fileType', 'Jupyter Notebook'), extensions: ['ipynb'] }
			],
			availableFileSystems: options?.availableFileSystems
		});
		if (!target) {
			return undefined; // save cancelled
		}

		// Transfer the runtime session when saving an untitled notebook
		try {
			this._logService.debug(`Reassigning notebook session URI: ${this.resource.toString()} → ${target.toString()}`);

			// Call updateNotebookSessionUri on the runtime service
			// This updates internal mappings and emits events that other components listen for
			const sessionId = this._runtimeSessionService.updateNotebookSessionUri(this.resource, target);

			if (sessionId) {
				// Log success to aid debugging session transfer issues
				this._logService.debug(`Successfully reassigned session ${sessionId} to URI: ${target.toString()}`);
			} else {
				// This is an expected case for notebooks without executed cells (no session yet)
				this._logService.debug(`No session found to reassign for URI: ${this.resource.toString()}`);
			}
		} catch (error) {
			// Why we catch but continue:
			// 1. Session transfer is important but secondary to saving the file content
			// 2. Failed session transfer shouldn't prevent the user from saving their work
			// 3. In the worst case, the notebook will save but users may need to re-run cells
			this._logService.error('Failed to reassign notebook session URI', error);
		}

		// Use the model's saveAs method which handles the actual file saving
		const result = await this._editorModelReference.object.saveAs(target);

		if (result) {
			// After 'saveAs', the original untitled working copy is left in a dirty state.
			// This causes the editor framework to prompt the user to save the untitled file
			// when it's eventually closed, which is not the desired behavior.
			//
			// The `revert` call is the correct, albeit semantically odd, way to resolve this.
			// Internally, `revert` performs the two actions we need:
			// 1. It discards the backup for the untitled resource via IWorkingCopyBackupService
			// 2. It resets the model's in-memory dirty state
			// This transitions the working copy to a clean state, allowing the framework to
			// close the untitled editor gracefully without a user prompt.
			//
			// Note: This is working around a design limitation in VS Code's NotebookEditorModel.saveAs()
			// which creates a new working copy but doesn't clean up the source untitled working copy.
			// See the "hacky" comment in SimpleNotebookEditorModel.saveAs()'s implementation.
			await this._editorModelReference.object.revert();

			// Update the instance map to handle the URI change from untitled to saved file
			// This ensures the same notebook instance continues to be used after save
			PositronNotebookInstance.updateInstanceUri(this.resource, target);
		}

		return result;
	}

	private async _suggestName(provider: any, suggestedFilename: string): Promise<URI> {
		// Try to extract file extension from the provider's selector
		const firstSelector = provider.selectors?.[0];
		let selectorStr = firstSelector && typeof firstSelector === 'string' ? firstSelector : undefined;

		if (!selectorStr && firstSelector) {
			const include = (firstSelector as { include?: string }).include;
			if (typeof include === 'string') {
				selectorStr = include;
			}
		}

		if (selectorStr) {
			const matches = /^\*\.([A-Za-z_-]*)$/.exec(selectorStr);
			if (matches && matches.length > 1) {
				const fileExt = matches[1];
				if (!suggestedFilename.endsWith(fileExt)) {
					return joinPath(await this._fileDialogService.defaultFilePath(), suggestedFilename + '.' + fileExt);
				}
			}
		}

		return joinPath(await this._fileDialogService.defaultFilePath(), suggestedFilename);
	}

	override async resolve(_options?: IEditorOptions): Promise<IResolvedNotebookEditorModel | null> {
		this._logService.info(this._identifier, 'resolve');

		if (this.editorOptions) {
			_options = this.editorOptions;
		}

		if (!await this._notebookService.canResolve(this.viewType)) {
			return null;
		}

		// If we dont already have a model hooked up. We need to do that.
		if (!this._editorModelReference) {
			// Look for the model reference using the resolver service.
			const ref = await this._notebookModelResolverService.resolve(this.resource, this.viewType);

			if (this._editorModelReference) {
				// According to the existing notebook code it's possibel that the
				// editorModelReference was set while we were waiting here. In that case we can
				// throw away the one we just resolved and return the one that was already set.
				ref.dispose();
				return (<IReference<IResolvedNotebookEditorModel>>this._editorModelReference).object;
			}

			this._editorModelReference = ref;

			if (this.isDisposed()) {
				// If for some reason the input was disposed while we were waiting for the model
				// we should shut everything down.
				this._editorModelReference.dispose();
				this._editorModelReference = null;
				return null;
			}

			// Setup listeners for the model change events so we can forward them to the editor.
			this._register(this._editorModelReference.object.onDidChangeDirty(() => this._onDidChangeDirty.fire()));
			this._register(this._editorModelReference.object.onDidChangeReadonly(() => this._onDidChangeCapabilities.fire()));


			// If the model is dirty we need to fire the dirty event.
			// Not sure why this is not an event listner.
			if (this._editorModelReference.object.isDirty()) {
				this._onDidChangeDirty.fire();
			}
		} else {
			this._editorModelReference.object.load();
		}

		// In the vscode-notebooks there is a logic branch here to handle
		// cases with a _backupId. Not sure what it does or when it's needed but
		// am leaving this here as a reminder we skipped something.
		// if (this.options._backupId) {}

		return this._editorModelReference.object;
	}
}
