/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { IReference } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { EditorInputCapabilities, GroupIdentifier, ISaveOptions, IUntypedEditorInput } from 'vs/workbench/common/editor';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { IResolvedNotebookEditorModel } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookEditorModelResolverService } from 'vs/workbench/contrib/notebook/common/notebookEditorModelResolverService';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { PositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';

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
		@IContextKeyService contextKeyService: IContextKeyService,

	) {
		// Call the base class's constructor.
		super();

		this.notebookInstance = instantiationService.createInstance(PositronNotebookInstance, this, undefined);
	}

	/**
	 * dispose override method.
	 */
	override dispose(): void {
		// Call the base class's dispose method.
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
		return localize('positronNotebookInputName', "Positron Notebook");
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
	override async save(group: GroupIdentifier, options?: ISaveOptions): Promise<EditorInput | IUntypedEditorInput | undefined> {
		if (this._editorModelReference) {

			if (this.hasCapability(EditorInputCapabilities.Untitled)) {
				return this.saveAs(group, options);
			} else {
				await this._editorModelReference.object.save(options);
			}

			return this;
		}

		return undefined;
	}

	override async resolve(_options?: IEditorOptions): Promise<IResolvedNotebookEditorModel | null> {

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
			this._register(this._editorModelReference.object.onDidRevertUntitled(() => this.dispose()));

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
