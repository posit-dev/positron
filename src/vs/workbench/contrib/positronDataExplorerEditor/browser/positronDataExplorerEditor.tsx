/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronDataExplorerEditor';

// React.
import * as React from 'react';

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { Event, Emitter } from 'vs/base/common/event';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { PositronDataExplorer } from 'vs/workbench/browser/positronDataExplorer/positronDataExplorer';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { PositronDataExplorerUri } from 'vs/workbench/services/positronDataExplorer/common/positronDataExplorerUri';
import { IPositronDataExplorerService } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';
import { PositronDataExplorerEditorInput } from 'vs/workbench/contrib/positronDataExplorerEditor/browser/positronDataExplorerEditorInput';

/**
 * IPositronDataExplorerEditorOptions interface.
 */
export interface IPositronDataExplorerEditorOptions extends IEditorOptions {
}

/**
 * PositronDataExplorerEditor class.
 */
export class PositronDataExplorerEditor extends EditorPane implements IReactComponentContainer {
	//#region Private Properties

	/**
	 * Gets the container element.
	 */
	private readonly _positronDataExplorerContainer: HTMLElement;

	/**
	 * Gets or sets the PositronReactRenderer for the PositronDataExplorer component.
	 */
	private _positronReactRenderer?: PositronReactRenderer;

	/**
	 * Gets or sets the width. This value is set in layoutBody and is used to implement the
	 * IReactComponentContainer interface.
	 */
	private _width = 0;

	/**
	 * Gets or sets the height. This value is set in layoutBody and is used to implement the
	 * IReactComponentContainer interface.
	 */
	private _height = 0;

	/**
	 * Gets or sets the identifier.
	 */
	private _identifier?: string;

	/**
	 * The onSizeChanged event emitter.
	 */
	private readonly _onSizeChangedEmitter = this._register(new Emitter<ISize>());

