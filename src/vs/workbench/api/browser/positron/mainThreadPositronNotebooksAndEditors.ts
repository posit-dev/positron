/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { diffMaps } from '../../../../base/common/collections.js';
import { DisposableMap, Disposable, combinedDisposable } from '../../../../base/common/lifecycle.js';
import { extHostCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { EditorGroupColumn, editorGroupToColumn } from '../../../services/editor/common/editorGroupColumn.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ExtHostContext, ExtHostNotebookShape, INotebookDocumentsAndEditorsDelta, INotebookEditorAddData } from '../../common/extHost.protocol.js';
import { SerializableObjectWithBuffers } from '../../../services/extensions/common/proxyIdentifier.js';
import { IPositronNotebookService } from '../../../contrib/positronNotebook/browser/positronNotebookService.js';
import { IPositronNotebookInstance } from '../../../contrib/positronNotebook/browser/IPositronNotebookInstance.js';
import { MainThreadPositronNotebookInstance, MainThreadPositronNotebookEditors, IMainThreadPositronNotebookInstanceLocator } from './mainThreadPositronNotebookEditors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { MainPositronContext } from '../../common/positron/extHost.positron.protocol.js';
import { autorun } from '../../../../base/common/observable.js';
import { getNotebookInstanceFromEditorPane } from '../../../contrib/positronNotebook/browser/PositronNotebookEditor.js';

/**
 * This module implements an alternative of MainThreadNotebooksAndEditors for IPositronNotebookInstance
 * instead of INotebookEditor. It connects Positron notebooks to the extension API without
 * having to implement the INotebookEditor interface.
 */

//#region MainThreadPositronNotebookInstancesStateComputer
/**
 * State of Positron notebook instances.
 */
class PositronNotebookInstanceState {
	static delta(before: PositronNotebookInstanceState | undefined, after: PositronNotebookInstanceState): PositronNotebookInstanceStateDelta {
		if (!before) {
			return new PositronNotebookInstanceStateDelta(
				[], [...after.instances.values()],
				[...after.visibleInstances.values()],
			);
		}
		const instanceDelta = diffMaps(before.instances, after.instances);
		const newActiveInstance = before.activeInstanceId !== after.activeInstanceId ? after.activeInstanceId : undefined;
		const visibleInstanceDelta = diffMaps(before.visibleInstances, after.visibleInstances);
		const visibleInstances = visibleInstanceDelta.added.length === 0 && visibleInstanceDelta.removed.length === 0
			? undefined
			: [...after.visibleInstances.values()];
		return new PositronNotebookInstanceStateDelta(
			instanceDelta.removed,
			instanceDelta.added,
			visibleInstances,
			newActiveInstance,
		);
	}

	constructor(
		readonly instances: Map<string, IPositronNotebookInstance>,
		readonly activeInstanceId: string | undefined,
		readonly visibleInstances: Map<string, IPositronNotebookInstance>
	) { }
}

/**
 * Delta of changes between two Positron notebook instance states.
 */
class PositronNotebookInstanceStateDelta {
	readonly isEmpty: boolean;

	constructor(
		readonly removedInstances: IPositronNotebookInstance[],
		readonly addedInstances: IPositronNotebookInstance[],
		readonly visibleInstances: IPositronNotebookInstance[] | undefined,
		readonly newActiveInstanceId?: string | null,
	) {
		this.isEmpty = addedInstances.length === 0 &&
			removedInstances.length === 0 &&
			(visibleInstances === undefined || visibleInstances.length === 0) &&
			newActiveInstanceId === undefined;
	}
}

/**
 * Calls the provided hook when Positron notebook instance state changes.
 */
class MainThreadPositronNotebookInstancesStateComputer extends Disposable {
	/** Notebook instance listeners keyed by instance ID */
	private readonly _instanceListeners = this._register(new DisposableMap<string>());

	/** Current Positron notebook instance state */
	private _currentState?: PositronNotebookInstanceState;

	constructor(
		private readonly _onDidChangeState: (delta: PositronNotebookInstanceStateDelta) => void,
		@IPositronNotebookService private readonly _positronNotebookService: IPositronNotebookService,
		@IEditorService private readonly _editorService: IEditorService,
	) {
		super();

		// Monitor active editor changes
		this._register(this._editorService.onDidActiveEditorChange(this._updateState, this));
		this._register(this._editorService.onDidVisibleEditorsChange(this._updateState, this));

		// Monitor notebook instance changes
		this._register(this._positronNotebookService.onDidAddNotebookInstance(this._onDidAddNotebookInstance, this));
		this._register(this._positronNotebookService.onDidRemoveNotebookInstance(this._onDidRemoveNotebookInstance, this));
		this._positronNotebookService.listInstances().forEach(this._onDidAddNotebookInstance, this);

		// Initial state sync
		this._updateState();
	}

	private _onDidAddNotebookInstance(instance: IPositronNotebookInstance): void {
		this._instanceListeners.set(instance.id, combinedDisposable(
			// Update state when the notebook text model changes
			// Seems to fire when the notebook editor becomes visible and active
			autorun(reader => {
				instance.textModel.read(reader);
				this._updateState();
			}),
			// TODO: Update state when notebook is focused
			// instance.onDidFocusWidget(() => this._updateState(instance)),
		));
		this._updateState();
	}

	private _onDidRemoveNotebookInstance(instance: IPositronNotebookInstance): void {
		if (this._instanceListeners.has(instance.id)) {
			this._instanceListeners.deleteAndDispose(instance.id);
			this._updateState();
		}
	}

	private _updateState(): void {
		// Get all Positron notebook instances
		const instances = new Map<string, IPositronNotebookInstance>();
		for (const instance of this._positronNotebookService.listInstances()) {
			if (instance.textModel) {
				instances.set(instance.id, instance);
			}
		}

		// Check which instances are visible
		const visibleInstances = new Map<string, IPositronNotebookInstance>();
		for (const editorPane of this._editorService.visibleEditorPanes) {
			const instance = getNotebookInstanceFromEditorPane(editorPane);
			if (instance && instances.has(instance.id)) {
				visibleInstances.set(instance.id, instance);
			}
		}

		// Determine active instance
		let activeInstanceId: string | undefined;
		const candidate = getNotebookInstanceFromEditorPane(this._editorService.activeEditorPane);
		if (candidate) {
			for (const instance of instances.values()) {
				if (candidate === instance) {
					activeInstanceId = instance.id;
				}
			}
		}

		// Compute state delta and notify if changed
		const newState = new PositronNotebookInstanceState(instances, activeInstanceId, visibleInstances);
		const delta = PositronNotebookInstanceState.delta(this._currentState, newState);
		if (!delta.isEmpty) {
			this._currentState = newState;
			this._onDidChangeState(delta);
		}
	}
}
//#endregion MainThreadPositronNotebookInstancesStateComputer

//#region MainThreadPositronNotebooksAndEditors
@extHostCustomer
export class MainThreadPositronNotebooksAndEditors extends Disposable implements IMainThreadPositronNotebookInstanceLocator {
	/** Extension host component that receives notebook instance state deltas */
	private readonly _proxy: ExtHostNotebookShape;

	/** Main thread component called by extension-host-side notebook editors */
	private readonly _mainThreadEditors: MainThreadPositronNotebookEditors;

	/** Map of all active notebook instances keyed by instance ID */
	private readonly _instances = this._register(new DisposableMap<string, MainThreadPositronNotebookInstance>());

	constructor(
		extHostContext: IExtHostContext,
		@IInstantiationService instantiationService: IInstantiationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IEditorGroupsService private readonly _editorGroupService: IEditorGroupsService,
	) {
		super();

		// Create the main thread editors component
		// and register it with the ext host context
		this._mainThreadEditors = this._register(instantiationService.createInstance(
			MainThreadPositronNotebookEditors, this, extHostContext
		));
		extHostContext.set(MainPositronContext.MainThreadPositronNotebookEditors, this._mainThreadEditors);

		// Get the extension host proxy
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostNotebook);

		// Create the notebook instance state computer;
		// it will call us back with state changes
		this._register(instantiationService.createInstance(
			MainThreadPositronNotebookInstancesStateComputer, (delta) => this._onDelta(delta)
		));
	}

	//#region IMainThreadPositronNotebookInstanceLocator
	getInstance(id: string): MainThreadPositronNotebookInstance | undefined {
		return this._instances.get(id);
	}
	//#endregion IMainThreadPositronNotebookInstanceLocator

	//#region State change
	private _onDelta(delta: PositronNotebookInstanceStateDelta): void {
		const addedEditors: MainThreadPositronNotebookInstance[] = [];
		for (const instance of delta.addedInstances) {
			const editor = new MainThreadPositronNotebookInstance(instance);
			this._instances.set(instance.id, editor);
			addedEditors.push(editor);
		}

		const removedEditors: string[] = [];
		for (const instance of delta.removedInstances) {
			this._instances.deleteAndDispose(instance.id);
			removedEditors.push(instance.id);
		}

		// First, update extension host
		const extHostDelta: INotebookDocumentsAndEditorsDelta = {
			removedEditors: delta.removedInstances.map(instance => instance.id),
			newActiveEditor: delta.newActiveInstanceId,
			visibleEditors: delta.visibleInstances?.map(instance => instance.id),
			addedEditors: addedEditors.map(this._toNotebookEditorAddData, this),
		};
		this._proxy.$acceptDocumentAndEditorsDelta(new SerializableObjectWithBuffers(extHostDelta));

		// Second, update main thread state
		removedEditors.forEach(this._mainThreadEditors.handleNotebookInstanceRemoved, this._mainThreadEditors);
		addedEditors.forEach(this._mainThreadEditors.handleNotebookInstanceAdded, this._mainThreadEditors);
	}

	private _toNotebookEditorAddData(instance: MainThreadPositronNotebookInstance): INotebookEditorAddData {
		return {
			id: instance.getId(),
			documentUri: instance.getDocumentUri(),
			selections: instance.getSelections(),
			visibleRanges: instance.getVisibleRanges(),
			viewColumn: this._findViewColumn(instance),
			viewType: instance.getViewType(),
			isPositron: true,
		};
	}

	private _findViewColumn(instance: MainThreadPositronNotebookInstance): EditorGroupColumn | undefined {
		for (const editorPane of this._editorService.visibleEditorPanes) {
			if (instance.matches(editorPane)) {
				return editorGroupToColumn(this._editorGroupService, editorPane.group);
			}
		}
		return undefined;
	}
	//#endregion State change
}
//#endregion MainThreadPositronNotebooksAndEditors
