/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IAction, Separator, SubmenuAction } from 'vs/base/common/actions';
import { IEditorGroupView } from 'vs/workbench/browser/parts/editor/editor';
import { actionTooltip } from 'vs/platform/positronActionBar/common/helpers';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { IMenu, IMenuService, MenuId, MenuItemAction } from 'vs/platform/actions/common/actions';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { ActionBarActionButton } from 'vs/platform/positronActionBar/browser/components/actionBarActionButton';
import { ActionBarCommandButton } from 'vs/platform/positronActionBar/browser/components/actionBarCommandButton';

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
	 * Gets the menu disposable store.
	 */
	private readonly _menuDisposableStore = this._register(new DisposableStore());

	/**
	 * Gets or sets the editor title menu.
	 */
	private _editorTitleMenu: IMenu;

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
		 * Creates the editor title menu.
		 * @returns The editor title menu.
		 */
		const createEditorTitleMenu = () => {
			// Clear the menu disposable store.
			this._menuDisposableStore.clear();

			// If there is an active editor pane, use its scoped context key service, if possible.
			// Otherwise, use the editor group's scoped context key service.
			const contextKeyService = this._editorGroup.activeEditorPane?.scopedContextKeyService ??
				this._editorGroup.scopedContextKeyService;

			// Create the menu.
			const editorTitleMenu = this._menuDisposableStore.add(this._menuService.createMenu(
				MenuId.EditorTitle,
				contextKeyService,
				{
					emitEventsForSubmenuChanges: true,
					eventDebounceDelay: 0
				}
			));

			// Add the onDidChange event handler.
			this._menuDisposableStore.add(editorTitleMenu.onDidChange(() => {
				// Create the menu.
				this._editorTitleMenu = createEditorTitleMenu();

				// Raise the onDidActionsChange event.
				this._onDidActionsChangeEmitter.fire();
			}));

			// Return the menu.
			return editorTitleMenu;
		};

		// Create the menu.
		this._editorTitleMenu = createEditorTitleMenu();

		// Add the onDidActiveEditorChange event handler.
		this._register(this._editorGroup.onDidActiveEditorChange(() => {
			// Create the menu.
			this._editorTitleMenu = createEditorTitleMenu();

			// Raise the onDidActionsChange event.
			this._onDidActionsChangeEmitter.fire();
		}));
	}

	//#endregion Constructor

	//#region Public Properties

	/**
	 * Gets the menu.
	 */
	get menu() {
		return this._editorTitleMenu;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Creates the action bar.
	 * @param auxiliaryWindow A value which indicates whether the window is an auxiliary window.
	 * @returns The action bar.
	 */
	create(auxiliaryWindow?: boolean) {
		// Break the actions into primary actions, secondary actions, and submenu descriptors.
		const primaryActions: IAction[] = [];
		const secondaryActions: IAction[] = [];
		const submenuDescriptors = new Set<SubmenuDescriptor>();
		for (const [group, actions] of this._editorTitleMenu.getActions()) {
			// Determine the target actions.
			const targetActions = this.isPrimaryGroup(group) ? primaryActions : secondaryActions;

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
			const target = this.isPrimaryGroup(group) ? primaryActions : secondaryActions;

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
				elements.push(<ActionBarActionButton action={action} />);
			} else if (action instanceof SubmenuAction) {
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
							iconId={iconId}
							text={iconId ? undefined : firstAction.label}
							ariaLabel={firstAction.label ?? firstAction.tooltip}
							dropdownAriaLabel={action.label ?? action.tooltip}
							align='left'
							tooltip={actionTooltip(
								this._contextKeyService,
								this._keybindingService,
								firstAction,
								false
							)}
							dropdownTooltip={actionTooltip(
								this._contextKeyService,
								this._keybindingService,
								action,
								false
							)}
							dropdownIndicator='enabled-split'
							actions={() => action.actions}
						/>
					);
				}
			}
		}

		// If we know whether we're in an auxiliary window, add the move into new window button.
		if (auxiliaryWindow !== undefined) {
			elements.push(
				<ActionBarCommandButton
					disabled={auxiliaryWindow}
					iconId='positron-open-in-new-window'
					tooltip={positronMoveIntoNewWindowTooltip}
					ariaLabel={positronMoveIntoNewWindowAriaLabel}
					commandId='workbench.action.moveEditorToNewWindow'
				/>
			);
		}

		// If there are secondary actions, add the more actions button. Note that the normal
		// dropdown arrow is hidden on this button because it uses the ··· icon.
		if (secondaryActions.length) {
			elements.push(
				<ActionBarMenuButton
					iconId='toolbar-more'
					ariaLabel={positronMoreActionsAriaLabel}
					align='left'
					tooltip={positronMoreActionsTooltip}
					dropdownIndicator='disabled'
					actions={() => secondaryActions}
				/>
			);
		}

		// Return the elements.
		return (
			<PositronActionBar
				size='small'
				borderTop={false}
				borderBottom={true}
				paddingLeft={PADDING_LEFT}
				paddingRight={PADDING_RIGHT}
			>
				<ActionBarRegion location='right'>
					{elements}
				</ActionBarRegion>
			</PositronActionBar>
		);
	}

	//#endregion Public Methods

	//#region Private Methods

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
