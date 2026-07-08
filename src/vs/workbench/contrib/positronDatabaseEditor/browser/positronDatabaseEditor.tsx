/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronDatabaseEditor.css';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IReactComponentContainer, ISize, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { PositronDatabaseEditorInput } from './positronDatabaseEditorInput.js';
import { PositronDatabaseEditorComponent } from './positronDatabaseEditorComponent.js';

/**
 * PositronDatabaseEditor. Hosts the database editor's React split view (schema tree + Data
 * Explorer) for a PositronDatabaseEditorInput. Implements IReactComponentContainer so the child
 * React components can react to size/visibility changes from the editor pane.
 */
export class PositronDatabaseEditor extends EditorPane implements IReactComponentContainer {
	//#region Private Properties

	private readonly _container: HTMLElement;
	private _reactRenderer?: PositronReactRenderer;
	private _width = 0;
	private _height = 0;

	private readonly _onSizeChangedEmitter = this._register(new Emitter<ISize>());
	private readonly _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());
	private readonly _onSaveScrollPositionEmitter = this._register(new Emitter<void>());
	private readonly _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());
	private readonly _onFocusedEmitter = this._register(new Emitter<void>());

	//#endregion Private Properties

	//#region IReactComponentContainer

	get width() {
		return this._width;
	}

	get height() {
		return this._height;
	}

	get containerVisible() {
		return this.isVisible();
	}

	takeFocus() {
		this.focus();
	}

	readonly onSizeChanged: Event<ISize> = this._onSizeChangedEmitter.event;
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChangedEmitter.event;
	readonly onSaveScrollPosition: Event<void> = this._onSaveScrollPositionEmitter.event;
	readonly onRestoreScrollPosition: Event<void> = this._onRestoreScrollPositionEmitter.event;
	readonly onFocused: Event<void> = this._onFocusedEmitter.event;

	//#endregion IReactComponentContainer

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param group The editor group.
	 */
	constructor(
		readonly _group: IEditorGroup,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		super(
			PositronDatabaseEditorInput.EditorID,
			_group,
			telemetryService,
			themeService,
			storageService
		);

		this._container = DOM.$('.positron-database-editor-container');
	}

	override dispose(): void {
		this._disposeReactRenderer();
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region EditorPane Overrides

	protected override createEditor(parent: HTMLElement): void {
		parent.appendChild(this._container);
	}

	override async setInput(
		input: PositronDatabaseEditorInput,
		options: IEditorOptions,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		// Establish the connection before rendering the split view.
		try {
			const instance = await input.resolveConnection();

			// Bail if the editor was disposed or the open was cancelled while connecting.
			if (token.isCancellationRequested || this._store.isDisposed) {
				return;
			}

			this._disposeReactRenderer();
			this._reactRenderer = new PositronReactRenderer(this._container);
			this._reactRenderer.render(<PositronDatabaseEditorComponent instance={instance} />);
		} catch (error) {
			if (token.isCancellationRequested || this._store.isDisposed) {
				return;
			}
			this._disposeReactRenderer();
			this._reactRenderer = new PositronReactRenderer(this._container);
			this._reactRenderer.render(
				<div className='positron-database-editor-error'>
					{error instanceof Error ? error.message : String(error)}
				</div>
			);
		}

		await super.setInput(input, options, context, token);
	}

	override clearInput(): void {
		this._disposeReactRenderer();
		super.clearInput();
	}

	override layout(dimension: DOM.Dimension): void {
		DOM.size(this._container, dimension.width, dimension.height);
		this._width = dimension.width;
		this._height = dimension.height;
		this._onSizeChangedEmitter.fire({ width: this._width, height: this._height });
	}

	override focus(): void {
		super.focus();
		this._container?.focus();
	}

	//#endregion EditorPane Overrides

	//#region Private Methods

	private _disposeReactRenderer(): void {
		if (this._reactRenderer) {
			this._reactRenderer.dispose();
			this._reactRenderer = undefined;
		}
	}

	//#endregion Private Methods
}
