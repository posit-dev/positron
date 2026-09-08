/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/editortitlecontrol.css';
import { Dimension, clearNode } from '../../../../base/browser/dom.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IThemeService, Themable } from '../../../../platform/theme/common/themeService.js';
import { IEditorGroupMenuIds, IEditorGroupsView, IEditorGroupTitleHeight, IEditorGroupView, IEditorPartsView, IInternalEditorOpenOptions } from './editor.js';
import { IEditorTabsControl } from './editorTabsControl.js';
import { MultiEditorTabsControl } from './multiEditorTabsControl.js';
import { SingleEditorTabsControl } from './singleEditorTabsControl.js';
import { IEditorPartOptions } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { MultiRowEditorControl } from './multiRowEditorTabsControl.js';
import { IReadonlyEditorGroupModel } from '../../../common/editor/editorGroupModel.js';
import { NoEditorTabsControl } from './noEditorTabsControl.js';
import { EditorHeaderControl } from './editorHeaderControl.js';
// --- Start Positron ---
import { EditorActionBarControlFactory } from './editorActionBarControl.js';
// --- End Positron ---

export interface IEditorTitleControlDimensions {

	/**
	 * The size of the parent container the title control is layed out in.
	 */
	readonly container: Dimension;

	/**
	 * The maximum size the title control is allowed to consume based on
	 * other controls that are positioned inside the container.
	 */
	readonly available: Dimension;
}

export class EditorTitleControl extends Themable {

	private editorTabsControl: IEditorTabsControl;
	private readonly editorTabsControlDisposable = this._register(new DisposableStore());

	// --- Start Positron ---
	private editorActionBarControlFactory: EditorActionBarControlFactory | undefined;
	private readonly editorActionBarControlDisposable = this._register(new DisposableStore());
	private get editorActionBarControl() { return this.editorActionBarControlFactory?.control; }
	// --- End Positron ---

	private headerControl: EditorHeaderControl;
	private readonly headerControlDisposable = this._register(new MutableDisposable<EditorHeaderControl>());

	constructor(
		private readonly parent: HTMLElement,
		private readonly editorPartsView: IEditorPartsView,
		private readonly groupsView: IEditorGroupsView,
		private readonly groupView: IEditorGroupView,
		private readonly model: IReadonlyEditorGroupModel,
		private readonly menuIds: IEditorGroupMenuIds | undefined,
		private readonly showHeader: boolean,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService
	) {
		super(themeService);

		this.editorTabsControl = this.createEditorTabsControl();
		// --- Start Positron ---
		this.editorActionBarControlFactory = this.createEditorActionBarControlFactory();
		// --- End Positron ---
		this.headerControl = this.createHeaderControl();
	}

	private createEditorTabsControl(): IEditorTabsControl {
		let tabsControlType;
		switch (this.groupsView.partOptions.showTabs) {
			case 'none':
				tabsControlType = NoEditorTabsControl;
				break;
			case 'single':
				tabsControlType = SingleEditorTabsControl;
				break;
			case 'multiple':
			default:
				tabsControlType = this.groupsView.partOptions.pinnedTabsOnSeparateRow ? MultiRowEditorControl : MultiEditorTabsControl;
				break;
		}

		const control = this.instantiationService.createInstance(tabsControlType, this.parent, this.editorPartsView, this.groupsView, this.groupView, this.model, this.menuIds, this.showHeader);
		return this.editorTabsControlDisposable.add(control);
	}

	// --- Start Positron ---
	/**
	 * Creates the editor action bar control factory.
	 * @returns The editor action bar control factory.
	 */
	private createEditorActionBarControlFactory(): EditorActionBarControlFactory | undefined {
		// The editor action bar control factory is created when there are multiple tabs. Return if
		// showTabs is not set to multiple.
		if (this.groupsView.partOptions.showTabs !== 'multiple') {
			return undefined;
		}

		// Create and add the editor action bar control container.
		const editorActionBarControlContainer = document.createElement('div');
		this.parent.appendChild(editorActionBarControlContainer);

		// Create the editor action bar control factory.
		const editorActionBarControlFactory = this.editorActionBarControlDisposable.add(
			this.instantiationService.createInstance(
				EditorActionBarControlFactory,
				editorActionBarControlContainer,
				this.groupView
			)
		);

		// Add the onDidEnablementChange event handler.
		this.editorActionBarControlDisposable.add(
			editorActionBarControlFactory.onDidEnablementChange(() =>
				this.groupView.relayout()
			)
		);

		// Return the editor action bar control factory.
		return editorActionBarControlFactory;
	}
	// --- End Positron ---

