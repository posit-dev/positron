/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/editortitlecontrol.css';
import { Dimension, clearNode } from '../../../../base/browser/dom.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IThemeService, Themable } from '../../../../platform/theme/common/themeService.js';
import { BreadcrumbsControl, BreadcrumbsControlFactory } from './breadcrumbsControl.js';
import { IEditorGroupsView, IEditorGroupTitleHeight, IEditorGroupView, IEditorPartsView, IInternalEditorOpenOptions } from './editor.js';
import { IEditorTabsControl } from './editorTabsControl.js';
import { MultiEditorTabsControl } from './multiEditorTabsControl.js';
import { SingleEditorTabsControl } from './singleEditorTabsControl.js';
import { IEditorPartOptions } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { MultiRowEditorControl } from './multiRowEditorTabsControl.js';
import { IReadonlyEditorGroupModel } from '../../../common/editor/editorGroupModel.js';
import { NoEditorTabsControl } from './noEditorTabsControl.js';
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

	private breadcrumbsControlFactory: BreadcrumbsControlFactory | undefined;
	private readonly breadcrumbsControlDisposables = this._register(new DisposableStore());
	private get breadcrumbsControl() { return this.breadcrumbsControlFactory?.control; }

	constructor(
		private readonly parent: HTMLElement,
		private readonly editorPartsView: IEditorPartsView,
		private readonly groupsView: IEditorGroupsView,
		private readonly groupView: IEditorGroupView,
		private readonly model: IReadonlyEditorGroupModel,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService
	) {
		super(themeService);

		this.editorTabsControl = this.createEditorTabsControl();
		// --- Start Positron ---
		this.editorActionBarControlFactory = this.createEditorActionBarControlFactory();
		// --- End Positron ---
		this.breadcrumbsControlFactory = this.createBreadcrumbsControl();
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

		const control = this.instantiationService.createInstance(tabsControlType, this.parent, this.editorPartsView, this.groupsView, this.groupView, this.model);
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

	private createBreadcrumbsControl(): BreadcrumbsControlFactory | undefined {
		if (this.groupsView.partOptions.showTabs === 'single') {
			return undefined; // Single tabs have breadcrumbs inlined. No tabs have no breadcrumbs.
		}

		// Breadcrumbs container
		const breadcrumbsContainer = document.createElement('div');
		breadcrumbsContainer.classList.add('breadcrumbs-below-tabs');
		this.parent.appendChild(breadcrumbsContainer);

		const breadcrumbsControlFactory = this.breadcrumbsControlDisposables.add(this.instantiationService.createInstance(BreadcrumbsControlFactory, breadcrumbsContainer, this.groupView, {
			showFileIcons: true,
			showSymbolIcons: true,
			showDecorationColors: false,
			showPlaceholder: true,
			dragEditor: false,
		}));

		// Breadcrumbs enablement & visibility change have an impact on layout
		// so we need to relayout the editor group when that happens.
		this.breadcrumbsControlDisposables.add(breadcrumbsControlFactory.onDidEnablementChange(() => this.groupView.relayout()));
		this.breadcrumbsControlDisposables.add(breadcrumbsControlFactory.onDidVisibilityChange(() => this.groupView.relayout()));

		return breadcrumbsControlFactory;
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
		if (didChange) {
			// --- Start Positron ---
			this.editorActionBarControl?.update();
			// --- End Positron ---
			this.breadcrumbsControl?.update();
		} else {
			this.breadcrumbsControl?.revealLast();
		}
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
			this.breadcrumbsControl?.update();
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
		return this.editorTabsControl.updateEditorLabel(editor);
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
			this.breadcrumbsControlDisposables.clear();
			clearNode(this.parent);

			// Create new
			this.editorTabsControl = this.createEditorTabsControl();
			// --- Start Positron ---
			this.editorActionBarControlFactory = this.createEditorActionBarControlFactory();
			// --- End Positron ---
			this.breadcrumbsControlFactory = this.createBreadcrumbsControl();
		}

		// Forward into editor tabs control
		else {
			this.editorTabsControl.updateOptions(oldOptions, newOptions);
		}
	}

	layout(dimensions: IEditorTitleControlDimensions): Dimension {

		// Layout tabs control
		const tabsControlDimension = this.editorTabsControl.layout(dimensions);

		// --- Start Positron ---
		// Get the editor action bar height.
		const editorActionBarHeight = this.editorActionBarControlFactory?.control?.height ?? 0;
		// --- End Positron ---

		// Layout breadcrumbs if visible
		let breadcrumbsControlDimension: Dimension | undefined = undefined;
		if (this.breadcrumbsControl?.isHidden() === false) {
			breadcrumbsControlDimension = new Dimension(dimensions.container.width, BreadcrumbsControl.HEIGHT);
			this.breadcrumbsControl.layout(breadcrumbsControlDimension);
		}

		// --- Start Positron ---
		return new Dimension(
			dimensions.container.width,
			// --- Start Positron ---
			// Add the action bar height.
			tabsControlDimension.height +
			editorActionBarHeight +
			(breadcrumbsControlDimension ? breadcrumbsControlDimension.height : 0)
			// --- End Positron ---
		);
		// --- End Positron ---
	}

	getHeight(): IEditorGroupTitleHeight {
		const tabsControlHeight = this.editorTabsControl.getHeight();
		// --- Start Positron ---
		// Get the editor action bar height.
		const editorActionBarHeight = this.editorActionBarControlFactory?.control?.height ?? 0;
		// --- End Positron ---
		const breadcrumbsControlHeight = this.breadcrumbsControl?.isHidden() === false ? BreadcrumbsControl.HEIGHT : 0;

		return {
			// --- Start Positron ---
			// Add the action bar height.
			total: tabsControlHeight + editorActionBarHeight + breadcrumbsControlHeight,
			// --- End Positron ---
			offset: tabsControlHeight
		};
	}
}
