/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { IEditorGroupView } from './editor.js';
import { Emitter } from '../../../../base/common/event.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IAction, Separator, SubmenuAction } from '../../../../base/common/actions.js';
import { actionTooltip } from '../../../../platform/positronActionBar/common/helpers.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { PositronActionBar } from '../../../../platform/positronActionBar/browser/positronActionBar.js';
import { ActionBarRegion } from '../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarSeparator } from '../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { ActionBarMenuButton } from '../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { ActionBarActionButton } from '../../../../platform/positronActionBar/browser/components/actionBarActionButton.js';
import { ActionBarActionToggle } from '../../../../platform/positronActionBar/browser/components/actionBarActionToggle.js';
import { ActionBarCommandButton } from '../../../../platform/positronActionBar/browser/components/actionBarCommandButton.js';
import { ActionBarActionCheckbox } from '../../../../platform/positronActionBar/browser/components/actionBarActionCheckbox.js';
import { IMenu, IMenuActionOptions, IMenuService, MenuId, MenuItemAction, SubmenuItemAction } from '../../../../platform/actions/common/actions.js';
import { isPositronActionBarCheckboxOptions, isPositronActionBarButtonOptions, isPositronActionBarToggleOptions } from '../../../../platform/action/common/action.js';
import { PositronActionBarWidgetRegistry } from '../../../../platform/positronActionBar/browser/positronActionBarWidgetRegistry.js';
import { ActionBarWidget } from '../../../../platform/positronActionBar/browser/components/actionBarWidget.js';

// Constants.
const PADDING_LEFT = 8;
const PADDING_RIGHT = 8;

/**
 * Localized strings.
 */
const positronMoveIntoNewWindowAriaLabel = localize(
	'positronMoveIntoNewWindowAriaLabel',
	"Move into new window"
);
const positronMoveIntoNewWindowTooltip = localize(
	'positronMoveIntoNewWindowTooltip',
	"Move into New Window"
);
const positronMoreActionsAriaLabel = localize(
	'positronMoreActionsAriaLabel',
	"More actions"
);
const positronMoreActionsTooltip = localize(
	'positronMoreActionsTooltip',
	"More Actions..."
);

/**
 * SubmenuDescriptor interface.
 */
interface SubmenuDescriptor {
	group: string;
	action: SubmenuAction;
	index: number;
}

/**
* EditorActionBarFactory class.
*/
export class EditorActionBarFactory extends Disposable {
	//#region Private Properties

	/**
	 * Gets the menu disposable stores.
	 */
	private readonly _menuDisposableStores = new Map<MenuId, DisposableStore>();

	/**
	 * Gets the menus.
	 */
	private readonly _menus = new Map<MenuId, IMenu>();

	/**
	 * Gets the onDidActionsChange event emitter.
	 */
	private readonly _onDidActionsChangeEmitter = this._register(new Emitter<void>());

	//#endregion Private Properties

	//#region Public Events

	/**
	 * The onDidActionsChange event.
	 */
	readonly onDidActionsChange = this._onDidActionsChangeEmitter.event;

	//#endregion Public Events

	//#region Private Properties

