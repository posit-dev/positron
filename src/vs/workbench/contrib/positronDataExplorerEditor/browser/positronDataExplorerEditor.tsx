/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronDataExplorerEditor.css';

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { EditorActivation, IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { PositronDataExplorer } from '../../../browser/positronDataExplorer/positronDataExplorer.js';
import { IReactComponentContainer, ISize, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { PositronDataExplorerUri } from '../../../services/positronDataExplorer/common/positronDataExplorerUri.js';
import { IPositronDataExplorerService, PositronDataExplorerLayout } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { PositronDataExplorerEditorInput } from './positronDataExplorerEditorInput.js';
import { PositronDataExplorerClosed, PositronDataExplorerClosedStatus } from '../../../browser/positronDataExplorer/components/dataExplorerClosed/positronDataExplorerClosed.js';
import { POSITRON_DATA_EXPLORER_CODE_SYNTAXES_AVAILABLE, POSITRON_DATA_EXPLORER_IS_COLUMN_SORTING, POSITRON_DATA_EXPLORER_IS_CONVERT_TO_CODE_ENABLED, POSITRON_DATA_EXPLORER_IS_PLAINTEXT, POSITRON_DATA_EXPLORER_IS_ROW_FILTERING, POSITRON_DATA_EXPLORER_LAYOUT } from './positronDataExplorerContextKeys.js';
import { checkDataExplorerConvertToCodeEnabled, DATA_EXPLORER_CONVERT_TO_CODE } from '../../../services/positronDataExplorer/common/positronDataExplorerConvertToCodeConfig.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { SupportStatus } from '../../../services/languageRuntime/common/positronDataExplorerComm.js';

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
	 * Gets the layout context key.
	 */
	private readonly _layoutContextKey: IContextKey<PositronDataExplorerLayout>;

	/**
	 * Gets the is column sorting context key.
	 */
	private readonly _isColumnSortingContextKey: IContextKey<boolean>;

	/**
	 * Gets the is plaintext editable context key.
	 */
	private readonly _isPlaintextContextKey: IContextKey<boolean>;

	/**
	 * Gets the is convert to code enabled context key.
	 */
	private readonly _isConvertToCodeEnabledContextKey: IContextKey<boolean>;

	/**
	 * Gets the code syntaxes available context key.
	 */
	private readonly _codeSyntaxesAvailableContextKey: IContextKey<boolean>;

	/**
	 * Gets the is row filtering context key.
	 */
	private readonly _isRowFilteringContextKey: IContextKey<boolean>;

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
	 */
	constructor(
		readonly _group: IEditorGroup,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
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

		// Create the context keys.
		this._layoutContextKey = POSITRON_DATA_EXPLORER_LAYOUT.bindTo(
			this._group.scopedContextKeyService
		);
		this._isColumnSortingContextKey = POSITRON_DATA_EXPLORER_IS_COLUMN_SORTING.bindTo(
			this._group.scopedContextKeyService
		);
		this._isPlaintextContextKey = POSITRON_DATA_EXPLORER_IS_PLAINTEXT.bindTo(
			this._group.scopedContextKeyService
		);
		this._isConvertToCodeEnabledContextKey = POSITRON_DATA_EXPLORER_IS_CONVERT_TO_CODE_ENABLED.bindTo(
			this._group.scopedContextKeyService
		);
		this._codeSyntaxesAvailableContextKey = POSITRON_DATA_EXPLORER_CODE_SYNTAXES_AVAILABLE.bindTo(
			this._group.scopedContextKeyService
		);
		this._isRowFilteringContextKey = POSITRON_DATA_EXPLORER_IS_ROW_FILTERING.bindTo(
			this._group.scopedContextKeyService
		);

		// Set the convert to code context key based on the configuration value.
		this._isConvertToCodeEnabledContextKey.set(
			checkDataExplorerConvertToCodeEnabled(this._configurationService)
		);


		// Listen for configuration changes to the convert to code setting and update the context key accordingly.
		this._register(this._configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(DATA_EXPLORER_CONVERT_TO_CODE)) {
				this._isConvertToCodeEnabledContextKey.set(
					checkDataExplorerConvertToCodeEnabled(this._configurationService)
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
			this._positronReactRenderer = new PositronReactRenderer(this._positronDataExplorerContainer);

			// If the Positron data explorer instance was found, render the PositronDataExplorer
			// component. Otherwise, render the PositronDataExplorerClosed component.
			if (positronDataExplorerInstance) {
				const client = positronDataExplorerInstance.dataExplorerClientInstance;

				client.getBackendState().then((backendState) => {
					if (input !== undefined && backendState.display_name !== undefined) {
						// We truncate the `display_name` to a reasonable length as
						// the editor tab title has limited space.
						const maxTabSize = 30;
						let display_name = backendState.display_name;
						if (backendState.display_name.length > maxTabSize) {
							display_name = backendState.display_name.substring(0, maxTabSize - 3) + '...';
						}

						input.setName?.(`Data: ${display_name}`);
					}
					// set context keys for convert to code and code syntaxes availability
					const convertToCode = backendState.supported_features.convert_to_code;
					if (backendState.supported_features.convert_to_code.support_status === SupportStatus.Unsupported) {
						this._isConvertToCodeEnabledContextKey.set(false);
					}
					this._codeSyntaxesAvailableContextKey.set(
						!!(convertToCode.code_syntaxes && convertToCode.code_syntaxes.length > 0)
					);
				});

				// Set the context keys.
				this._layoutContextKey.set(
					positronDataExplorerInstance.layout
				);
				this._isColumnSortingContextKey.set(
					positronDataExplorerInstance.tableDataDataGridInstance.isColumnSorting
				);
				this._isRowFilteringContextKey.set(
					(positronDataExplorerInstance.dataExplorerClientInstance?.cachedBackendState?.row_filters?.length ?? 0) > 0
				);

				const uri = PositronDataExplorerUri.backingUri(input.resource);
				if (uri) {
					this._isPlaintextContextKey.set(PLAINTEXT_EXTS.some(ext => uri.path.endsWith(ext)));
				} else {
					this._isPlaintextContextKey.reset();
				}


				// Render the PositronDataExplorer.
				this._positronReactRenderer.render(
					<PositronDataExplorer
						instance={positronDataExplorerInstance}
						onClose={() => this._group.closeEditor(this.input)}
					/>
				);

				// Add the onDidChangeLayout event handler.
				this._positronReactRenderer.register(
					positronDataExplorerInstance.onDidChangeLayout(positronDataExplorerLayout =>
						this._layoutContextKey.set(positronDataExplorerLayout)
					)
				);

				// Add the onDidRequestFocus event handler.
				this._positronReactRenderer.register(
					positronDataExplorerInstance.onDidRequestFocus(() =>
						this._group.openEditor(input, { activation: EditorActivation.ACTIVATE })
					)
				);

				// Add the onDidChangeColumnSorting event handler.
				this._positronReactRenderer.register(
					positronDataExplorerInstance.onDidChangeColumnSorting(isColumnSorting =>
						this._isColumnSortingContextKey.set(isColumnSorting)
					)
				);

				// Add the onDidUpdateBackendState event handler to track row filters.
				this._positronReactRenderer.register(
					positronDataExplorerInstance.dataExplorerClientInstance.onDidUpdateBackendState(state => {
						// Set the row filtering context key based on whether there are any filters
						this._isRowFilteringContextKey.set(state.row_filters.length > 0);
					})
				);
			} else {
				this._positronReactRenderer.render(
					<PositronDataExplorerClosed
						closedReason={PositronDataExplorerClosedStatus.UNAVAILABLE}
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

const PLAINTEXT_EXTS = [
	'.csv',
	'.tsv'
]
