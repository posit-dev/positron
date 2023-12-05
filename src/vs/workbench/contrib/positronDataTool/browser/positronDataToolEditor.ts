/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./PositronDataToolEditor';
import * as DOM from 'vs/base/browser/dom';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';

/**
 * PositronDataToolEditor class.
 *
 *  * - `createEditor()`
 * - `setEditorVisible()`
 * - `layout()`
 * - `setInput()`
 * - `focus()`
 * - `dispose()`: when the editor group the editor is in closes

 */
export class PositronDataToolEditor extends EditorPane {
	//#region Static Properties

	/**
	 * Gets the identifier.
	 */
	static readonly ID: string = 'workbench.editor.positronDataTool';

	/**
	 * Gets the resource.
	 */
	static readonly RESOURCE = URI.from({ scheme: Schemas.positronDataTool, authority: 'pos' });

	//#endregion Static Properties

	//#region Private Properties

	private rootElement!: HTMLElement;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param storageService The storage service.
	 * @param telemetryService The telemetry service.
	 * @param themeService The theme service.
	 */
	constructor(
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		super(PositronDataToolEditor.ID, telemetryService, themeService, storageService);
	}

	//#endregion Constructor

	//#region Protected Overrides

	protected override createEditor(parent: HTMLElement): void {
		parent.setAttribute('tabindex', '-1');
		this.rootElement = DOM.append(parent, DOM.$('.positron-data-tool-editor', { tabindex: '-1' }));
		this.rootElement.setAttribute('class', 'position-data-tool-editor');

	}

	protected override setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
		super.setEditorVisible(visible, group);
	}

	//#endregion Protected Overrides

	//#region Protected Overrides

	override layout(dimension: DOM.Dimension, position?: DOM.IDomPosition | undefined): void {
	}
}
