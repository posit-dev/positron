/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronHelpView.css';

// Other dependencies.
import { IHelpEntry } from './helpEntry.js';
import * as DOM from '../../../../base/browser/dom.js';
import { ActionBars } from './components/actionBars.js';
import { IPositronHelpService } from './positronHelpService.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { PositronViewPane } from '../../../browser/positronViewPane/positronViewPane.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IReactComponentContainer, ISize, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';

/**
 * PositronHelpView class.
 */
export class PositronHelpView extends PositronViewPane implements IReactComponentContainer {
	//#region Private Properties

	// The width. This value is set in layoutBody and is used to implement the
	// IReactComponentContainer interface.
	private _width = 0;

	// The height. This value is set in layoutBody and is used to implement the
	// IReactComponentContainer interface.
	private _height = 0;

	// The Positron help container - contains the entire Positron help UI.
	private positronHelpContainer: HTMLElement;

	// The help action bars container - contains the PositronHelpActionBars component.
	private helpActionBarsContainer: HTMLElement;

	// The PositronReactRenderer for the PositronHelpActionBars component.
	private positronReactRendererHelpActionBars?: PositronReactRenderer;

	// The container for the help webview.
	private helpViewContainer: HTMLElement;

	/**
	 * The onSizeChanged emitter.
	 */
	private onSizeChangedEmitter = this._register(new Emitter<ISize>());

	/**
	 * The onVisibilityChanged event emitter.
	 */
	private onVisibilityChangedEmitter = this._register(new Emitter<boolean>());

	/**
	 * The onSaveScrollPosition emitter.
	 */
	private onSaveScrollPositionEmitter = this._register(new Emitter<void>());

	/**
	 * The onRestoreScrollPosition emitter.
	 */
	private onRestoreScrollPositionEmitter = this._register(new Emitter<void>());

	/**
	 * The onFocused emitter.
	 */
	private onFocusedEmitter = this._register(new Emitter<void>());

	/**
	 * The current help entry.
	 */
	private currentHelpEntry?: IHelpEntry;

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
		return this.isBodyVisible();
	}

	/**
	 * Directs the React component container to take focus.
	 */
	takeFocus(): void {
		this.focus();
	}

	/**
	 * The onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize> = this.onSizeChangedEmitter.event;

	/**
	 * The onVisibilityChanged event.
	 */
	readonly onVisibilityChanged: Event<boolean> = this.onVisibilityChangedEmitter.event;

	/**
	 * The onSaveScrollPosition event.
	 */
	readonly onSaveScrollPosition: Event<void> = this.onSaveScrollPositionEmitter.event;

	/**
	 * The onRestoreScrollPosition event.
	 */
	readonly onRestoreScrollPosition: Event<void> = this.onRestoreScrollPositionEmitter.event;

	/**
	 * The onFocused event.
	 */
	readonly onFocused: Event<void> = this.onFocusedEmitter.event;

	//#endregion IReactComponentContainer

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param options The options for the view pane.
	 */
	constructor(
		options: IViewPaneOptions,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IHoverService hoverService: IHoverService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IPositronHelpService private readonly positronHelpService: IPositronHelpService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService
	) {

		// Call the base class's constructor.
		super(
			{ ...options, openFromCollapsedSize: '50%' },
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService
		);

		// Create containers.
		this.positronHelpContainer = DOM.$('.positron-help-container');
		this.helpActionBarsContainer = DOM.$('.help-action-bars-container');
		this.helpViewContainer = DOM.$('.positron-help-view-container');

		// Append the help action bars container and help view container to the help container.
		this.positronHelpContainer.appendChild(this.helpActionBarsContainer);
		this.positronHelpContainer.appendChild(this.helpViewContainer);

		// Register the onDidChangeCurrentHelpEntry event handler.
		this._register(this.positronHelpService.onDidChangeCurrentHelpEntry(currentHelpEntry => {
			// Update the current help entry.
			this.updateCurrentHelpEntry(currentHelpEntry);
		}));

		// Register the onDidChangeBodyVisibility event handler.
		this._register(this.onDidChangeBodyVisibility(visible => {
			// If there is a current help entry, handle the visibility event by hiding or showing
			// its help overlay webview.
			if (this.currentHelpEntry) {
				if (!visible) {
					this.currentHelpEntry.hideHelpOverlayWebview(false);
				} else {
					this.currentHelpEntry.showHelpOverlayWebview(this.helpViewContainer);
				}
			}

			// Fire the onVisibilityChanged event.
			this.onVisibilityChangedEmitter.fire(visible);
		}));
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// If there is a current help entry, hide its help overlay webview.
		this.currentHelpEntry?.hideHelpOverlayWebview(false);

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region ViewPane Overrides

	/**
	 * renderBody override method.
	 * @param container The container HTMLElement.
	 */
	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Append the Positron help container.
		container.appendChild(this.positronHelpContainer);

		// Home handler.
		const homeHandler = () => {
			this.positronHelpService.showWelcomePage();
		};

		// Create and register the PositronReactRenderer for the action bars.
		this.positronReactRendererHelpActionBars = this._register(new PositronReactRenderer(this.helpActionBarsContainer));
		this._register(this.positronReactRendererHelpActionBars);

		// Render the ActionBars component.
		this.positronReactRendererHelpActionBars.render(
			<ActionBars reactComponentContainer={this} onHome={homeHandler} />
		);

		// Update the current help entry.
		this.updateCurrentHelpEntry(this.positronHelpService.currentHelpEntry);
	}

	/**
	 * focus override method.
	 */
	override focus(): void {
		// Call the base class's method.
		super.focus();

		// Fire the onFocused event.
		this.onFocusedEmitter.fire();
	}

	/**
	 * layoutBody override method.
	 * @param height The height of the body.
	 * @param width The width of the body.
	 */
	protected override layoutBody(height: number, width: number): void {
		// Call the base class's method.
		super.layoutBody(height, width);

		// Raise the onSizeChanged event.
		this.onSizeChangedEmitter.fire({
			width,
			height
		});

		// If there is a current help entry, show its help overlay webview.
		this.currentHelpEntry?.showHelpOverlayWebview(this.helpViewContainer);
	}

	//#endregion ViewPane Overrides

	//#region Private Methods

	/**
	 * Updates the current help entry.
	 * @param currentHelpEntry The current help entry.
	 */
	private updateCurrentHelpEntry(currentHelpEntry?: IHelpEntry) {
		if (this.currentHelpEntry !== currentHelpEntry) {
			this.currentHelpEntry?.hideHelpOverlayWebview(true);
			this.currentHelpEntry = currentHelpEntry;
			this.currentHelpEntry?.showHelpOverlayWebview(this.helpViewContainer);
		}
	}

	//#endregion Private Methods
}
