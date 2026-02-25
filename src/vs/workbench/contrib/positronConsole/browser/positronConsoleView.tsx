/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronConsoleView.css';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { PositronConsoleFocused, PositronConsoleInstancesExistContext } from '../../../common/contextkeys.js';
import { IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { PositronViewPane } from '../../../browser/positronViewPane/positronViewPane.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { PositronConsole } from './positronConsole.js';
import { IRuntimeSessionService, RuntimeStartMode } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { LanguageRuntimeSessionMode } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IReactComponentContainer, ISize, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IActionViewItem } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { IDropdownMenuActionViewItemOptions } from '../../../../base/browser/ui/dropdown/dropdownActionViewItem.js';
import { Action, IAction } from '../../../../base/common/actions.js';
import { LANGUAGE_RUNTIME_DUPLICATE_ACTIVE_SESSION_ID, LANGUAGE_RUNTIME_START_NEW_SESSION_ID } from '../../languageRuntime/browser/languageRuntimeActions.js';
import { DropdownWithPrimaryActionViewItem } from '../../../../platform/actions/browser/dropdownWithPrimaryActionViewItem.js';
import { MenuItemAction } from '../../../../platform/actions/common/actions.js';
import { localize } from '../../../../nls.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';

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

	/**
	 * Holds session dropdown button
	 */
	private readonly _sessionDropdown: MutableDisposable<DropdownWithPrimaryActionViewItem> = this._register(new MutableDisposable());

	/**
	 * Context key used to track if there are any Positron console instances.
	 * This is used to determine if we show the "+" session dropdown button.
	 */
	private _positronConsoleInstancesExistContextKey: IContextKey<boolean>;

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
	 */
	constructor(
		options: IViewPaneOptions,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IHoverService hoverService: IHoverService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService openerService: IOpenerService,
		@IPositronConsoleService private readonly positronConsoleService: IPositronConsoleService,
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
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
			hoverService);

		// Bind the context keys
		this._positronConsoleFocusedContextKey = PositronConsoleFocused.bindTo(contextKeyService);
		this._positronConsoleInstancesExistContextKey = PositronConsoleInstancesExistContext.bindTo(contextKeyService);

		// Register the onDidChangeBodyVisibility event handler.
		this._register(this.onDidChangeBodyVisibility(visible => {
			// Relay event for our `IReactComponentContainer` implementation
			this._onVisibilityChangedEmitter.fire(visible);
		}));

		this._register(this.runtimeSessionService.onDidStartRuntime(() => this.updateActions()));
		this._register(this.runtimeSessionService.onDidChangeForegroundSession(() => this.updateActions()));
		this._register(this.runtimeSessionService.onDidDeleteRuntimeSession(() => this.updateActions()));

		// Update the context key used to manage the session dropdown when the console instances change.
		this._register(this.positronConsoleService.onDidStartPositronConsoleInstance(() => {
			this.updateConsoleInstancesExistContext();
		}));

		// Update the context key used to manage the session dropdown when the console instances change.
		this._register(this.positronConsoleService.onDidDeletePositronConsoleInstance(() => {
			this.updateConsoleInstancesExistContext();
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
		this._positronReactRenderer = this._register(new PositronReactRenderer(this._positronConsoleContainer));
		this._positronReactRenderer.render(
			<PositronConsole reactComponentContainer={this} />
		);

		// Create a focus tracker that updates the PositronConsoleFocused context key.
		const focusTracker = this._register(DOM.trackFocus(this.element));
		this._register(focusTracker.onDidFocus(() => this.focusChanged(true)));
		this._register(focusTracker.onDidBlur(() => this.focusChanged(false)));

		// Initialize context key state
		this.updateConsoleInstancesExistContext();
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

	override createActionViewItem(action: IAction, options?: IDropdownMenuActionViewItemOptions): IActionViewItem | undefined {
		// Do not create the session dropdown if there are no Positron console instances.
		if (action.id === LANGUAGE_RUNTIME_DUPLICATE_ACTIVE_SESSION_ID && this.positronConsoleService.positronConsoleInstances.length > 0) {
			if (action instanceof MenuItemAction) {
				const dropdownAction = new Action('console.session.quickLaunch', localize('console.session.quickLaunch', 'Quick Launch Session...'), 'codicon-chevron-down', true);
				this._register(dropdownAction);

				this._sessionDropdown.value = new DropdownWithPrimaryActionViewItem(
					action,
					dropdownAction,
					[],
					'',
					{},
					this.contextMenuService, this.keybindingService, this.notificationService, this.contextKeyService, this.themeService, this.accessibilityService);
				this.updateSessionDropdown(dropdownAction);

				return this._sessionDropdown.value;
			}
		}
		return super.createActionViewItem(action, options);
	}

	private updateSessionDropdown(dropdownAction: Action): void {
		// Grab the current runtime.
		const currentRuntime = this.runtimeSessionService.foregroundSession?.runtimeMetadata;

		// Grab the active runtimes.
		let activeRuntimes = this.runtimeSessionService.activeSessions
			// Sort by last used, descending.
			.sort((a, b) => b.lastUsed - a.lastUsed)
			// Map from session to runtime metadata.
			.map(session => session.runtimeMetadata)
			// Remove duplicates, and current runtime.
			.filter((runtime, index, runtimes) =>
				runtime.runtimeId !== currentRuntime?.runtimeId && runtimes.findIndex(r => r.runtimeId === runtime.runtimeId) === index
			)

		// Add current runtime first, if present.
		// Allows for "plus" + enter behavior to clone session.
		if (currentRuntime) {
			activeRuntimes.unshift(currentRuntime);
		}

		// Limit to 5 active runtimes to avoid cluttering the dropdown.
		activeRuntimes = activeRuntimes.slice(0, 5);

		const dropdownMenuActions = activeRuntimes.map(runtime => new Action(
			`console.startSession.${runtime.runtimeId}`,
			runtime.runtimeName,
			undefined,
			true,
			() => {
				this.runtimeSessionService.startNewRuntimeSession(
					runtime.runtimeId,
					runtime.runtimeName,
					LanguageRuntimeSessionMode.Console,
					undefined,
					'User selected runtime',
					RuntimeStartMode.Starting,
					true
				);
			})
		);

		if (dropdownMenuActions.length === 0) {
			dropdownMenuActions.push(
				new Action(
					'console.startSession.none',
					localize('console.startSession.none', 'No Sessions'),
					undefined,
					false
				)
			);
		}

		dropdownMenuActions.push(new Action(
			'console.startSession.other',
			localize('console.startSession.other', 'Start Another...'),
			undefined,
			true,
			() => {
				this.commandService.executeCommand(LANGUAGE_RUNTIME_START_NEW_SESSION_ID);
			})
		);

		dropdownMenuActions.forEach(action => this._register(action));

		this._sessionDropdown.value?.update(dropdownAction, dropdownMenuActions, 'codicon-chevron-down');
	}

	private updateConsoleInstancesExistContext(): void {
		const hasInstances = this.positronConsoleService.positronConsoleInstances.length > 0;
		this._positronConsoleInstancesExistContextKey.set(hasInstances);
	}

	//#endregion Public Overrides
}
