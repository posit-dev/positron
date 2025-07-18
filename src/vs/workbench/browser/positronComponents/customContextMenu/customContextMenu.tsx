/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './customContextMenu.css';

// React.
import React from 'react';

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
export type CustomContextMenuEntry = CustomContextMenuItem | CustomContextMenuSeparator;

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
 */
export const showCustomContextMenu = async ({
	anchorElement,
	anchorPoint,
	popupPosition,
	popupAlignment,
	width,
	minWidth,
	entries
}: CustomContextMenuProps) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		container: PositronReactServices.services.workbenchLayoutService.getContainer(DOM.getWindow(anchorElement)),
		parent: anchorElement
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
	 * Dismisses the  modal popup.
	 */
	const dismiss = () => {
		props.renderer.dispose();
	};

	/**
	 * MenuSeparator component.
	 * @returns The rendered component.
	 */
	const MenuSeparator = () => {
		// Render.
		return <div className='custom-context-menu-separator' />;
	};

	/**
	 * MenuItem component.
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
			<div className='custom-context-menu-items'>
				{props.entries.map((entry, index) => {
					if (entry instanceof CustomContextMenuItem) {
						return <MenuItem key={index} {...entry.options} />;
					} else if (entry instanceof CustomContextMenuSeparator) {
						return <MenuSeparator key={index} />;
					} else {
						// This indicates a bug.
						return null;
					}
				})}
			</div>
		</PositronModalPopup>
	);
};
