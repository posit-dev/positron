/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./comboBox';

// React.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';

/**
 * ComboBoxSeparator class.
 */
export class ComboBoxSeparator { }

/**
 * ComboBoxOptionProps interface.
 */
export interface ComboBoxOptionProps<T> {
	readonly value: T;
	readonly label: string;
	readonly icon?: string;
	readonly disabled?: boolean;
}

/**
 * ComboBoxOption class.
 */
export class ComboBoxOption<T> {
	/**
	 * Constructor.
	 * @param options A ComboBoxOptionProps that contains the combo box option properties.
	 */
	constructor(readonly props: ComboBoxOptionProps<T>) { }
}

/**
 * ComboBoxItem type.
 */
export type ComboBoxItem<T> = ComboBoxOption<T> | ComboBoxSeparator;

/**
 * ComboBoxItemsProvider type.
 */
export type ComboBoxItemsProvider<T> = (
	searchText: string | undefined,
	maxResults: number
) => Promise<ComboBoxItem<T>[]>;

/**
 * ComboBoxProps interface.
 */
interface ComboBoxProps<T> {
	layoutService: ILayoutService;
	className?: string;
	searchable?: boolean;
	disabled?: boolean;
	title: string;
	items: ComboBoxItem<T>[] | ComboBoxItemsProvider<T>;
	onValueChanged: (value: T) => void;
}

/**
 * ComboBox component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ComboBox = <T,>(props: ComboBoxProps<T>) => {
	// Reference hooks.
	const comboBoxRef = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [title, setTitle] = useState(props.title);
	const [selectedTitle, setSelectedTitle] = useState<string | undefined>(undefined);

	/**
	 * Shows the drop down.
	 * @returns A promise that resolves when the drop down is dismissed.
	 */
	const showDropDown = async (): Promise<void> => {
		// Show the drop down menu.
		const value = await new Promise<T | undefined>(resolve => {
			// Get the container element for the combo box element.
			const containerElement = props.layoutService.getContainer(
				DOM.getWindow(comboBoxRef.current)
			);

			// Create the modal React renderer.
			const positronModalReactRenderer = new PositronModalReactRenderer(
				containerElement
			);

			// The drop down modal popup component.
			const DropDownModalPopup = () => {
				// State effects.
				const [searchText, _setSearchText] = useState<string | undefined>(undefined);
				const [items, setItems] = useState<ComboBoxItem<T>[]>(
					Array.isArray(props.items) ? props.items : []
				);

				//
				useEffect(() => {
					if (Array.isArray(props.items)) {
						return;
					}

					const fetch = async () => {
						if (Array.isArray(props.items)) {
							return;

						}

						setItems(await props.items(searchText, 100));
					};

					fetch();

				}, [searchText]);

				// const items = useMemo(async () => {
				// 	if (Array.isArray(props.items)) {
				// 		return props.items;
				// 	}

				// 	// return await props.items(searchText, 100);
				// 	const yaya =  await props.items(searchText, 100);

				// 	return await yaya;
				// }, [searchText]);

				/**
				 * Dismisses the popup.
				 */
				const dismiss = (selection: T | undefined) => {
					// Dispose of the modal popup.
					positronModalReactRenderer.dispose();

					// Clear the selected title.
					setSelectedTitle(undefined);

					// Focus the combo box so keyboard users do not lose their tab position.
					comboBoxRef.current.focus();

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
				 * @param props A ComboBoxItemOptions that contains the component properties.
				 * @returns The rendered component.
				 */
				const Option = (props: ComboBoxOptionProps<T>) => {
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
						<div className='combo-box-items'>
							{items.map((entry, index) => {
								if (entry instanceof ComboBoxOption) {
									return <Option key={index} {...entry.props} />;
								} else if (entry instanceof ComboBoxSeparator) {
									return <Separator key={index} />;
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
			ref={comboBoxRef}
			className={
				positronClassNames(
					'combo-box',
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
