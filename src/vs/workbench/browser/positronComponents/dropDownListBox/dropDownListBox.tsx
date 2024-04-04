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
 * DropDownListBoxProps interface.
 */
interface DropDownListBoxProps {
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	className?: string;
	disabled?: boolean;
	title: string;
	entries: (DropDownListBoxItem | DropDownListBoxSeparator)[];
	selectedIdentifier?: string;
	onSelectionChanged: (identifier: string) => void;
}

/**
 * Finds a drop down list box item by identifier.
 * @param identifier The identifier of the drop down list box item to find.
 * @param entries The set of drop down list box entries.
 * @returns The drop down list box item, if it was found; otherwise, undefined.
 */
const findDropDownListBoxItem = (
	identifier: string | undefined,
	entries: (DropDownListBoxItem | DropDownListBoxSeparator)[]
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
export const DropDownListBox = (props: DropDownListBoxProps) => {
	// Reference hooks.
	const ref = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [selectedDropDownListBoxItem, setSelectedDropDownListBoxItem] =
		useState<DropDownListBoxItem | undefined>(
			findDropDownListBoxItem(props.selectedIdentifier, props.entries)
		);
	const [highlightedDropDownListBoxItem, setHighlightedDropDownListBoxItem] =
		useState<DropDownListBoxItem | undefined>(undefined);

	// Updates the selected drop down list box item.
	useEffect(() => {
		setSelectedDropDownListBoxItem(findDropDownListBoxItem(
			props.selectedIdentifier,
			props.entries
		));
	}, [props.entries, props.selectedIdentifier]);

	/**
	 * Gets the title to display.
	 * @returns The title to display.
	 */
	const titleToDisplay = () => {
		if (highlightedDropDownListBoxItem) {
			return highlightedDropDownListBoxItem.options.title;
		} else if (selectedDropDownListBoxItem) {
			return selectedDropDownListBoxItem.options.title;
		} else {
			return props.title;
		}
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
					<DropDownListBoxModalPopup
						renderer={renderer}
						anchor={ref.current}
						entries={props.entries}
						onItemHighlighted={dropDownListBoxItem =>
							setHighlightedDropDownListBoxItem(dropDownListBoxItem)
						}
						onItemSelected={dropDownListBoxItem => {
							setSelectedDropDownListBoxItem(dropDownListBoxItem);
							props.onSelectionChanged(dropDownListBoxItem.options.identifier);
						}}
					/>
				);
			}}
		>
			<div className='title'>{titleToDisplay()}</div>
			<div className='chevron' aria-hidden='true'>
				<div className='codicon codicon-chevron-down' />
			</div>
		</Button>
	);
};

/**
 * DropDownListBoxModalPopupProps interface.
 */
interface DropDownListBoxModalPopupProps {
	renderer: PositronModalReactRenderer;
	anchor: HTMLElement;
	entries: (DropDownListBoxItem | DropDownListBoxSeparator)[];
	onItemHighlighted: (dropdownListBoxItem: DropDownListBoxItem) => void;
	onItemSelected: (dropdownListBoxItem: DropDownListBoxItem) => void;
}

/**
 * DropDownListBoxModalPopup component.
 * @param props The component properties.
 * @returns The rendered component.
 */
const DropDownListBoxModalPopup = (props: DropDownListBoxModalPopupProps) => {
	// Render.
	return (
		<PositronModalPopup
			renderer={props.renderer}
			anchor={props.anchor}
			popupPosition='bottom'
			popupAlignment='left'
			minWidth={props.anchor.offsetWidth}
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
