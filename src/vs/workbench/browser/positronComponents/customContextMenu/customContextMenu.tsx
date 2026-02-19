/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './customContextMenu.css';

// React.
import React, { useRef } from 'react';

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
import { AnchorPoint, PopupAlignment, PopupPosition, PositronModalPopup } from '../positronModalPopup/positronModalPopup.js';

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
	readonly anchorElement: HTMLElement;
	readonly anchorPoint?: AnchorPoint;
	readonly popupPosition: PopupPosition;
	readonly popupAlignment: PopupAlignment;
	readonly width?: number | 'auto';
	readonly minWidth?: number | 'auto';
	readonly entries: CustomContextMenuEntry[];
	readonly onClose?: () => void;
}

/**
 * Shows a custom context menu.
 * @param anchorElement The anchor element.
 * @param anchorPoint The anchor point.
 * @param popupPosition The popup position.
 * @param popupAlignment The popup alignment.
 * @param width The width.
 * @param minWidth The minimum width.
 * @param entries The context menu entries.
 * @param onClose The callback to call when the context menu is closed/disposed.
 */
export const showCustomContextMenu = ({
	anchorElement,
	anchorPoint,
	popupPosition,
	popupAlignment,
	width,
	minWidth,
	entries,
	onClose,
}: CustomContextMenuProps) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		container: PositronReactServices.services.workbenchLayoutService.getContainer(DOM.getWindow(anchorElement)),
		parent: anchorElement,
		onDisposed: onClose
	});

	// Supply the default width.
	if (!width) {
		width = 'auto';
	}

	// Supply the default min width.
	if (!minWidth) {
		minWidth = 'auto';
	}

	// Show the context menu popup.
	renderer.render(
		<CustomContextMenuModalPopup
			anchorElement={anchorElement}
			anchorPoint={anchorPoint}
			entries={entries}
			minWidth={minWidth}
			popupAlignment={popupAlignment}
			popupPosition={popupPosition}
			renderer={renderer}
			width={width}
		/>
	);
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
	readonly width: number | 'auto';
	readonly minWidth: number | 'auto';
	readonly entries: CustomContextMenuEntry[];
}

/**
 * CustomContextMenuModalPopup component.
 * @param props A CustomContextMenuModalPopupProps that contains the component properties.
 * @returns The rendered component.
 */
const CustomContextMenuModalPopup = (props: CustomContextMenuModalPopupProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	/**
	 * Dismisses the modal popup.
	 */
	const dismiss = () => {
		props.renderer.dispose();
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
		return <div className='custom-context-menu-separator' role='separator' />;
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
		if (options.commandId) {
			const keybinding = services.keybindingService.lookupKeybinding(options.commandId);
			if (keybinding) {
				let label = keybinding.getLabel();
				if (label) {
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
				onPressed={e => {
					dismiss();
					options.onWillSelect?.();
					if (options.commandId) {
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

		/**
		 * Opens the submenu (another custom context menu) positioned relative to this menu item.
		 */
		const openSubmenu = () => {
			if (options.disabled || !buttonRef.current) {
				return;
			}

			// Get the anchor point to position the submenu to the top right of the parent menu item.
			const rect = buttonRef.current.getBoundingClientRect();
			const anchorPoint: AnchorPoint = {
				clientX: rect.right,
				clientY: rect.top
			};

			// Show the submenu by creating a new custom context menu instance.
			// Use 'auto' positioning to let the popup system determine the best placement.
			showCustomContextMenu({
				anchorElement: buttonRef.current,
				anchorPoint,
				popupPosition: 'auto',
				popupAlignment: 'auto',
				// Evaluate the entries now to ensure things like the checked state is up to date when submenu opens.
				entries: options.entries(),
				onClose: () => {
					// When submenu closes, focus returns to parent menu item that opened the submenu.
					buttonRef.current?.focus();
				}
			});
		};

		/**
		 * Handles keyboard events for submenu navigation.
		 * ArrowRight opens the submenu, and ArrowLeft is handled by the parent menu to close the submenu.
		 *
		 * @param e The keyboard event.
		 */
		const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
			// Do nothing if the submenu item is disabled.
			if (options.disabled) {
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
