/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./comboBox';

// React.
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { ComboBoxMenuSeparator } from 'vs/base/browser/ui/positronComponents/comboBox/comboBoxMenuSeparator';
import { ComboBoxMenuItem, ComboBoxMenuItemOptions } from 'vs/base/browser/ui/positronComponents/comboBox/comboBoxMenuItem';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';

/**
 * ComboBoxProps interface.
 */
interface ComboBoxProps {
	layoutService: ILayoutService;
	className?: string;
	disabled?: boolean;
	title: string;
	entries: (ComboBoxMenuItem | ComboBoxMenuSeparator)[];
	onSelectionChanged: (identifier: string) => void;
}

/**
 * ComboBox component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ComboBox = (props: ComboBoxProps) => {
	// Reference hooks.
	const comboBoxRef = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [title, setTitle] = useState(props.title);

	/**
	 * Shows the drop down menu.
	 * @param options The drop down menu options.
	 * @returns A promise that resolves when the drop down menu is dismissed.
	 */
	const showDropDownMenu = async (): Promise<void> => {
		// Show the dropdown menu.
		const identifier = await new Promise<string | undefined>(resolve => {
			// Get the container element for the combo box element.
			const containerElement = props.layoutService.getContainer(
				DOM.getWindow(comboBoxRef.current)
			);

			// Create the modal React renderer.
			const positronModalReactRenderer = new PositronModalReactRenderer(
				containerElement
			);

			// The modal popup component.
			const ModalPopup = () => {
				/**
				 * Dismisses the popup.
				 */
				const dismiss = (result: string | undefined) => {
					positronModalReactRenderer.dispose();
					comboBoxRef.current.focus();
					resolve(result);
				};

				/**
				 * MenuSeparator component.
				 * @returns The rendered component.
				 */
				const MenuSeparator = () => {
					// Render.
					return <div className='separator' />;
				};

				/**
				 * MenuItem component.
				 * @param props A ComboBoxMenuItemOptions that contains the component properties.
				 * @returns The rendered component.
				 */
				const MenuItem = (props: ComboBoxMenuItemOptions) => {
					// Render.
					return (
						<Button
							className='item'
							disabled={props.disabled}
							onPressed={e => {
								setTitle(props.label);
								dismiss(props.identifier);
							}}
						>
							<div
								className={positronClassNames(
									'title',
									{ 'disabled': props.disabled }
								)}
							>
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
						renderer={positronModalReactRenderer}
						containerElement={containerElement}
						anchorElement={comboBoxRef.current}
						popupPosition='bottom'
						popupAlignment='left'
						minWidth={comboBoxRef.current.offsetWidth}
						width={'max-content'}
						height={'min-content'}
						keyboardNavigation='menu'
						onDismiss={() => dismiss(undefined)}
					>
						<div className='combo-box-menu-items'>
							{props.entries.map((entry, index) => {
								if (entry instanceof ComboBoxMenuItem) {
									return <MenuItem key={index} {...entry.options} />;
								} else if (entry instanceof ComboBoxMenuSeparator) {
									return <MenuSeparator />;
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
			positronModalReactRenderer.render(<ModalPopup />);
		});

		// If the user selected an item, call the onSelectionChanged callback.
		if (identifier) {
			props.onSelectionChanged(identifier);
		}
	};

	// Render.
	return (
		<Button
			ref={comboBoxRef}
			className={
				positronClassNames(
					'combo-box',
					props.className,
					{ 'disabled': props.disabled }
				)
			}
			onPressed={showDropDownMenu}
		>
			<div className='title'>{title}</div>
			<div className='chevron' aria-hidden='true'>
				<div className='codicon codicon-chevron-down' />
			</div>
		</Button>
	);
};