	/**
	 * The onVisibilityChanged event emitter.
	 */
	private readonly _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());

	/**
	 * The onSaveScrollPosition event emitter.
	 */
	private readonly _onSaveScrollPositionEmitter = this._register(new Emitter<void>());

	/**
	 * The onRestoreScrollPosition event emitter.
	 */
	private readonly _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());

	/**
	 * The onFocused event emitter.
	 */
	private readonly _onFocusedEmitter = this._register(new Emitter<void>());

	//#endregion Private Properties

	//#region IReactComponentContainer

	/**
	 * Gets the width.
	 */
	get width() {
		return this._width;
	}

	/**
	 * Gets the height.
	 */
	get height() {
		return this._height;
	}

	/**
	 * Gets the container visibility.
	 */
	get containerVisible() {
		return this.isVisible();
	}

	/**
	 * Directs the React component container to take focus.
	 */
	takeFocus() {
		this.focus();
	}

	/**
	 * Notifies the React component container when focus changes.
	 */
	focusChanged(focused: boolean) {
	}

	/**
	 * The onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize> = this._onSizeChangedEmitter.event;

	/**
	 * The onVisibilityChanged event.
	 */
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChangedEmitter.event;

	/**
	 * The onSaveScrollPosition event.
	 */
	readonly onSaveScrollPosition: Event<void> = this._onSaveScrollPositionEmitter.event;

	/**
	 * The onRestoreScrollPosition event.
	 */
	readonly onRestoreScrollPosition: Event<void> = this._onRestoreScrollPositionEmitter.event;

	/**
	 * The onFocused event.
	 */
	readonly onFocused: Event<void> = this._onFocusedEmitter.event;

	//#endregion IReactComponentContainer

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _group The editor group.
	 * @param _clipboardService The clipboard service.
	 * @param _commandService The command service.
	 * @param _configurationService The configuration service.
	 * @param _contextKeyService The context key service.
	 * @param _contextMenuService The context menu service.
	 * @param _editorService The editor service.
	 * @param _keybindingService The keybinding service.
	 * @param _layoutService The layout service.
	 * @param _positronDataExplorerService The Positron data explorer service.
	 * @param storageService The storage service.
	 * @param telemetryService The telemetry service.
	 * @param themeService The theme service.
	 */
	constructor(
		readonly _group: IEditorGroup,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IEditorService private readonly _editorService: IEditorService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILayoutService private readonly _layoutService: ILayoutService,
		@IPositronDataExplorerService private readonly _positronDataExplorerService: IPositronDataExplorerService,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		// Call the base class's constructor.
		super(
			PositronDataExplorerEditorInput.EditorID,
			_group,
			telemetryService,
			themeService,
			storageService
		);

		// Create the Positron data explorer container.
		this._positronDataExplorerContainer = DOM.$('.positron-data-explorer-container');
		this._positronDataExplorerContainer.tabIndex = 0;

		// Create a focus tracker that updates the active Positron data explorer instance.
		const focusTracker = this._register(DOM.trackFocus(this._positronDataExplorerContainer));

		// Add the onDidFocus event handler.
		this._register(focusTracker.onDidFocus(() => {
			// If there is an identifier set, set the active Positron data explorer instance.
			if (this._identifier) {
				// Clear the active Positron data explorer instance.
				this._positronDataExplorerService.setActivePositronDataExplorerInstance(
					this._identifier
				);
			}
		}));

		// Add the onDidBlur event handler.
		this._register(focusTracker.onDidBlur(() => {
			// If there is an identifier set, clear the active Positron data explorer instance.
			if (this._identifier) {
				// Clear the active Positron data explorer instance.
				this._positronDataExplorerService.clearActivePositronDataExplorerInstance(
					this._identifier
				);
			}
		}));
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Dispose the PositronReactRenderer for the PositronDataExplorer.
		this.disposePositronReactRenderer();

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region EditorPane Overrides

	/**
	 * Creates the editor.
	 * @param parent The parent HTML element.
	 */
	protected override createEditor(parent: HTMLElement): void {
		// Append the Positron data explorer container.
		parent.appendChild(this._positronDataExplorerContainer);
	}

	/**
	 * Sets the editor input.
	 * @param input The Positron data explorer editor input.
	 * @param options The Positron data explorer editor options.
	 * @param context The editor open context.
	 * @param token The cancellation token.
	 */
	override async setInput(
		input: PositronDataExplorerEditorInput,
		options: IPositronDataExplorerEditorOptions,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		// Parse the Positron data explorer URI and set the identifier.
		this._identifier = PositronDataExplorerUri.parse(input.resource);

		// Render the component, if necessary.
		if (this._identifier && !this._positronReactRenderer) {
			// Get the Positron data explorer instance.
			const positronDataExplorerInstance = this._positronDataExplorerService.getInstance(
				this._identifier
			);

			// If the Positron data explorer instance was found, render the Positron data explorer.
			if (positronDataExplorerInstance) {
				// Create the PositronReactRenderer for the PositronDataExplorer component and render it.
				this._positronReactRenderer = new PositronReactRenderer(this._positronDataExplorerContainer);
				this._positronReactRenderer.render(
					<PositronDataExplorer
						clipboardService={this._clipboardService}
						commandService={this._commandService}
						configurationService={this._configurationService}
						contextKeyService={this._contextKeyService}
						contextMenuService={this._contextMenuService}
						keybindingService={this._keybindingService}
						layoutService={this._layoutService}
						instance={positronDataExplorerInstance}
						onClose={() => this._group.closeEditor(this.input)}
					/>
				);

				// Add event handlers.
				this._register(positronDataExplorerInstance.onDidRequestFocus(() => {
					this._editorService.openEditor(input);
				}));

				// Hack -- this is usually set by setInput but we're setting it temporarily to be
				// able to edit the editor tab name
				this._input = input;

				// Success.
				return;
			}
		}

		// Call the base class's method.
		await super.setInput(input, options, context, token);
	}

	/**
	 * Clears the input.
	 */
	override clearInput(): void {
		// Dispose the PositronReactRenderer.
		this.disposePositronReactRenderer();

		// Clear the active Positron data explorer instance.
		if (this._identifier) {
			// Clear the active Positron data explorer instance.
			this._positronDataExplorerService.clearActivePositronDataExplorerInstance(
				this._identifier
			);

			// Clear the identifier.
			this._identifier = undefined;
		}

		// Call the base class's method.
		super.clearInput();
	}

	/**
	 * Sets editor visibility.
	 * @param visible A value which indicates whether the editor should be visible.
	 */
	protected override setEditorVisible(visible: boolean): void {
		// Call the base class's method.
		super.setEditorVisible(visible);
	}

	//#endregion EditorPane Overrides

	//#region Composite Overrides

	/**
	 * Called when this composite should receive keyboard focus.
	 */
	override focus(): void {
		// Call the base class's method.
		super.focus();

		// Set the active Positron data explorer instance.
		if (this._identifier) {
			// Set the active Positron data explorer instance.
			this._positronDataExplorerService.setActivePositronDataExplorerInstance(
				this._identifier
			);

			// Drive focus into the Positron data explorer instance.
			this._positronDataExplorerContainer?.focus();
		}
	}

	/**
	 * Lays out the editor.
	 * @param dimension The layout dimension.
	 */
	override layout(dimension: DOM.Dimension): void {
		// Size the container.
		DOM.size(this._positronDataExplorerContainer, dimension.width, dimension.height);

		// Save the width and height.
		this._width = dimension.width;
		this._height = dimension.height;

		// Fire the _onSizeChanged event.
		this._onSizeChangedEmitter.fire({
			width: this._width,
			height: this._height
		});
	}

	//#endregion Composite Overrides

	//#region Private Methods

	/**
	 * Disposes of the PositronReactRenderer for the PositronDataExplorer.
	 */
	private disposePositronReactRenderer() {
		// If the PositronReactRenderer for the PositronDataExplorer is exists, dispose it. This
		// removes the PositronDataExplorer from the DOM.
		if (this._positronReactRenderer) {
			// Dispose of the PositronReactRenderer for the PositronDataExplorer.
			this._positronReactRenderer.dispose();
			this._positronReactRenderer = undefined;
		}
	}

	//#endregion Private Methods
}
