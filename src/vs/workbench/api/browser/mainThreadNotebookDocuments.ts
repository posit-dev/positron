/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { DisposableStore, dispose } from '../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../base/common/map.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { BoundModelReferenceCollection } from './mainThreadDocuments.js';
import { NotebookTextModel } from '../../contrib/notebook/common/model/notebookTextModel.js';
import { NotebookCellsChangeType } from '../../contrib/notebook/common/notebookCommon.js';
import { INotebookEditorModelResolverService } from '../../contrib/notebook/common/notebookEditorModelResolverService.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { ExtHostContext, ExtHostNotebookDocumentsShape, MainThreadNotebookDocumentsShape, NotebookCellDto, NotebookCellsChangedEventDto, NotebookDataDto } from '../common/extHost.protocol.js';
import { NotebookDto } from './mainThreadNotebookDto.js';
import { SerializableObjectWithBuffers } from '../../services/extensions/common/proxyIdentifier.js';
import { IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
// --- Start Positron ---
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../services/editor/common/editorGroupsService.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { PositronNotebookEditorInput } from '../../contrib/positronNotebook/browser/PositronNotebookEditorInput.js';
import { usingPositronNotebooks } from '../../services/positronNotebook/common/positronNotebookUtils.js';
// --- End Positron ---

export class MainThreadNotebookDocuments implements MainThreadNotebookDocumentsShape {

	private readonly _disposables = new DisposableStore();

	private readonly _proxy: ExtHostNotebookDocumentsShape;
	private readonly _documentEventListenersMapping = new ResourceMap<DisposableStore>();
	private readonly _modelReferenceCollection: BoundModelReferenceCollection;

	constructor(
		extHostContext: IExtHostContext,
		@INotebookEditorModelResolverService private readonly _notebookEditorModelResolverService: INotebookEditorModelResolverService,
		// --- Start Positron ---
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ILogService private readonly _logService: ILogService,
		// --- End Positron ---
		@IUriIdentityService private readonly _uriIdentityService: IUriIdentityService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostNotebookDocuments);
		this._modelReferenceCollection = new BoundModelReferenceCollection(this._uriIdentityService.extUri);

		// forward dirty and save events
		this._disposables.add(this._notebookEditorModelResolverService.onDidChangeDirty(model => this._proxy.$acceptDirtyStateChanged(model.resource, model.isDirty())));
		this._disposables.add(this._notebookEditorModelResolverService.onDidSaveNotebook(e => this._proxy.$acceptModelSaved(e)));

		// when a conflict is going to happen RELEASE references that are held by extensions
		this._disposables.add(_notebookEditorModelResolverService.onWillFailWithConflict(e => {
			this._modelReferenceCollection.remove(e.resource);
		}));
	}

	dispose(): void {
		this._disposables.dispose();
		this._modelReferenceCollection.dispose();
		dispose(this._documentEventListenersMapping.values());
	}

	handleNotebooksAdded(notebooks: readonly NotebookTextModel[]): void {

		for (const textModel of notebooks) {
			const disposableStore = new DisposableStore();
			disposableStore.add(textModel.onDidChangeContent(event => {

				const eventDto: NotebookCellsChangedEventDto = {
					versionId: event.versionId,
					rawEvents: []
				};

				for (const e of event.rawEvents) {

					switch (e.kind) {
						case NotebookCellsChangeType.ModelChange:
							eventDto.rawEvents.push({
								kind: e.kind,
								changes: e.changes.map(diff => [diff[0], diff[1], diff[2].map(cell => NotebookDto.toNotebookCellDto(cell))] as [number, number, NotebookCellDto[]])
							});
							break;
						case NotebookCellsChangeType.Move:
							eventDto.rawEvents.push({
								kind: e.kind,
								index: e.index,
								length: e.length,
								newIdx: e.newIdx,
							});
							break;
						case NotebookCellsChangeType.Output:
							eventDto.rawEvents.push({
								kind: e.kind,
								index: e.index,
								outputs: e.outputs.map(NotebookDto.toNotebookOutputDto)
							});
							break;
						case NotebookCellsChangeType.OutputItem:
							eventDto.rawEvents.push({
								kind: e.kind,
								index: e.index,
								outputId: e.outputId,
								outputItems: e.outputItems.map(NotebookDto.toNotebookOutputItemDto),
								append: e.append
							});
							break;
						case NotebookCellsChangeType.ChangeCellLanguage:
						case NotebookCellsChangeType.ChangeCellContent:
						case NotebookCellsChangeType.ChangeCellMetadata:
						case NotebookCellsChangeType.ChangeCellInternalMetadata:
							eventDto.rawEvents.push(e);
							break;
					}
				}

				const hasDocumentMetadataChangeEvent = event.rawEvents.find(e => e.kind === NotebookCellsChangeType.ChangeDocumentMetadata);

				// using the model resolver service to know if the model is dirty or not.
				// assuming this is the first listener it can mean that at first the model
				// is marked as dirty and that another event is fired
				this._proxy.$acceptModelChanged(
					textModel.uri,
					new SerializableObjectWithBuffers(eventDto),
					this._notebookEditorModelResolverService.isDirty(textModel.uri),
					hasDocumentMetadataChangeEvent ? textModel.metadata : undefined
				);
			}));

			this._documentEventListenersMapping.set(textModel.uri, disposableStore);
		}
	}

	handleNotebooksRemoved(uris: URI[]): void {
		for (const uri of uris) {
			this._documentEventListenersMapping.get(uri)?.dispose();
			this._documentEventListenersMapping.delete(uri);
		}
	}

	async $tryCreateNotebook(options: { viewType: string; content?: NotebookDataDto }): Promise<UriComponents> {
		// --- Start Positron ---
		// Hook for custom notebook creation (e.g. Positron)
		const customResult = await this._tryCreateCustomNotebook(options);
		if (customResult) {
			return customResult;
		}
		// --- End Positron ---
		if (options.content) {
			const ref = await this._notebookEditorModelResolverService.resolve({ untitledResource: undefined }, options.viewType);

			// untitled notebooks are disposed when they get saved. we should not hold a reference
			// to such a disposed notebook and therefore dispose the reference as well
			Event.once(ref.object.notebook.onWillDispose)(() => {
				ref.dispose();
			});

			// untitled notebooks with content are dirty by default
			this._proxy.$acceptDirtyStateChanged(ref.object.resource, true);

			// apply content changes... slightly HACKY -> this triggers a change event
			if (options.content) {
				const data = NotebookDto.fromNotebookDataDto(options.content);
				ref.object.notebook.reset(data.cells, data.metadata, ref.object.notebook.transientOptions);
			}
			return ref.object.notebook.uri;
		} else {
			// If we aren't adding content, we don't need to resolve the full editor model yet.
			// This will allow us to adjust settings when the editor is opened, e.g. scratchpad
			const notebook = await this._notebookEditorModelResolverService.createUntitledNotebookTextModel(options.viewType);
			return notebook.uri;
		}
	}
	// --- Start Positron ---
	protected async _tryCreateCustomNotebook(options: { viewType: string; content?: NotebookDataDto }): Promise<UriComponents | undefined> {
		const isJupyterViewType = options.viewType === 'jupyter-notebook' || options.viewType === 'interactive';

		if (isJupyterViewType && usingPositronNotebooks(this._configurationService)) {
			this._logService.trace('[Positron] Creating new notebook with Positron editor based on configuration');

			try {
				// Create the notebook model first (same as VS Code logic)
				const ref = await this._notebookEditorModelResolverService.resolve(
					{ untitledResource: undefined },
					options.viewType
				);

				// untitled notebooks are disposed when they get saved. we should not hold a reference
				// to such a disposed notebook and therefore dispose the reference as well
				Event.once(ref.object.notebook.onWillDispose)(() => {
					ref.dispose();
				});

				// Apply content if provided
				if (options.content) {
					const data = NotebookDto.fromNotebookDataDto(options.content);
					ref.object.notebook.reset(data.cells, data.metadata, ref.object.notebook.transientOptions);
				}

				const uri = ref.object.resource;

				// Get the preferred editor group
				const preferredGroup = this._editorGroupsService.activeGroup;

				// Create Positron notebook editor input
				const editorInput = PositronNotebookEditorInput.getOrCreate(
					this._instantiationService,
					uri,
					undefined,
				);

				// Open the editor
				await this._editorService.openEditor(editorInput, undefined, preferredGroup);

				// Mark as dirty since it's new
				await this._proxy.$acceptDirtyStateChanged(uri, true);

				return uri.toJSON();
			} catch (error) {
				// Log error and show warning to user
				this._logService.error('[Positron] Failed to create notebook with Positron editor:', error);
				this._notificationService.warn(
					`Failed to create notebook with Positron editor. Falling back to VS Code editor. Error: ${(error as Error).message}`
				);
				// Return undefined to fall back to VS Code logic
			}
		}

		// Default implementation does nothing - allows VS Code logic to proceed
		return undefined;
	}
	// --- End Positron ---

	async $tryOpenNotebook(uriComponents: UriComponents): Promise<URI> {
		const uri = URI.revive(uriComponents);
		const ref = await this._notebookEditorModelResolverService.resolve(uri, undefined);

		if (uriComponents.scheme === 'untitled') {
			// untitled notebooks are disposed when they get saved. we should not hold a reference
			// to such a disposed notebook and therefore dispose the reference as well
			ref.object.notebook.onWillDispose(() => {
				ref.dispose();
			});
		}

		// --- Start Positron ---
		// Hook for custom notebook opening (e.g. Positron)
		const customResult = await this._tryOpenCustomNotebook(uriComponents, ref);
		if (customResult) {
			return customResult;
		}
		// --- End Positron ---
		this._modelReferenceCollection.add(uri, ref);
		return uri;
	}
	// --- Start Positron ---
	protected async _tryOpenCustomNotebook(uriComponents: UriComponents, ref: any): Promise<URI | undefined> {
		const uri = URI.revive(uriComponents);
		const resourcePath = uri.path.toLowerCase();
		const isJupyterNotebook = resourcePath.endsWith('.ipynb');

		if (isJupyterNotebook && usingPositronNotebooks(this._configurationService)) {
			this._logService.trace('[Positron] Opening notebook with Positron editor based on editor association for:', uri.toString());

			try {
				// Get the preferred editor group
				const preferredGroup = this._editorGroupsService.activeGroup;

				// Create Positron notebook editor input
				const editorInput = PositronNotebookEditorInput.getOrCreate(
					this._instantiationService,
					uri,
					undefined,
					ref.object.viewType
				);

				// Open the editor
				await this._editorService.openEditor(editorInput, undefined, preferredGroup);

				// Handle untitled notebook case
				if (uri.scheme === 'untitled') {
					await this._proxy.$acceptDirtyStateChanged(uri, true);
				}

				// Add the reference to the collection
				this._modelReferenceCollection.add(uri, ref);

				return uri;
			} catch (error) {
				// Log error and show warning to user
				this._logService.error('[Positron] Failed to open notebook with Positron editor:', error);
				this._notificationService.warn(
					`Failed to open notebook with Positron editor. Falling back to VS Code editor. Error: ${(error as Error).message}`
				);
				// Return undefined to fall back to VS Code logic
			}
		}

		// Default implementation does nothing - allows VS Code logic to proceed
		return undefined;
	}
	// --- End Positron ---

	async $trySaveNotebook(uriComponents: UriComponents) {
		const uri = URI.revive(uriComponents);

		const ref = await this._notebookEditorModelResolverService.resolve(uri);
		const saveResult = await ref.object.save();
		ref.dispose();
		return saveResult;
	}
}
