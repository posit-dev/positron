/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./customContextMenu';

// React.
import * as React from 'react';

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { CustomContextMenuSeparator } from 'vs/workbench/browser/positronComponents/customContextMenu/customContextMenuSeparator';
import { AnchorPoint, PopupAlignment, PositronModalPopup } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';
import { CustomContextMenuItem, CustomContextMenuItemOptions } from 'vs/workbench/browser/positronComponents/customContextMenu/customContextMenuItem';

/**
 * CustomContextMenuEntry type.
 */
export type CustomContextMenuEntry = CustomContextMenuItem | CustomContextMenuSeparator;

/**
 * CustomContextMenuProps interface.
 */
export interface CustomContextMenuProps {
	readonly commandService: ICommandService;
	readonly keybindingService: IKeybindingService;
	readonly layoutService: ILayoutService;
	readonly anchorElement: HTMLElement;
	readonly anchorPoint?: AnchorPoint;
	readonly popupAlignment: PopupAlignment;
	readonly width: number;
	readonly entries: CustomContextMenuEntry[];
}

/**
 * Shows a custom context menu.
 * @param commandService The command service.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 * @param anchorElement The anchor element.
 * @param anchorPoint The anchor point.
 * @param popupAlignment The popup alignment.
 * @param width The width.
 * @param entries The context menu entries.
 */
export const showCustomContextMenu = async ({
	commandService,
	keybindingService,
	layoutService,
	anchorElement,
	anchorPoint,
	popupAlignment,
	width,
	entries
}: CustomContextMenuProps) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService,
		layoutService,
		container: layoutService.getContainer(DOM.getWindow(anchorElement)),
		parent: anchorElement
	});

	// Show the context menu popup.
	renderer.render(
		<CustomContextMenuModalPopup
			commandService={commandService}
			keybindingService={keybindingService}
			renderer={renderer}
			anchorElement={anchorElement}
			anchorPoint={anchorPoint}
			popupAlignment={popupAlignment}
			width={width}
			entries={entries}
		/>
	);
};

/**
 * CustomContextMenuModalPopupProps interface.
 */
interface CustomContextMenuModalPopupProps {
	readonly commandService: ICommandService;
	readonly keybindingService: IKeybindingService;
	readonly renderer: PositronModalReactRenderer;
	readonly anchorElement: HTMLElement;
	readonly anchorPoint?: AnchorPoint;
	readonly popupAlignment: 'left' | 'right';
	readonly width: number;
	readonly entries: CustomContextMenuEntry[];
}

/**
 * CustomContextMenuModalPopup component.
 * @param props A CustomContextMenuModalPopupProps that contains the component properties.
 * @returns The rendered component.
 */
const CustomContextMenuModalPopup = (props: CustomContextMenuModalPopupProps) => {
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
			const keybinding = props.keybindingService.lookupKeybinding(options.commandId);
			if (keybinding) {
				const label = keybinding.getLabel();
				if (label) {
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
						props.commandService.executeCommand(options.commandId);
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
			renderer={props.renderer}
			anchorElement={props.anchorElement}
			anchorPoint={props.anchorPoint}
			popupPosition='bottom'
			popupAlignment={props.popupAlignment}
			minWidth={props.width}
			width={'max-content'}
			height={'min-content'}
			keyboardNavigation='menu'
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
