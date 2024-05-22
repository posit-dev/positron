/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./contextMenu';

// React.
import * as React from 'react';

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ContextMenuSeparator } from 'vs/workbench/browser/positronComponents/contextMenu/contextMenuSeparator';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { ContextMenuItem, ContextMenuItemOptions } from 'vs/workbench/browser/positronComponents/contextMenu/contextMenuItem';
import { PopupAlignment, PopupPosition, PositronModalPopup } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';

/**
 * ContextMenuEntry type.
 */
export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

/**
 * ContextMenuProps interface.
 */
export interface ContextMenuProps {
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	anchor: HTMLElement;
	popupPosition: PopupPosition;
	popupAlignment: PopupAlignment;
	width?: number | 'max-content' | 'auto';
	minWidth?: number | 'auto';
	entries: ContextMenuEntry[];
}

/**
 * Shows a context menu.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 * @param anchor The anchor element.
 * @param popupPosition The popup position.
 * @param popupAlignment The popup alignment.
 * @param width The width of the context menu.
 * @param minWidth The minimum width of the context menu.
 * @param entries The context menu entries.
 */
export const showContextMenu = async ({
	keybindingService,
	layoutService,
	anchor,
	popupPosition,
	popupAlignment,
	width,
	minWidth,
	entries
}: ContextMenuProps) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService,
		layoutService,
		container: layoutService.getContainer(DOM.getWindow(anchor)),
		parent: anchor
	});

	// Supply the default width.
	if (!width) {
		width = 'max-content';
	}

	// Supply the default min width.
	if (!minWidth) {
		minWidth = 'auto';
	}

	// Show the context menu popup.
	renderer.render(
		<ContextMenuModalPopup
			renderer={renderer}
			anchor={anchor}
			popupPosition={popupPosition}
			popupAlignment={popupAlignment}
			width={width}
			minWidth={minWidth}
			entries={entries}
		/>
	);
};

/**
 * ContextMenuModalPopupProps interface.
 */
interface ContextMenuModalPopupProps {
	renderer: PositronModalReactRenderer;
	anchor: HTMLElement;
	popupPosition: PopupPosition;
	popupAlignment: PopupAlignment;
	width: number | 'max-content' | 'auto';
	minWidth: number | 'auto';
	entries: ContextMenuEntry[];
}

/**
 * ContextMenuModalPopup component.
 * @param props The component properties.
 * @returns The rendered component.
 */
const ContextMenuModalPopup = (props: ContextMenuModalPopupProps) => {
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
		return <div className='context-menu-separator' />;
	};

	/**
	 * MenuItem component.
	 * @param props A ContextMenuItemOptions that contains the component properties.
	 * @returns The rendered component.
	 */
	const MenuItem = (props: ContextMenuItemOptions) => {
		// Render.
		return (
			<Button
				className='context-menu-item'
				disabled={props.disabled}
				onPressed={e => {
					dismiss();
					props.onSelected(e);
				}}
			>
				{props.checked !== undefined && props.checked &&
					<div
						className={`check codicon codicon-positron-check-mark`}
						title={props.label}
					/>
				}
				<div
					className={positronClassNames(
						'title',
						{ 'disabled': props.disabled }
					)}
					style={{
						gridColumn: props.checked !== undefined ?
							'title / icon' :
							'check / icon'
					}}>
					{props.label}
				</div>
				{props.icon &&
					<div
						className={positronClassNames(
							'icon',
							'codicon',
							`codicon-${props.icon}`,
							{ 'disabled': props.disabled }
						)}
						title={props.label}
					/>
				}
			</Button>
		);
	};

	// Render.
	return (
		<PositronModalPopup
			renderer={props.renderer}
			anchor={props.anchor}
			popupPosition={props.popupPosition}
			popupAlignment={props.popupAlignment}
			width={props.width}
			minWidth={props.minWidth}
			height={'min-content'}
			keyboardNavigationStyle='menu'
		>
			<div className='context-menu-items'>
				{props.entries.map((entry, index) => {
					if (entry instanceof ContextMenuItem) {
						return <MenuItem key={index} {...entry.options} />;
					} else if (entry instanceof ContextMenuSeparator) {
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
