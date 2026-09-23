/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { PositronReactRenderer } from '../../../../../base/browser/positronReactRenderer.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { DatabaseFileEditorInput } from './databaseFileEditorInput.js';
import { DatabaseFileEditorPage } from './databaseFileEditorPage.js';

/**
 * DatabaseFileEditor class.
 * The editor pane for a database file, which mounts the DatabaseFileEditorPage React component into
 * an editor tab.
 */
export class DatabaseFileEditor extends EditorPane {
	//#region Private Properties

	/**
	 * The container element the React component is rendered into.
	 */
	private readonly _container: HTMLElement;

	/**
	 * The React renderer for the current input, if an input is set.
	 */
	private _reactRenderer?: PositronReactRenderer;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param group The editor group this pane belongs to.
	 * @param storageService The storage service.
	 * @param telemetryService The telemetry service.
	 * @param themeService The theme service.
	 */
	constructor(
		group: IEditorGroup,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		// Call the base class's constructor.
		super(DatabaseFileEditorInput.EditorID, group, telemetryService, themeService, storageService);

		// Create the container. It is focusable, but out of the tab order, so that focusing the
		// editor lands on the page rather than nowhere, and the page's button is the first thing a
		// Tab press reaches.
		this._container = DOM.$('.database-file-editor-container');
		this._container.tabIndex = -1;
	}

	//#endregion Constructor

	//#region EditorPane Overrides

	/**
	 * Creates the editor.
	 * @param parent The parent element.
	 */
	protected override createEditor(parent: HTMLElement): void {
		parent.appendChild(this._container);
	}

	/**
	 * Sets the input.
	 * @param input The input.
	 * @param options The editor options.
	 * @param context The editor open context.
	 * @param token The cancellation token.
	 */
	override async setInput(
		input: DatabaseFileEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		// Render the page for the new input.
		this.disposeReactRenderer();
		this._reactRenderer = new PositronReactRenderer(this._container);
		this._reactRenderer.render(
			<DatabaseFileEditorPage
				driver={input.driver}
				resource={input.resource}
			/>
		);

		// Call the base class's method.
		await super.setInput(input, options, context, token);
	}

	/**
	 * Clears the input.
	 */
	override clearInput(): void {
		this.disposeReactRenderer();
		super.clearInput();
	}

	/**
	 * Focuses the editor. EditorPane inherits an empty focus() from Composite, so without this the
	 * focus the workbench hands the pane -- on opening the file, or on Focus Active Editor Group --
	 * would stay wherever it was, typically the Explorer tree, and Tab would never reach the page's
	 * button.
	 */
	override focus(): void {
		this._container.focus();
	}

	/**
	 * Lays out the editor.
	 * @param dimension The dimension.
	 */
	override layout(dimension: DOM.Dimension): void {
		DOM.size(this._container, dimension.width, dimension.height);
	}

	/**
	 * Disposes the editor.
	 */
	override dispose(): void {
		this.disposeReactRenderer();
		super.dispose();
	}

	//#endregion EditorPane Overrides

	//#region Private Methods

	/**
	 * Disposes the React renderer, unmounting the page.
	 */
	private disposeReactRenderer(): void {
		this._reactRenderer?.dispose();
		this._reactRenderer = undefined;
	}

	//#endregion Private Methods
}
