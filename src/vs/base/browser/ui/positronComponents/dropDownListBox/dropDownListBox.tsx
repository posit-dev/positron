/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dropDownListBox';

// React.
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { StopCommandsKeyEventProcessor } from 'vs/platform/stopCommandsKeyEventProcessor/browser/stopCommandsKeyEventProcessor';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';

/**
 * DropDownListBoxOptionProps interface.
 */
export interface DropDownListBoxOptionProps<T> {
	readonly value: T;
	readonly label: string;
	readonly icon?: string;
	readonly disabled?: boolean;
}

/**
 * DropDownListBoxOption class.
 */
export class DropDownListBoxOption<T> {
	/**
	 * Constructor.
	 * @param options A DropDownListBoxOptionProps that contains the drop down list box option properties.
	 */
	constructor(readonly props: DropDownListBoxOptionProps<T>) { }
}

/**
 * DropDownListBoxSeparator class.
 */
export class DropDownListBoxSeparator { }

/**
 * DropDownListBoxItem type.
 */
export type DropDownListBoxItem<T> = DropDownListBoxOption<T> | DropDownListBoxSeparator;

/**
 * DropDownListBoxProps interface.
 */
interface DropDownListBoxProps<T> {
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	className?: string;
	disabled?: boolean;
	title: string;
	items: DropDownListBoxItem<T>[];
	onValueChanged: (value: T) => void;
}

/**
 * DropDownListBox component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const DropDownListBox = <T,>(props: DropDownListBoxProps<T>) => {
	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [title, setTitle] = useState(props.title);
	const [selectedTitle, setSelectedTitle] = useState<string | undefined>(undefined);

	/**
	 * Shows the drop down.
	 * @returns A promise that resolves when the drop down is dismissed.
	 */
	const showDropDown = async (): Promise<void> => {
		// Show the drop down.
		const value = await new Promise<T | undefined>(resolve => {
			// Get the container element for the drop down element.
			const container = props.layoutService.getContainer(
				DOM.getWindow(buttonRef.current)
			);

			// Create the modal React renderer.
			const positronModalReactRenderer = new PositronModalReactRenderer({
				container,
				keyEventProcessor: new StopCommandsKeyEventProcessor({ ...props })
			});

			// The drop down modal popup component.
			const DropDownModalPopup = () => {
				/**
				 * Dismisses the popup.
				 */
				const dismiss = (selection: T | undefined) => {
					// Dispose of the modal popup.
					positronModalReactRenderer.dispose();

					// Clear the selected title.
					setSelectedTitle(undefined);

					// Focus the button so keyboard users do not lose their tab position.
					buttonRef.current.focus();

					// Resolve the promise.
					resolve(selection);
				};

				/**
				 * Separator component.
				 * @returns The rendered component.
				 */
				const Separator = () => {
					// Render.
					return <div className='separator' />;
				};

				/**
				 * Option component.
				 * @param props A DropDownListBoxOptionProps that contains the component properties.
				 * @returns The rendered component.
				 */
				const Option = (props: DropDownListBoxOptionProps<T>) => {
					// Render.
					return (
						<Button
							className='item'
							disabled={props.disabled}
							onFocus={() => {
								setSelectedTitle(props.label);
							}}
							onPressed={() => {
								setTitle(props.label);
								dismiss(props.value);
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
						containerElement={container}
						anchorElement={buttonRef.current}
						popupPosition='bottom'
						popupAlignment='left'
						minWidth={buttonRef.current.offsetWidth}
						width={'max-content'}
						height={'min-content'}
						keyboardNavigation='menu'
						onDismiss={() => dismiss(undefined)}
					>
						<div className='drop-down'>
							<div className='drop-down-list-box-items'>
								{props.items.map((entry, index) => {
									if (entry instanceof DropDownListBoxOption) {
										return <Option key={index} {...entry.props} />;
									} else if (entry instanceof DropDownListBoxSeparator) {
										return <Separator key={index} />;
									} else {
										// This indicates a bug.
										return null;
									}
								})}
							</div>
						</div>
					</PositronModalPopup>
				);
			};

			// Render the modal popup component.
			positronModalReactRenderer.render(<DropDownModalPopup />);
		});

		// If the user selected a value, call the onSelectionChanged callback.
		if (value) {
			props.onValueChanged(value);
		}
	};

	// Render.
	return (
		<Button
			ref={buttonRef}
			className={
				positronClassNames(
					'drop-down-list-box',
					props.className,
					{ 'disabled': props.disabled }
				)
			}
			onPressed={showDropDown}
		>
			<div className='title'>{selectedTitle ?? title}</div>
			<div className='chevron' aria-hidden='true'>
				<div className='codicon codicon-chevron-down' />
			</div>
		</Button>
	);
};