	/**
	 * Gets the context key service.
	 */
	private get contextKeyService() {
		// If there is an active editor pane, use its scoped context key service, if possible.
		// Otherwise, use the editor group's scoped context key service.
		return this._editorGroup.activeEditorPane?.scopedContextKeyService ??
			this._editorGroup.scopedContextKeyService;
	}

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _editorGroup The editor group.
	 * @param _contextKeyService The context key service.
	 * @param _keybindingService The keybinding service.
	 * @param _menuService The menu service.
	 */
	constructor(
		private readonly _editorGroup: IEditorGroupView,
		private readonly _contextKeyService: IContextKeyService,
		private readonly _keybindingService: IKeybindingService,
		private readonly _menuService: IMenuService,
	) {
		// Call the base class's constructor.
		super();

		/**
		 * Creates the menus.
		 */
		const createMenus = () => {
			this.createMenu(MenuId.EditorActionsLeft);
			this.createMenu(MenuId.EditorActionsRight);
			this.createMenu(MenuId.EditorTitle);
		};

		// Create the menus.
		createMenus();

		// Add the onDidActiveEditorChange event handler.
		this._register(this._editorGroup.onDidActiveEditorChange(e => {
			// Recreate the menus.
			createMenus();

			// Raise the onDidActionsChange event.
			this._onDidActionsChangeEmitter.fire();
		}));
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Creates the action bar.
	 * @param auxiliaryWindow A value which indicates whether the window is an auxiliary window.
	 * @returns The action bar.
	 */
	create(auxiliaryWindow?: boolean) {
		// Create the set of processed actions.
		const processedActions = new Set<string>();

		// Create the left action bar elements from the editor title menu's editor title run submenu
		// item and the editor actions left menu.
		const leftActionBarElements = [
			// Build action bar elements from the editor title run submenu item.
			...this.buildActionBarElements(
				processedActions,
				false,
				MenuId.EditorTitle,
				new Set(['submenuitem.EditorTitleRun']),
			),
			// Build action bar elements from the editor actions left menu.
			...this.buildActionBarElements(
				processedActions,
				false,
				MenuId.EditorActionsLeft,
			)
		];

		// Build the right action bar elements from the editor actions right menu and the remaining
		// actions on the editor title menu.
		const rightActionBarElements = [
			// Build action bar elements from the editor actions right menu.
			...this.buildActionBarElements(
				processedActions,
				false,
				MenuId.EditorActionsRight,
			),
			// Build action bar elements from the remaining actions on the editor title menu.
			...this.buildActionBarElements(
				processedActions,
				true,
				MenuId.EditorTitle,
			)
		];

		// Splice the move editor to new window command button into the right action bar elements.
		rightActionBarElements.splice(
			rightActionBarElements.length - 1,
			0,
			<ActionBarCommandButton
				ariaLabel={positronMoveIntoNewWindowAriaLabel}
				commandId='workbench.action.moveEditorToNewWindow'
				disabled={auxiliaryWindow}
				icon={ThemeIcon.fromId('positron-open-in-new-window')}
				tooltip={positronMoveIntoNewWindowTooltip}
			/>
		);

		// Return the action bar.
		return (
			<PositronActionBar
				borderBottom={true}
				borderTop={false}
				paddingLeft={PADDING_LEFT}
				paddingRight={PADDING_RIGHT}
			>
				{leftActionBarElements.length > 0 &&
					<ActionBarRegion location='left'>
						{leftActionBarElements}
					</ActionBarRegion>
				}
				{rightActionBarElements.length > 0 &&
					<ActionBarRegion location='right'>
						{rightActionBarElements}
					</ActionBarRegion>
				}
			</PositronActionBar>
		);
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Creates a menu.
	 * @param menuId The menu ID.
	 */
	private createMenu(menuId: MenuId) {
		// Dispose the current menu disposable store.
		this._menuDisposableStores.get(menuId)?.dispose();

		// Add the menu disposable store.
		const disposableStore = new DisposableStore();
		this._menuDisposableStores.set(menuId, disposableStore);

		// Create the menu.
		const menu = disposableStore.add(this._menuService.createMenu(
			menuId,
			this.contextKeyService,
			{
				emitEventsForSubmenuChanges: true,
				eventDebounceDelay: 0
			}
		));
		this._menus.set(menuId, menu);

		// Add the onDidChange event handler to the menu.
		disposableStore.add(menu.onDidChange(() => {
			// Recreate the menu.
			this.createMenu(menuId);

			// Raise the onDidActionsChange event.
			this._onDidActionsChangeEmitter.fire();
		}));
	}

	/**
	 * Builds action bar elements for a menu.
	 * @param processedActions The set of action IDs that have already been processed (used to prevent duplicates).
	 * @param buildSecondaryActions A value which indicates whether to build the secondary actions.
	 * @param menuId The menu ID of the menu to build action bar elements from.
	 * @param actionIds An optional set of specific action IDs to filter by; if provided, only actions with these IDs will be processed.
	 * @returns An array of JSX elements representing the action bar components.
	 */
	private buildActionBarElements(
		processedActions: Set<string>,
		buildSecondaryActions: boolean,
		menuId: MenuId,
		actionIds: Set<string> | undefined = undefined,
	) {
		// Get the menu. If it does not exist, return an empty array.
		const menu = this._menus.get(menuId);
		if (!menu) {
			return [];
		}

		// Process the menu actions.
		const primaryActions: IAction[] = [];
		const secondaryActions: IAction[] = [];
		const submenuDescriptors = new Set<SubmenuDescriptor>();
		const options = {
			arg: this._editorGroup.activeEditor?.resource,
			shouldForwardArgs: true
		} satisfies IMenuActionOptions;
		for (const [group, actions] of menu.getActions(options)) {
			// Determine the target actions.
			const targetActions = !buildSecondaryActions || this.isPrimaryGroup(group) ?
				primaryActions :
				secondaryActions;

			// Push a separator between groups.
			if (targetActions.length > 0) {
				targetActions.push(new Separator());
			}

			// Enumerate the actions of the group.
			for (const action of actions) {
				// Push the action to the target actions.
				const index = targetActions.push(action) - 1;

				// Build the submenu descriptors for inlining below.
				if (action instanceof SubmenuAction) {
					submenuDescriptors.add({
						group,
						action,
						index
					});
				}
			}
		}

		// Inline submenus, where possible.
		for (const { group, action, index } of submenuDescriptors) {
			// Set the target.
			const target = !buildSecondaryActions || this.isPrimaryGroup(group) ?
				primaryActions :
				secondaryActions;

			// Inline the submenu, if possible.
			if (this.shouldInlineSubmenuAction(group, action)) {
				target.splice(index, 1, ...action.actions);
			}
		}

		// Action bar elements.
		const actionBarElements: JSX.Element[] = [];

		/**
		 * Processes an action.
		 * @param action The action to process.
		 */
		const processAction = (action: IAction) => {
			// Update the processed actions.
			processedActions.add(action.id);

			// If the action is a menu item action, process it. Otherwise, push it to the secondary actions.
			if (action instanceof MenuItemAction) {
				// Handle the menu item action.
				if (!action.positronActionBarOptions || isPositronActionBarButtonOptions(action.positronActionBarOptions)) {
					actionBarElements.push(<ActionBarActionButton action={action} />);
				} else if (isPositronActionBarCheckboxOptions(action.positronActionBarOptions)) {
					actionBarElements.push(<ActionBarActionCheckbox action={action} />);
				} else if (isPositronActionBarToggleOptions(action.positronActionBarOptions)) {
					actionBarElements.push(<ActionBarActionToggle action={action} />);
				} else {
					// This indicates unknown positronActionBarOptions and is a bug.
					console.warn(`EditorActionBarFactory: Unknown positronActionBarOptions for action ${action.id}. Using ActionBarActionButton as fallback.`);
					actionBarElements.push(<ActionBarActionButton action={action} />);
				}
			} else {
				secondaryActions.push(action);
			}
		};

		/**
		 * Processes a submenu item action.
		 * @param submenuItemAction The submenu item action to process.
		 * @param submenuActions The submenu actions.
		 */
		const processSubmenuItemAction = (submenuItemAction: SubmenuItemAction, submenuActions: IAction[]) => {
			// Update the processed actions.
			processedActions.add(submenuItemAction.id);
			for (const submenuAction of submenuActions) {
				processedActions.add(submenuAction.id);
			}

			// Add the appropriate action bar menu button for the submenu item action.
			if (!submenuItemAction.item.isSplitButton) {
				actionBarElements.push(
					<ActionBarMenuButton
						actions={() => submenuActions}
						align='left'
						ariaLabel={submenuItemAction.label ?? submenuItemAction.tooltip}
						dropdownIndicator='disabled'
						icon={submenuItemAction.item.icon}
						tooltip={actionTooltip(
							this._contextKeyService,
							this._keybindingService,
							submenuItemAction,
							false
						)}
					/>
				);
			} else {
				const firstAction = submenuActions[0];
				if (firstAction instanceof MenuItemAction) {
					actionBarElements.push(
						<ActionBarMenuButton
							actions={() => submenuActions}
							align='left'
							ariaLabel={firstAction.label ?? firstAction.tooltip}
							dropdownAriaLabel={submenuItemAction.label ?? submenuItemAction.tooltip}
							dropdownIndicator='enabled-split'
							dropdownTooltip={actionTooltip(
								this._contextKeyService,
								this._keybindingService,
								submenuItemAction,
								false
							)}
							icon={firstAction.item.icon}
							label={firstAction.item.icon ? undefined : firstAction.label}
							tooltip={actionTooltip(
								this._contextKeyService,
								this._keybindingService,
								firstAction,
								false
							)}
						/>
					);
				} else {
					secondaryActions.push(...submenuActions);
				}
			}
		};

		// Build the action bar elements from the primary actions.
		for (const action of primaryActions) {
			// If action IDs were specified, filter the actions by their IDs.
			if (actionIds && !actionIds.has(action.id)) {
				continue;
			}

			// Process separators.
			if (action instanceof Separator) {
				actionBarElements.push(<ActionBarSeparator />);
				continue;
			}

			// If the action has already been processed, skip it.
			if (processedActions.has(action.id)) {
				continue;
			}

			// Process submenu item actions.
			if (action instanceof SubmenuItemAction) {
				// Find all unprocessed actions in the submenu item action. If there are none, continue.
				const unprocessedActions = action.actions.filter(a => !processedActions.has(a.id));
				if (unprocessedActions.length === 0) {
					continue;
				}

				// If the submenu item action has a single unprocessed action, process it alone.
				// Otherwise, process the submenu item action.
				if (unprocessedActions.length === 1) {
					processAction(unprocessedActions[0]);
				} else {
					processSubmenuItemAction(action, unprocessedActions);
				}

				// Continue to the next action.
				continue;
			}

			// Process the action.
			processAction(action);
		}
		// Get widgets for this menu location and add them to action bar elements.
		// Widgets are custom React components (like status indicators) that appear alongside actions.
		// They are filtered by context keys and sorted by order number.
		const widgets = PositronActionBarWidgetRegistry.getWidgets(menuId, this._contextKeyService);
		for (const widget of widgets) {
			actionBarElements.push(<ActionBarWidget key={widget.id} descriptor={widget} />);
		}

		// If there are secondary actions, add the more actions button. Note that the normal
		// dropdown arrow is hidden on this button because it uses the ··· icon.
		if (secondaryActions.length) {
			actionBarElements.push(
				<ActionBarMenuButton
					actions={() => secondaryActions}
					align='left'
					ariaLabel={positronMoreActionsAriaLabel}
					dropdownIndicator='disabled'
					icon={ThemeIcon.fromId('toolbar-more')}
					tooltip={positronMoreActionsTooltip}
				/>
			);
		}

		// Return the action bar elements.
		return actionBarElements;
	}

	/**
	 * Determines whether a group is the primary group.
	 * @param group The group.
	 * @returns true, if the group is the primary group; otherwise, false.
	 */
	private isPrimaryGroup(group: string) {
		return group === 'navigation';
	}

	/**
	 * Determines whether a submenu action should be inlined.
	 * @param group The group.
	 * @param action The submenu action.
	 * @returns true, if the submenu actions should be inlined; otherwise, false.
	 */
	private shouldInlineSubmenuAction(group: string, action: SubmenuAction) {
		return this.isPrimaryGroup(group) && action.actions.length <= 1;
	}

	//#endregion Private Methods
}
