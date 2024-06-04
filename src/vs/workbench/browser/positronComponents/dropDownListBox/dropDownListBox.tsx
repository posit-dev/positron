/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dropDownListBox';

// React.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { PositronModalPopup } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { DropDownListBoxSeparator } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxSeparator';

/**
 * DropDownListBoxEntry type.
 */
export type DropDownListBoxEntry<T extends NonNullable<any>, V extends NonNullable<any>> = DropDownListBoxItem<T, V> | DropDownListBoxSeparator;

/**
 * DropDownListBoxProps interface.
 */
interface DropDownListBoxProps<T extends NonNullable<any>, V extends NonNullable<any>> {
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	className?: string;
	disabled?: boolean;
	title: string;
	entries: DropDownListBoxEntry<T, V>[];
	createItem?: (dropDownListBoxItem: DropDownListBoxItem<T, V>) => JSX.Element;
	selectedIdentifier?: T;
	onSelectionChanged: (dropDownListBoxItem: DropDownListBoxItem<T, V>) => void;
}

/**
 * Finds a drop down list box item by identifier.
 * @param entries The set of drop down list box entries.
 * @param identifier The identifier of the drop down list box item to find.
 * @returns The drop down list box item, if it was found; otherwise, undefined.
 */
const findDropDownListBoxItem = <T extends NonNullable<any>, V>(
	entries: DropDownListBoxEntry<T, V>[],
	identifier?: T | undefined
) => {
	// Find the drop down list box item.
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry instanceof DropDownListBoxItem && entry.options.identifier === identifier) {
			return entry;
		}
	}

	// The drop down list box item wasn't found.
	return undefined;
};

/**
 * DropDownListBox component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const DropDownListBox = <T extends NonNullable<any>, V,>(props: DropDownListBoxProps<T, V>) => {
	// Reference hooks.
	const ref = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [selectedDropDownListBoxItem, setSelectedDropDownListBoxItem] =
		useState<DropDownListBoxItem<T, V> | undefined>(
			findDropDownListBoxItem(props.entries, props.selectedIdentifier)
		);
	const [highlightedDropDownListBoxItem, setHighlightedDropDownListBoxItem] =
		useState<DropDownListBoxItem<T, V> | undefined>(undefined);

	// Updates the selected drop down list box item.
	useEffect(() => {
		setSelectedDropDownListBoxItem(findDropDownListBoxItem(
			props.entries,
			props.selectedIdentifier,
		));
	}, [props.entries, props.selectedIdentifier]);

	/**
	 * Gets the title to display.
	 * @returns The title to display.
	 */
	const Title = () => {
		if (!props.createItem) {
			if (highlightedDropDownListBoxItem) {
				return <span>{highlightedDropDownListBoxItem.options.title}</span>;
			} else if (selectedDropDownListBoxItem) {
				return <span>{selectedDropDownListBoxItem.options.title}</span>;
			}
		} else {
			if (highlightedDropDownListBoxItem) {
				return props.createItem(highlightedDropDownListBoxItem);
			} else if (selectedDropDownListBoxItem) {
				return props.createItem(selectedDropDownListBoxItem);
			}
		}

		return <span>{props.title}</span>;
	};

	// Render.
	return (
		<Button
			ref={ref}
			disabled={props.disabled}
			className={positronClassNames('drop-down-list-box', props.className)}
			onPressed={() => {
				// Create the renderer.
				const renderer = new PositronModalReactRenderer({
					keybindingService: props.keybindingService,
					layoutService: props.layoutService,
					container: props.layoutService.getContainer(DOM.getWindow(ref.current)),
					onDisposed: () => {
						setHighlightedDropDownListBoxItem(undefined);
						ref.current.focus();
					}
				});

				// Show the drop down list box modal popup.
				renderer.render(
					<DropDownListBoxModalPopup<T, V>
						renderer={renderer}
						anchorElement={ref.current}
						entries={props.entries}
						createItem={props.createItem}
						onItemHighlighted={dropDownListBoxItem =>
							setHighlightedDropDownListBoxItem(dropDownListBoxItem)
						}
						onItemSelected={dropDownListBoxItem => {
							setSelectedDropDownListBoxItem(dropDownListBoxItem);
							props.onSelectionChanged(dropDownListBoxItem);
						}}
					/>
				);
			}}
		>
			<div className='title'>
				<Title />
			</div>
			<div className='chevron' aria-hidden='true'>
				<div className='codicon codicon-chevron-down' />
			</div>
		</Button>
	);
};

/**
 * DropDownListBoxModalPopupProps interface.
 */
interface DropDownListBoxModalPopupProps<T, V> {
	renderer: PositronModalReactRenderer;
	anchorElement: HTMLElement;
	entries: DropDownListBoxEntry<T, V>[];
	createItem?: (dropDownListBoxItem: DropDownListBoxItem<T, V>) => JSX.Element;
	onItemHighlighted: (dropdownListBoxItem: DropDownListBoxItem<T, V>) => void;
	onItemSelected: (dropdownListBoxItem: DropDownListBoxItem<T, V>) => void;
}

/**
 * DropDownListBoxModalPopup component.
 * @param props The component properties.
 * @returns The rendered component.
 */
const DropDownListBoxModalPopup = <T, V,>(props: DropDownListBoxModalPopupProps<T, V>) => {
	// Render.
	return (
		<PositronModalPopup
			renderer={props.renderer}
			anchorElement={props.anchorElement}
			popupPosition='bottom'
			popupAlignment='left'
			minWidth={props.anchorElement.offsetWidth}
			width={'max-content'}
			height={'min-content'}
			keyboardNavigation='menu'
		>
			<div className='drop-down-list-box-items'>
				{props.entries.map((entry, index) => {
					if (entry instanceof DropDownListBoxItem) {
						return (
							<Button
								key={index}
								className='item'
								disabled={entry.options.disabled}
								onFocus={() => props.onItemHighlighted(entry)}
								onPressed={e => {
									props.renderer.dispose();
									props.onItemSelected(entry);
								}}
							>
								{props.createItem && props.createItem(entry)}
								{!props.createItem && (
									<>
										<div
											className={positronClassNames(
												'title',
												{ 'disabled': entry.options.disabled }
											)}
										>
											{entry.options.title}
										</div>
										{entry.options.icon &&
											<div
												className={positronClassNames(
													'icon',
													'codicon',
													`codicon-${entry.options.icon}`,
													{ 'disabled': entry.options.disabled }
												)}
												title={entry.options.title}
											/>
										}
									</>
								)
								}
							</Button>
						);
					} else if (entry instanceof DropDownListBoxSeparator) {
						return <div key={index} className='separator' />;
					} else {
						// This indicates a bug.
						return null;
					}
				})}
			</div>
		</PositronModalPopup>
	);
};
