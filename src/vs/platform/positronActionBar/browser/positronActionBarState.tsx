/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { unmnemonicLabel } from 'vs/base/common/labels';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { Action, IAction, Separator } from 'vs/base/common/actions';
import { HoverPosition } from 'vs/base/browser/ui/hover/hoverWidget';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IHoverOptions, IHoverWidget } from 'vs/base/browser/ui/hover/hover';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { CommandCenter } from 'vs/platform/commandCenter/common/commandCenter';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { Disposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpression, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

/**
 * IHoverManager interface.
 */
export interface IHoverManager {
	/**
	 * Shows a hover.
	 * @param options A IHoverOptions that contains the hover options.
	 * @param focus A value which indicates whether to focus the hover when it is shown.
	 */
	showHover(options: IHoverOptions, focus?: boolean): void;

	/**
	 * Hides a hover.
	 */
	hideHover(): void;
}

/**
 * HoverManager class.
 */
class HoverManager extends Disposable {
	/**
	 * Gets or sets the hover leave time.
	 */
	private static _hoverLeaveTime: number = 0;

	/**
	 * The hover delay.
	 */
	private _hoverDelay: number;

	/**
	 * Gets or sets the timeout.
	 */
	private _timeout?: NodeJS.Timeout;

	/**
	 * Gets or sets the last hover widget.
	 */
	private _lastHoverWidget?: IHoverWidget;

	/**
	 * Constructor.
	 * @param configurationService The configuration service.
	 * @param _hoverService The hover service.
	 */
	constructor(
		configurationService: IConfigurationService,
		private readonly _hoverService: IHoverService
	) {
		// Call the base class's method.
		super();

		// Initialize and track changes to the hover delay.
		this._hoverDelay = configurationService.getValue<number>('workbench.hover.delay');
		this._register(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('workbench.hover.delay')) {
				this._hoverDelay = configurationService.getValue<number>('workbench.hover.delay');
			}
		}));

		// Hide the hover when the hover manager is disposed.
		this._register(toDisposable(() => this.hideHover()));
	}

	/**
	 * Shows a hover.
	 * @param options A IHoverOptions that contains the hover options.
	 * @param focus A value which indicates whether to focus the hover when it is shown.
	 */
	public showHover(options: IHoverOptions, focus?: boolean) {
		// Hide the hover.
		this.hideHover();

		/**
		 * Shows the hover.
		 * @param skipFadeInAnimation A value which indicates whether to skip fade in animation.
		 */
		const showHover = (skipFadeInAnimation: boolean) => {
			// Update the position and appearance options.
			options.position = { ...options.position, hoverPosition: HoverPosition.BELOW };
			options.appearance = { ...options.appearance, skipFadeInAnimation };

			// Show the hover and set the last hover widget.
			this._lastHoverWidget = this._hoverService.showHover(options, focus);
		};

		// If a hover was recently shown, show the hover immediately and skip the fade in animation.
		// If not, schedule the hover for display with fade in animation.
		if (Date.now() - HoverManager._hoverLeaveTime < 200) {
			showHover(true);
		} else {
			// Set the timeout to show the hover.
			this._timeout = setTimeout(() => showHover(false), this._hoverDelay);
		}
	}

	/**
	 * Hides a hover.
	 */
	public hideHover() {
		// Clear pending timeout.
		if (this._timeout) {
			clearTimeout(this._timeout);
			this._timeout = undefined;
		}

		// If there is a last hover widget, dispose of it and set the hover leave time.
		if (this._lastHoverWidget) {
			this._lastHoverWidget.dispose();
			this._lastHoverWidget = undefined;
			HoverManager._hoverLeaveTime = Date.now();
		}
	}
}

/**
 * PositronActionBarServices interface. Defines the set of services that are required by a Positron
 * action bar.
 */
export interface PositronActionBarServices {
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly hoverService: IHoverService;
	readonly keybindingService: IKeybindingService;
}

/**
 * CommandAction interface.
 */
export interface CommandAction {
	id: string;
	label?: string;
	separator?: boolean;
	when?: ContextKeyExpression;
}

/**
 * The Positron action bar state.
 */
export interface PositronActionBarState extends PositronActionBarServices {
	appendCommandAction(actions: IAction[], commandAction: CommandAction): void;
	isCommandEnabled(commandId: string): boolean;
	hoverManager: IHoverManager;
	menuShowing: boolean;
	setMenuShowing(menuShowing: boolean): void;
	focusableComponents: Set<HTMLElement>;
}

/**
 * The usePositronActionBarState custom hook.
 * @param services A PositronActionBarServices that contains the Positron action bar services.
 * @returns The hook.
 */
export const usePositronActionBarState = (
	services: PositronActionBarServices
): PositronActionBarState => {
	// State hooks.
	const [menuShowing, setMenuShowing] = useState(false);
	const [focusableComponents] = useState(new Set<HTMLElement>());
	const [hoverManager, setHoverManager] = useState<HoverManager>(undefined!);

	// Main use effect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Create the hover manager.
		setHoverManager(disposableStore.add(new HoverManager(
			services.configurationService,
			services.hoverService
		)));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [services.configurationService, services.hoverService]);

	/**
	 * Appends a command action.
	 * @param actions The set of actions to append the command action to.
	 * @param commandAction The CommandAction to append.
	 */
	const appendCommandAction = (actions: IAction[], commandAction: CommandAction) => {
		// Get the command info from the command center.
		const commandInfo = CommandCenter.commandInfo(commandAction.id);

		// If the command info was found, and the when expression matches, create the command action
		// and push it to the actions.
		if (commandInfo && services.contextKeyService.contextMatchesRules(commandAction.when)) {
			// Determine whether the command action will be enabled and set the label to use.
			const enabled = !commandInfo.precondition ||
				services.contextKeyService.contextMatchesRules(commandInfo.precondition);
			const label = commandAction.label ||
				(typeof (commandInfo.title) === 'string' ?
					commandInfo.title :
					commandInfo.title.value
				);

			// Append the separator.
			if (commandAction.separator) {
				actions.push(new Separator());
			}

			// Create the command action and push it.
			actions.push(new Action(
				commandAction.id,
				unmnemonicLabel(label),
				undefined,
				enabled, () => {
					services.commandService.executeCommand(commandAction.id);
				}
			));
		}
	};

	/**
	 * Determines whether a command is enabled.
	 * @param commandId The command ID
	 * @returns A value which indicates whether the command is enabled.
	 */
	const isCommandEnabled = (commandId: string) => {
		// Get the command info from the command center.
		const commandInfo = CommandCenter.commandInfo(commandId);
		if (!commandInfo) {
			return false;
		}

		// If the command doesn't have a precondition, it's enabled.
		if (!commandInfo.precondition) {
			return true;
		}

		// Return true if the specified command ID is enabled; otherwise, false.
		return services.contextKeyService.contextMatchesRules(commandInfo.precondition);
	};

	// Return the Positron top action bar state.
	return {
		...services,
		appendCommandAction,
		isCommandEnabled,
		hoverManager,
		menuShowing,
		setMenuShowing,
		focusableComponents
	};
};
