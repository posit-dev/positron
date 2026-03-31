/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './customContextMenu.css';

// React.
import React, { useCallback, useEffect, useRef } from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { CustomContextMenuSeparator } from './customContextMenuSeparator.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { Button } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { PositronReactServices } from '../../../../base/browser/positronReactServices.js';
import { CustomContextMenuItem, CustomContextMenuItemOptions } from './customContextMenuItem.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { AnchorMode, AnchorPoint, PopupAlignment, PopupPosition, PositronModalPopup } from '../positronModalPopup/positronModalPopup.js';

// Constants.
const SUBMENU_HOVER_DELAY = 300;

/**
 * CustomContextMenuEntry type.
 */
export type CustomContextMenuEntry = CustomContextMenuItem | CustomContextMenuSeparator | CustomContextMenuSubmenu;

/**
 * CustomContextMenuSubmenuOptions interface.
 */
export interface CustomContextMenuSubmenuOptions {
	/**
	 * Optional icon to display before the label.
	 */
	readonly icon?: string;

	/**
	 * The label text for the submenu item.
	 */
	readonly label: string;

	/**
	 * Whether the submenu item is disabled.
	 */
	readonly disabled?: boolean;

	/**
	 * Function that returns the entries to display in the submenu. Evaluated when the submenu
	 * is opened to ensure properties like checked state are up to date in the submenu when it opens.
	 */
	readonly entries: () => CustomContextMenuEntry[];
}

/**
 * CustomContextMenuSubmenu class.
 */
export class CustomContextMenuSubmenu {
	/**
	 * Constructor.
	 * @param options A CustomContextMenuSubmenuOptions that contains the submenu options.
	 */
	constructor(readonly options: CustomContextMenuSubmenuOptions) {
	}
}

/**
 * CustomContextMenuProps interface.
 */
export interface CustomContextMenuProps {
	readonly isSubmenu?: boolean;
	readonly anchorElement: HTMLElement;
	readonly anchorPoint?: AnchorPoint;
	readonly popupPosition: PopupPosition;
	readonly popupAlignment: PopupAlignment;
	readonly anchorMode?: AnchorMode;
	readonly width?: number | 'auto';
	readonly minWidth?: number | 'auto';
	readonly entries: CustomContextMenuEntry[];
	readonly onClose?: () => void;
	/**
	 * Callback to dismiss parent menus in the hierarchy.
	 * When an item is selected, each menu calls dismiss() then onDismissParentMenus(),
	 * which chains up through parent menus.
	 */
	readonly onDismissParentMenus?: () => void;
}

/**
 * Shows a custom context menu.
 * @param isSubmenu Whether this context menu is a submenu.
 * @param anchorElement The anchor element.
 * @param anchorPoint The anchor point.
 * @param popupPosition The popup position.
 * @param popupAlignment The popup alignment.
 * @param width The width.
 * @param minWidth The minimum width.
 * @param entries The context menu entries.
 * @param onClose The callback to call when the context menu is closed/disposed.
 * @param onDismissParentMenus Callback to dismiss parent menus when an item is selected.
 * @returns The PositronModalReactRenderer for the custom context menu that can be disposed to close the context menu (and its submenu hierarchy).
 */
export const showCustomContextMenu = ({
	isSubmenu,
	anchorElement,
	anchorPoint,
	popupPosition,
	popupAlignment,
	anchorMode,
	width,
	minWidth,
	entries,
	onClose,
	onDismissParentMenus,
}: CustomContextMenuProps): PositronModalReactRenderer => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		allowPointerPassthrough: isSubmenu,
		container: PositronReactServices.services.workbenchLayoutService.getContainer(DOM.getWindow(anchorElement)),
		parent: anchorElement,
		onDisposed: onClose
	});

	// Supply the default width.
	if (width === undefined) {
		width = 'auto';
	}

	// Supply the default min width.
	if (minWidth === undefined) {
		minWidth = 'auto';
	}

	// Show the context menu popup.
	renderer.render(
		<CustomContextMenuModalPopup
			anchorElement={anchorElement}
			anchorMode={anchorMode}
			anchorPoint={anchorPoint}
			entries={entries}
			minWidth={minWidth}
			popupAlignment={popupAlignment}
			popupPosition={popupPosition}
			renderer={renderer}
			width={width}
			onDismissParentMenus={onDismissParentMenus}
		/>
	);

	// Return the renderer so callers can dispose it (and its submenu hierarchy).
	return renderer;
};

/**
 * CustomContextMenuModalPopupProps interface.
 */
interface CustomContextMenuModalPopupProps {
	readonly renderer: PositronModalReactRenderer;
	readonly anchorElement: HTMLElement;
	readonly anchorPoint?: AnchorPoint;
	readonly popupPosition: PopupPosition;
	readonly popupAlignment: PopupAlignment;
	readonly anchorMode?: AnchorMode;
	readonly width: number | 'auto';
	readonly minWidth: number | 'auto';
	readonly entries: CustomContextMenuEntry[];
	readonly onDismissParentMenus?: () => void;
}

