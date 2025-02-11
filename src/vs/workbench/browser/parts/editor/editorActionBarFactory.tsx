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
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { PositronActionBar } from '../../../../platform/positronActionBar/browser/positronActionBar.js';
import { ActionBarRegion } from '../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarSeparator } from '../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { ActionBarMenuButton } from '../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { ActionBarActionButton } from '../../../../platform/positronActionBar/browser/components/actionBarActionButton.js';
import { ActionBarCommandButton } from '../../../../platform/positronActionBar/browser/components/actionBarCommandButton.js';
import { IMenu, IMenuActionOptions, IMenuService, MenuId, MenuItemAction, SubmenuItemAction } from '../../../../platform/actions/common/actions.js';

// Constants.
const PADDING_LEFT = 8;
const PADDING_RIGHT = 8;

/**
 * Localized strings.
 */
const positronMoreActionsTooltip = localize(
	'positronMoreActionsTooltip',
	"More Actions..."
);
const positronMoreActionsAriaLabel = localize(
	'positronMoreActionsAriaLabel',
	"More actions"
);
const positronMoveIntoNewWindowTooltip = localize(
	'positronMoveIntoNewWindowTooltip',
	"Move into New Window"
);
const positronMoveIntoNewWindowAriaLabel = localize(
	'positronMoveIntoNewWindowAriaLabel',
	"Move into new window"
);

/**
 * Constants.
 */
const CODICON_ID = /^codicon codicon-(.+)$/;

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
			this.createMenu(MenuId.EditorActionsCenter);
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

		// Build the left action bar elements from the editor actions left menu.
		const leftActionBarElements = this.buildActionBarElements(
			processedActions,
			MenuId.EditorActionsLeft,
			false
		);

		// Build the center action bar elements from the editor actions center menu.
		const centerActionBarElements = this.buildActionBarElements(
			processedActions,
			MenuId.EditorActionsCenter,
			false
		);

		// Build the right action bar elements from the editor actions right menu and the editor
		// title menu.
		const rightActionBarElements = [
			// Build the right action bar elements from the editor actions right menu.
			...this.buildActionBarElements(
				processedActions,
				MenuId.EditorActionsRight,
				false
			),
			// Build the right action bar elements from the editor title menu.
			...this.buildActionBarElements(
				processedActions,
				MenuId.EditorTitle,
				true
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
				iconId='positron-open-in-new-window'
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
				size='small'
			>
				{leftActionBarElements.length > 0 &&
					<ActionBarRegion location='left'>
						{leftActionBarElements}
					</ActionBarRegion>
				}
				{centerActionBarElements.length > 0 &&
					<ActionBarRegion location='center'>
						{centerActionBarElements}
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
	 * @param processedActions The processed actions.
	 * @param menuId The menu ID.
	 * @param buildSecondaryActions A value which indicates whether to build secondary actions.
	 */
	private buildActionBarElements(
		processedActions: Set<string>,
		menuId: MenuId,
		buildSecondaryActions: boolean
	) {
		// Get the menu.
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

		// Build the action bar elements.
		const elements: JSX.Element[] = [];
		for (const action of primaryActions) {
			// Process the action.
			if (action instanceof Separator) {
				// Separator action.
				elements.push(<ActionBarSeparator />);
			} else if (action instanceof MenuItemAction) {
				// Menu item action.
				if (!processedActions.has(action.id)) {
					processedActions.add(action.id);
					elements.push(<ActionBarActionButton action={action} />);
				}
			} else if (action instanceof SubmenuItemAction) {
				// Process the action.
				if (!action.item.rememberDefaultAction) {
					// Get the icon ID. TODO: Deal with non-theme icons.
					const iconId = ThemeIcon.isThemeIcon(action.item.icon) ?
						action.item.icon.id :
						undefined;

					// Push the action bar menu button.
					elements.push(
						<ActionBarMenuButton
							actions={() => action.actions}
							align='left'
							ariaLabel={action.label ?? action.tooltip}
							dropdownIndicator='disabled'
							iconId={iconId}
							tooltip={actionTooltip(
								this._contextKeyService,
								this._keybindingService,
								action,
								false
							)}
						/>
					);
				} else {
					// Submenu action. Get the first action.
					const firstAction = action.actions[0];

					// The first action must be a menu item action.
					if (firstAction instanceof MenuItemAction) {
						// Extract the icon ID from the class.
						const iconIdResult = action.actions[0].class?.match(CODICON_ID);
						const iconId = iconIdResult?.length === 2 ? iconIdResult[1] : undefined;

						// Push the action bar menu button.
						elements.push(
							<ActionBarMenuButton
								actions={() => action.actions}
								align='left'
								ariaLabel={firstAction.label ?? firstAction.tooltip}
								dropdownAriaLabel={action.label ?? action.tooltip}
								dropdownIndicator='enabled-split'
								dropdownTooltip={actionTooltip(
									this._contextKeyService,
									this._keybindingService,
									action,
									false
								)}
								iconId={iconId}
								text={iconId ? undefined : firstAction.label}
								tooltip={actionTooltip(
									this._contextKeyService,
									this._keybindingService,
									firstAction,
									false
								)}
							/>
						);
					}
				}
			}
		}

		// If there are secondary actions, add the more actions button. Note that the normal
		// dropdown arrow is hidden on this button because it uses the ··· icon.
		if (secondaryActions.length) {
			elements.push(
				<ActionBarMenuButton
					actions={() => secondaryActions}
					align='left'
					ariaLabel={positronMoreActionsAriaLabel}
					dropdownIndicator='disabled'
					iconId='toolbar-more'
					tooltip={positronMoreActionsTooltip}
				/>
			);
		}

		// Return the action bar elements.
		return elements;
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
