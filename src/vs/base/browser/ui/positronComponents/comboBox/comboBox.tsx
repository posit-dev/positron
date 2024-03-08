/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./comboBox';

// React.
import * as React from 'react';
import { useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { ComboBoxSeparator } from 'vs/base/browser/ui/positronComponents/comboBox/comboBoxSeparator';
import { ComboBoxItem, ComboBoxItemOptions } from 'vs/base/browser/ui/positronComponents/comboBox/comboBoxItem';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';

/**
 * Localized strings.
 */
const x = localize('positron.x', "X");
console.log(x);

/**
 * ComboBoxProps interface.
 */
interface ComboBoxProps {
	layoutService: ILayoutService;
	title: string;
	entries: (ComboBoxItem | ComboBoxSeparator)[];
}

/**
 * ComboBox component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ComboBox = (props: ComboBoxProps) => {
	// Reference hooks.
	const comboBoxRef = useRef<HTMLDivElement>(undefined!);

	/**
	 * onMouseDown handler.
	 */
	const mouseDownHandler = async () => {
		await showDropDownMenu();
	};

	/**
	 * Shows the drop down menu.
	 * @param options The drop down menu options.
	 * @returns A promise that resolves when the drop down menu is dismissed.
	 */
	const showDropDownMenu = async (): Promise<void> => {
		// Return a promise that resolves when the popup is done.
		return new Promise<void>(resolve => {
			// Get the container element for the anchor element.
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
				const dismiss = () => {
					positronModalReactRenderer.destroy();
					resolve();
				};

				/**
				 * MenuItem component.
				 * @param props A DropDownItemOptions that contains the component properties.
				 * @returns The rendered component.
				 */
				const MenuItem = (props: ComboBoxItemOptions) => {
					// Render.
					return (
						<Button
							className='item'
							disabled={props.disabled}
							onPressed={e => {
								dismiss();
								// HERE BRIAN props.onSelected(e);
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
						containerElement={containerElement}
						anchorElement={comboBoxRef.current}
						popupPosition='bottom'
						popupAlignment='left'
						minWidth={comboBoxRef.current.offsetWidth}
						width={'max-content'}
						height={'min-content'}
						onDismiss={dismiss}
					>
						<div className='combo-box-items'>
							{props.entries.map((entry, index) => {
								if (entry instanceof ComboBoxItem) {
									return <MenuItem key={index} {...entry.options} />;
								} else if (entry instanceof ComboBoxSeparator) {
									return <div className='separator' />;
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
	};

	// Render.
	return (
		<div ref={comboBoxRef} className='combo-box' onClick={async () => await mouseDownHandler()}>
			<div className='title'>{props.title}</div>
			<div className='chevron' aria-hidden='true'>
				<div className='codicon codicon-chevron-down' />
			</div>
		</div>
	);
};
