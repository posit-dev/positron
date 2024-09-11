/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronDataExplorerEditor';

// React.
import * as React from 'react';

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { Event, Emitter } from 'vs/base/common/event';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { CancellationToken } from 'vs/base/common/cancellation';
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
import { EditorActivation, IEditorOptions } from 'vs/platform/editor/common/editor';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { PositronDataExplorer } from 'vs/workbench/browser/positronDataExplorer/positronDataExplorer';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { PositronDataExplorerUri } from 'vs/workbench/services/positronDataExplorer/common/positronDataExplorerUri';
import { IPositronDataExplorerService } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';
import { PositronDataExplorerEditorInput } from 'vs/workbench/contrib/positronDataExplorerEditor/browser/positronDataExplorerEditorInput';
import { PositronDataExplorerClosed } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerClosed/positronDataExplorerClosed';

/**
 * IPositronDataExplorerEditorOptions interface.
 */
export interface IPositronDataExplorerEditorOptions extends IEditorOptions {
}

/**
 * IPositronDataExplorerEditor interface.
 */
export interface IPositronDataExplorerEditor {
	/**
	 * Gets the identifier.
	 */
	get identifier(): string | undefined;
}

/**
 * PositronDataExplorerEditor class.
 */
export class PositronDataExplorerEditor extends EditorPane implements IPositronDataExplorerEditor, IReactComponentContainer {
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

	//#region IPositronDataExplorerEditor

	/**
	 * Gets the identifier.
	 */
	get identifier(): string | undefined {
		return this._identifier;
	}

	//#endregion IPositronDataExplorerEditor

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
	 * @param _accessibilityService The accessibility service.
	 * @param _clipboardService The clipboard service.
	 * @param _commandService The command service.
	 * @param _configurationService The configuration service.
	 * @param _contextKeyService The context key service.
	 * @param _contextMenuService The context menu service.
	 * @param _hoverService The hover service.
	 * @param _keybindingService The keybinding service.
	 * @param _layoutService The layout service.
	 * @param _positronDataExplorerService The Positron data explorer service.
	 * @param storageService The storage service.
	 * @param telemetryService The telemetry service.
	 * @param themeService The theme service.
	 */
	constructor(
		readonly _group: IEditorGroup,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IHoverService private readonly _hoverService: IHoverService,
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
		// Create the focus tracker.
		const focusTracker = this._register(DOM.trackFocus(parent));

		// Add the onDidFocus event handler.
		this._register(focusTracker.onDidFocus(() => {
			// If there is an identifier, meaning there is an input, set the focused Positron data
			// explorer.
			if (this._identifier) {
				this._positronDataExplorerService.setFocusedPositronDataExplorer(this._identifier);
			}
		}));

		// Add the onDidBlur event handler.
		this._register(focusTracker.onDidBlur(() => {
			// If there is an identifier, meaning there is an input, clear the focused Positron data
			// explorer.
			if (this._identifier) {
				this._positronDataExplorerService.clearFocusedPositronDataExplorer(this._identifier);
			}
		}));

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

			// Create the PositronReactRenderer.
			this._positronReactRenderer = new PositronReactRenderer(
				this._positronDataExplorerContainer
			);

			// If the Positron data explorer instance was found, render the PositronDataExplorer
			// component. Otherwise, render the PositronDataExplorerClosed component.
			if (positronDataExplorerInstance) {
				// Render the PositronDataExplorer.
				this._positronReactRenderer.render(
					<PositronDataExplorer
						accessibilityService={this._accessibilityService}
						clipboardService={this._clipboardService}
						commandService={this._commandService}
						configurationService={this._configurationService}
						contextKeyService={this._contextKeyService}
						contextMenuService={this._contextMenuService}
						hoverService={this._hoverService}
						keybindingService={this._keybindingService}
						layoutService={this._layoutService}
						instance={positronDataExplorerInstance}
						onClose={() => this._group.closeEditor(this.input)}
					/>
				);

				// Add the onDidRequestFocus event handler.
				this._positronReactRenderer.register(
					positronDataExplorerInstance.onDidRequestFocus(() =>
						this._group.openEditor(input, { activation: EditorActivation.ACTIVATE })
					)
				);
			} else {
				this._positronReactRenderer.render(
					<PositronDataExplorerClosed
						onClose={() => this._group.closeEditor(this.input)}
					/>
				);
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

		// If there is an identifier, clear it.
		if (this._identifier) {
			// Clear the focused Positron data explorer.
			this._positronDataExplorerService.clearFocusedPositronDataExplorer(this._identifier);

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
	 * Returns the underlying composite control or `undefined` if it is not accessible.
	 */
	override getControl(): IPositronDataExplorerEditor {
		return this;
	}

	/**
	 * Called when this composite should receive keyboard focus.
	 */
	override focus(): void {
		// Call the base class's method.
		super.focus();

		// Drive focus into the Positron data explorer instance.
		this._positronDataExplorerContainer?.focus();
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
