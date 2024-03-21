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
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { ContextMenuSeparator } from 'vs/base/browser/ui/positronComponents/contextMenu/contextMenuSeparator';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { ContextMenuItem, ContextMenuItemOptions } from 'vs/base/browser/ui/positronComponents/contextMenu/contextMenuItem';
import { StopCommandsKeyEventProcessor } from 'vs/platform/stopCommandsKeyEventProcessor/browser/stopCommandsKeyEventProcessor';

/**
 * Shows a context menu.
 * @param options The context menu options.
 * @returns A promise that resolves when the context menu is dismissed.
 */
export const showContextMenu = async (
	keybindingService: IKeybindingService,
	layoutService: ILayoutService,
	anchor: HTMLElement,
	popupAlignment: 'left' | 'right',
	width: number,
	entries: (ContextMenuItem | ContextMenuSeparator)[]
): Promise<void> => {
	// Return a promise that resolves when the popup is done.
	return new Promise<void>(resolve => {
		// Get the container for the anchor.
		const container = layoutService.getContainer(
			DOM.getWindow(anchor)
		);

		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer({
			container,
			keyEventProcessor: new StopCommandsKeyEventProcessor({
				keybindingService,
				layoutService
			})
		});

		// The modal popup component.
		const ModalPopup = () => {
			/**
			 * Dismisses the popup.
			 */
			const dismiss = () => {
				renderer.dispose();
				resolve();
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
					renderer={renderer}
					container={container}
					anchor={anchor}
					popupPosition='bottom'
					popupAlignment={popupAlignment}
					minWidth={width}
					width={'max-content'}
					height={'min-content'}
					keyboardNavigation='menu'
					onDismiss={dismiss}
				>
					<div className='context-menu-items'>
						{entries.map((entry, index) => {
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

		// Render the modal popup component.
		renderer.render(<ModalPopup />);
	});
};