	private createHeaderControl(): EditorHeaderControl {
		const control = this.instantiationService.createInstance(EditorHeaderControl, this.parent, this.groupView, this.groupsView, this.menuIds, this.showHeader);
		this.headerControlDisposable.value = control;
		return control;
	}

	openEditor(editor: EditorInput, options?: IInternalEditorOpenOptions): void {
		const didChange = this.editorTabsControl.openEditor(editor, options);

		this.handleOpenedEditors(didChange);
	}

	openEditors(editors: EditorInput[]): void {
		const didChange = this.editorTabsControl.openEditors(editors);

		this.handleOpenedEditors(didChange);
	}

	private handleOpenedEditors(didChange: boolean): void {
		// --- Start Positron ---
		this.editorActionBarControl?.update();
		// --- End Positron ---
		this.headerControl.handleEditorsChange(didChange);
	}

	beforeCloseEditor(editor: EditorInput): void {
		return this.editorTabsControl.beforeCloseEditor(editor);
	}

	closeEditor(editor: EditorInput): void {
		this.editorTabsControl.closeEditor(editor);

		this.handleClosedEditors();
	}

	closeEditors(editors: EditorInput[]): void {
		this.editorTabsControl.closeEditors(editors);

		this.handleClosedEditors();
	}

	private handleClosedEditors(): void {
		if (!this.groupView.activeEditor) {
			// --- Start Positron ---
			this.editorActionBarControl?.update();
			// --- End Positron ---
			this.headerControl.handleEditorsChange(true);
		}
	}

	moveEditor(editor: EditorInput, fromIndex: number, targetIndex: number, stickyStateChange: boolean): void {
		return this.editorTabsControl.moveEditor(editor, fromIndex, targetIndex, stickyStateChange);
	}

	pinEditor(editor: EditorInput): void {
		return this.editorTabsControl.pinEditor(editor);
	}

	stickEditor(editor: EditorInput): void {
		return this.editorTabsControl.stickEditor(editor);
	}

	unstickEditor(editor: EditorInput): void {
		return this.editorTabsControl.unstickEditor(editor);
	}

	setActive(isActive: boolean): void {
		return this.editorTabsControl.setActive(isActive);
	}

	updateEditorSelections(): void {
		this.editorTabsControl.updateEditorSelections();
	}

	updateEditorLabel(editor: EditorInput): void {
		this.editorTabsControl.updateEditorLabel(editor);
		if (this.groupView.activeEditor === editor) {
			// An active input may change its effective resource without being reopened.
			this.headerControl.handleEditorsChange(true);
		}
	}

	updateEditorCapabilities(editor: EditorInput): void {
		this.editorTabsControl.updateEditorCapabilities(editor);
	}

	updateEditorDirty(editor: EditorInput): void {
		return this.editorTabsControl.updateEditorDirty(editor);
	}

	updateOptions(oldOptions: IEditorPartOptions, newOptions: IEditorPartOptions): void {

		// Update editor tabs control if options changed
		if (
			oldOptions.showTabs !== newOptions.showTabs ||
			(newOptions.showTabs !== 'single' && oldOptions.pinnedTabsOnSeparateRow !== newOptions.pinnedTabsOnSeparateRow)
		) {
			// Clear old
			this.editorTabsControlDisposable.clear();
			// --- Start Positron ---
			this.editorActionBarControlDisposable.clear();
			// --- End Positron ---
			this.headerControlDisposable.clear();
			clearNode(this.parent);

			// Create new
			this.editorTabsControl = this.createEditorTabsControl();
			// --- Start Positron ---
			this.editorActionBarControlFactory = this.createEditorActionBarControlFactory();
			// --- End Positron ---
			this.headerControl = this.createHeaderControl();
		}

		// Forward into editor tabs control
		else {
			this.editorTabsControl.updateOptions(oldOptions, newOptions);
		}
	}

	layout(dimensions: IEditorTitleControlDimensions): Dimension {

		// Layout tabs control
		this.editorTabsControl.layout(dimensions);

		this.headerControl.layout(dimensions.container.width);

		return new Dimension(dimensions.container.width, this.getHeight().total);
	}

	getHeight(): IEditorGroupTitleHeight {
		const tabsControlHeight = this.editorTabsControl.getHeight();
		// --- Start Positron ---
		// Get the editor action bar height.
		const editorActionBarHeight = this.editorActionBarControlFactory?.control?.height ?? 0;
		// --- End Positron ---

		return {
			// --- Start Positron ---
			// Add the action bar height.
			total: tabsControlHeight + editorActionBarHeight + this.headerControl.height,
			// --- End Positron ---
			offset: tabsControlHeight
		};
	}
}