/**
 * CustomContextMenuModalPopup component.
 * @param props A CustomContextMenuModalPopupProps that contains the component properties.
 * @returns The rendered component.
 */
const CustomContextMenuModalPopup = (props: CustomContextMenuModalPopupProps) => {
	// Services.
	const services = usePositronReactServicesContext();

	// The active submenu renderer.
	const activeSubmenuRendererRef = useRef<PositronModalReactRenderer | undefined>(undefined);

	/**
	 * Closes the active submenu.
	 */
	const closeActiveSubmenu = useCallback(() => {
		// If there is an active submenu, dispose it and clear the ref.
		if (activeSubmenuRendererRef.current !== undefined) {
			activeSubmenuRendererRef.current.dispose();
			activeSubmenuRendererRef.current = undefined;
		}
	}, []);

	/**
	 * Dismisses this modal popup.
	 */
	const dismiss = () => {
		props.renderer.dispose();
	};

	/**
	 * Dismisses this menu and the parent menus, if there are any.
	 * Called when an item is selected from a submenu.
	 */
	const dismissAllMenus = () => {
		dismiss();
		props.onDismissParentMenus?.();
	};

	/**
	 * MenuSeparator component.
	 *
	 * A component that renders a separator line between menu items.
	 * It is used to visually group related menu items together.
	 *
	 * @returns The rendered component.
	 */
	const MenuSeparator = () => {
		// Render.
		return (
			<div
				className='custom-context-menu-separator'
				role='separator'
				// When the mouse enters a menu separator, close the active submenu.
				onMouseEnter={closeActiveSubmenu}
			/>
		);
	};

	/**
	 * MenuItem component.
	 *
	 * A component that renders a single menu item in the context menu.
	 * It can display an optional icon, a label, and an optional checkmark for checkable items.
	 *
	 * @param options A CustomContextMenuItemOptions that contains the options.
	 * @returns The rendered component.
	 */
	const MenuItem = (options: CustomContextMenuItemOptions) => {
		// Get the shortcut, if there is a command ID.
		let shortcut = '';
		if (!!options.commandId) {
			const keybinding = services.keybindingService.lookupKeybinding(options.commandId);
			if (!!keybinding) {
				let label = keybinding.getLabel();
				if (!!label) {
					if (isMacintosh) {
						label = label.replace('⇧', '⇧ ');
						label = label.replace('⌥', '⌥ ');
						label = label.replace('⌘', '⌘ ');
					}
					shortcut = label;
				}
			}
		}

		// Render.
		return (
			<Button
				className={positronClassNames(
					'custom-context-menu-item',
					{ 'checkable': options.checked !== undefined }
				)}
				disabled={options.disabled}
				// When the mouse enters a menu item, close the active submenu.
				onMouseEnter={closeActiveSubmenu}
				onPressed={e => {
					// Ensure we close the menu and the parent menus when a menu item selection is made.
					dismissAllMenus();
					options.onWillSelect?.();
					if (options.commandId !== undefined) {
						services.commandService.executeCommand(options.commandId);
					}
					options.onSelected(e);
				}}
			>
				{options.checked !== undefined && options.checked &&
					<div
						className={`check codicon codicon-positron-check-mark`}
						title={options.label}
					/>
				}

				{options.icon &&
					<div
						className={positronClassNames(
							'icon',
							'codicon',
							`codicon-${options.icon}`,
							{ 'disabled': options.disabled }
						)}
						title={options.label}
					/>
				}

				<div
					className={positronClassNames(
						'title',
						{ 'disabled': options.disabled }
					)}
				>
					{options.label}
				</div>
				<div className='shortcut'>{shortcut}</div>
			</Button>
		);
	};

	/**
	 * MenuSubmenuItem component.
	 *
	 * A component that renders a menu item that opens a submenu when hovered or clicked.
	 * The submenu is another custom context menu that is positioned relative to the parent menu item.
	 *
	 * @param options A CustomContextMenuSubmenuOptions that contains the options.
	 * @returns The rendered component.
	 */
	const MenuSubmenuItem = (options: CustomContextMenuSubmenuOptions) => {
		// Reference to the submenu item that will be used to position the actual submenu popup.
		const buttonRef = useRef<HTMLButtonElement>(null);

		// The submenu renderer ref.
		const submenuRendererRef = useRef<PositronModalReactRenderer | undefined>(undefined);

		// Timer for the hover delay before opening a submenu. This prevents submenus from
		// flickering open and closed as the user moves the mouse through the menu vertically.
		const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

		/**
		 * Starts the hover timer to open the submenu after a delay.
		 */
		const startHoverTimer = () => {
			// Cancel pending hover timer.
			cancelHoverTimer();

			// Do nothing if the submenu item is disabled.
			if (options.disabled === true) {
				return;
			}

			// Start a new hover timer to open the submenu after a delay.
			hoverTimerRef.current = setTimeout(openSubmenu, SUBMENU_HOVER_DELAY);
		};

		/**
		 * Cancels the hover timer.
		 */
		const cancelHoverTimer = () => {
			// If there is a hover timer, cancel it and clear the ref.
			if (hoverTimerRef.current !== undefined) {
				clearTimeout(hoverTimerRef.current);
				hoverTimerRef.current = undefined;
			}
		};

		// Cancel hover timer on unmount.
		useEffect(() => cancelHoverTimer, []);

		/**
		 * Opens the submenu (another custom context menu) positioned relative to this menu item.
		 */
		const openSubmenu = () => {
			// Do nothing if the submenu item is disabled or if the button ref is not set yet.
			if (options.disabled || !buttonRef.current) {
				return;
			}

			// If this item's submenu is already the active one, return. Don't close and reopen it (which causes a flicker).
			if (submenuRendererRef.current !== undefined && submenuRendererRef.current === activeSubmenuRendererRef.current) {
				return;
			}

			// Close the active submenu before opening this submenu.
			closeActiveSubmenu();

			// Show the submenu by creating a new custom context menu instance.
			// We use 'avoid' anchor mode to position the submenu adjacent to the parent menu item,
			// instead of below the parent menu item so the parent menu item is not covered up.
			const renderer = showCustomContextMenu({
				isSubmenu: true,
				anchorElement: buttonRef.current,
				popupPosition: 'auto',
				popupAlignment: 'auto',
				anchorMode: 'avoid',
				// Evaluate the entries now to ensure things like the checked state is up to date when submenu opens.
				entries: options.entries(),
				// Passing down a function that will allow the submenu to dismiss the parent menus.
				onDismissParentMenus: dismissAllMenus,
				// On close, clear the submenu renderer ref.
				onClose: () => {
					submenuRendererRef.current = undefined;
				},
			});

			// Set the submenu renderer ref and the active submenu renderer ref to this submenu's renderer.
			submenuRendererRef.current = renderer;
			activeSubmenuRendererRef.current = renderer;
		};

		/**
		 * Handles keyboard events for submenu navigation.
		 * ArrowRight opens the submenu, and ArrowLeft is handled by the parent menu to close the submenu.
		 *
		 * @param e The keyboard event.
		 */
		const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
			// Cancel hover timer on keydown.
			cancelHoverTimer();

			// Do nothing if the submenu item is disabled.
			if (!!options.disabled) {
				return;
			}

			// Arrow Right opens the submenu.
			if (e.key === 'ArrowRight') {
				e.preventDefault();
				e.stopPropagation();
				openSubmenu();
			}
		};

		// Render.
		return (
			<Button
				ref={buttonRef}
				ariaHaspopup='menu'
				className='custom-context-menu-item'
				disabled={options.disabled}
				onKeyDown={handleKeyDown}
				onMouseEnter={startHoverTimer}
				onMouseLeave={cancelHoverTimer}
				onPressed={openSubmenu}
			>
				{options.icon &&
					<div
						aria-hidden='true'
						className={positronClassNames(
							'icon',
							'codicon',
							`codicon-${options.icon}`,
							{ 'disabled': options.disabled }
						)}
					/>
				}

				<div
					className={positronClassNames(
						'title',
						{ 'disabled': options.disabled }
					)}
				>
					{options.label}
				</div>

				<div
					aria-hidden='true'
					className={positronClassNames(
						'submenu-indicator',
						'codicon',
						'codicon-chevron-right',
						{ 'disabled': options.disabled }
					)}
				/>
			</Button>
		);
	};

	/**
	 * Handles keyboard events for the custom context menu.
	 *
	 * ArrowLeft support added to allow closing submenus which are context menus themselves.
	 * Without this, once a submenu is open, the user would have to use the mouse to close
	 * the submenu.
	 */
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			e.stopPropagation();
			dismiss();
		}
	};

	// Render.
	return (
		<PositronModalPopup
			anchorElement={props.anchorElement}
			anchorMode={props.anchorMode}
			anchorPoint={props.anchorPoint}
			height={'auto'}
			keyboardNavigationStyle='menu'
			minWidth={props.minWidth}
			popupAlignment={props.popupAlignment}
			popupPosition={props.popupPosition}
			renderer={props.renderer}
			width={props.width}
		>
			<div className='custom-context-menu-items' role='menu' onKeyDown={handleKeyDown}>
				{props.entries.map((entry, index) => {
					if (entry instanceof CustomContextMenuItem) {
						return <MenuItem key={index} {...entry.options} />;
					} else if (entry instanceof CustomContextMenuSeparator) {
						return <MenuSeparator key={index} />;
					} else if (entry instanceof CustomContextMenuSubmenu) {
						return <MenuSubmenuItem key={index} {...entry.options} />;
					} else {
						// This indicates a bug.
						return null;
					}
				})}
			</div>
		</PositronModalPopup>
	);
};
