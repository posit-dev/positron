/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronConsoleView';

// React.
import * as React from 'react';

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { Event, Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IModelService } from 'vs/editor/common/services/model';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { PositronConsoleFocused } from 'vs/workbench/common/contextkeys';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IViewsService } from 'vs/workbench/services/views/common/viewsService';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronViewPane } from 'vs/workbench/browser/positronViewPane/positronViewPane';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronConsole } from 'vs/workbench/contrib/positronConsole/browser/positronConsole';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IExecutionHistoryService } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';

/**
 * PositronConsoleViewPane class.
 */
export class PositronConsoleViewPane extends PositronViewPane implements IReactComponentContainer {
	//#region Private Properties

	/**
	 * The onSizeChanged event emitter.
	 */
	private _onSizeChangedEmitter = this._register(new Emitter<ISize>());

	/**
	 * The onVisibilityChanged event emitter.
	 */
	private _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());

	/**
	 * The onSaveScrollPosition event emitter.
	 */
	private _onSaveScrollPositionEmitter = this._register(new Emitter<void>());

	/**
	 * The onRestoreScrollPosition event emitter.
	 */
	private _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());

	/**
	 * The onFocused event emitter.
	 */
	private _onFocusedEmitter = this._register(new Emitter<void>());

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
	 * Gets or sets the Positron console container - contains the entire Positron console UI.
	 */
	private _positronConsoleContainer!: HTMLElement;

	/**
	 * Gets or sets the PositronReactRenderer for the PositronConsole component.
	 */
	private _positronReactRenderer: PositronReactRenderer | undefined;

	/**
	 * Gets or sets the PositronConsoleFocused context key.
	 */
	private _positronConsoleFocusedContextKey: IContextKey<boolean>;

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

	focusChanged(focused: boolean) {
		this._positronConsoleFocusedContextKey.set(focused);

		if (focused) {
			this._onFocusedEmitter.fire();
		}
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
	 * @param options View pane options.
	 * @param accessibilityService The accessibility service.
	 * @param clipboardService The clipboard service.
	 * @param commandService The command service.
	 * @param configurationService The configuration service.
	 * @param contextKeyService The context key service.
	 * @param contextMenuService The context menu service.
	 * @param executionHistoryService The execution history service.
	 * @param hoverService The hover service.
	 * @param instantiationService The instantiation service.
	 * @param keybindingService The keybinding service.
	 * @param languageRuntimeService The language runtime service.
	 * @param languageService The language service.
	 * @param logService The log service.
	 * @param modelService The model service.
	 * @param notificationService The notification service.
	 * @param openerService The opener service.
	 * @param positronConsoleService The Positron console service.
	 * @param positronPlotsService The Positron plots service.
	 * @param runtimeSessionService The runtime session service.
	 * @param runtimeStartupService The runtime startup service.
	 * @param telemetryService The telemetry service.
	 * @param themeService The theme service.
	 * @param viewDescriptorService The view descriptor service.
	 * @param viewsService The views service.
	 * @param workbenchLayoutService The workbench layout service.
	 */
	constructor(
		options: IViewPaneOptions,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExecutionHistoryService private readonly executionHistoryService: IExecutionHistoryService,
		@IHoverService hoverService: IHoverService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ILanguageRuntimeService private readonly languageRuntimeService: ILanguageRuntimeService,
		@ILanguageService private readonly languageService: ILanguageService,
		@ILogService private readonly logService: ILogService,
		@IModelService private readonly modelService: IModelService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService openerService: IOpenerService,
		@IPositronConsoleService private readonly positronConsoleService: IPositronConsoleService,
		@IPositronPlotsService private readonly positronPlotsService: IPositronPlotsService,
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@IRuntimeStartupService private readonly runtimeStartupService: IRuntimeStartupService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IViewsService private readonly viewsService: IViewsService,
		@IWorkbenchLayoutService private readonly workbenchLayoutService: IWorkbenchLayoutService
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			telemetryService,
			hoverService);

		// Bind the PositronConsoleFocused context key.
		this._positronConsoleFocusedContextKey = PositronConsoleFocused.bindTo(contextKeyService);

		// Register the onDidChangeBodyVisibility event handler.
		this._register(this.onDidChangeBodyVisibility(visible => {
			// Relay event for our `IReactComponentContainer` implementation
			this._onVisibilityChangedEmitter.fire(visible);
		}));
	}

	/**
	 * Dispose.
	 */
	public override dispose(): void {
		// Call the base class's method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Overrides

	/**
	 * Renders the body.
	 * @param container The container HTMLElement.
	 */
	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Append the Positron console container.
		this._positronConsoleContainer = DOM.$('.positron-console-container');
		container.appendChild(this._positronConsoleContainer);

		// Render the Positron console.
		this._positronReactRenderer = new PositronReactRenderer(this._positronConsoleContainer);
		this._register(this._positronReactRenderer);
		this._positronReactRenderer.render(
			<PositronConsole
				accessibilityService={this.accessibilityService}
				clipboardService={this.clipboardService}
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				executionHistoryService={this.executionHistoryService}
				hoverService={this.hoverService}
				instantiationService={this.instantiationService}
				keybindingService={this.keybindingService}
				languageRuntimeService={this.languageRuntimeService}
				runtimeSessionService={this.runtimeSessionService}
				runtimeStartupService={this.runtimeStartupService}
				languageService={this.languageService}
				logService={this.logService}
				modelService={this.modelService}
				notificationService={this.notificationService}
				openerService={this.openerService}
				positronConsoleService={this.positronConsoleService}
				positronPlotsService={this.positronPlotsService}
				viewsService={this.viewsService}
				workbenchLayoutService={this.workbenchLayoutService}
				reactComponentContainer={this}
			/>
		);

		// Create a focus tracker that updates the PositronConsoleFocused context key.
		const focusTracker = this._register(DOM.trackFocus(this.element));
		this._register(focusTracker.onDidFocus(() => this.focusChanged(true)));
		this._register(focusTracker.onDidBlur(() => this.focusChanged(false)));
	}

	/**
	 * Drive focus to inner element.
	 * Called by `super.focus()`.
	 */
	override focusElement(): void {
		// Trigger event that eventually causes console input widgets (main
		// input, readline input, or restart buttons) to focus. Must be after
		// the super call.
		this.positronConsoleService.activePositronConsoleInstance?.focusInput();
	}

	/**
	 * layoutBody override method.
	 * @param height The height of the body.
	 * @param width The width of the body.
	 */
	protected override layoutBody(height: number, width: number): void {
		// Call the base class's method.
		super.layoutBody(height, width);

		// Adjust the size of the Positron console container.
		this._positronConsoleContainer.style.width = `${width}px`;
		this._positronConsoleContainer.style.height = `${height}px`;

		// Set the width and height.
		this._width = width;
		this._height = height;

		// Raise the onSizeChanged event.
		this._onSizeChangedEmitter.fire({
			width,
			height
		});
	}

	//#endregion Public Overrides
}
