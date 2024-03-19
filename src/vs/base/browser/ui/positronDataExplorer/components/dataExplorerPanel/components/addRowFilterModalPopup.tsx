/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./addRowFilterModalPopup';

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { StopCommandsKeyEventProcessor } from 'vs/platform/stopCommandsKeyEventProcessor/browser/stopCommandsKeyEventProcessor';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { DropDownListBox, DropDownListBoxOption, DropDownListBoxSeparator } from 'vs/base/browser/ui/positronComponents/dropDownListBox/dropDownListBox';

/**
 * Condition enumeration.
 */
export enum Condition {
	CONDITION_IS_EMPTY = 'is-empty',
	CONDITION_IS_NOT_EMPTY = 'is-not-empty',
	CONDITION_IS_LESS_THAN = 'is-less-than',
	CONDITION_IS_GREATER_THAN = 'is-greater-than',
	CONDITION_IS_EXACTLY = 'is-exactly',
	CONDITION_IS_BETWEEN = 'is-between',
	CONDITION_IS_NOT_BETWEEN = 'is-not-between'
}

/**
 * Shows the add row filter modal popup.
 * @param options The add row filter modal popup options.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const addRowFilterModalPopup = async (options: {
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	anchorElement: HTMLElement;
}): Promise<void> => {
	// Return a promise that resolves when the popup is done.
	return new Promise<void>(resolve => {
		// Build the condition combo box items.
		const conditionItems = [
			new DropDownListBoxOption({
				value: Condition.CONDITION_IS_EMPTY,
				label: localize('positron.isEmpty', "is empty"),
			}),
			new DropDownListBoxOption({
				value: Condition.CONDITION_IS_NOT_EMPTY,
				label: localize('positron.isNotEmpty', "is not empty"),
			}),
			new DropDownListBoxSeparator(),
			new DropDownListBoxOption({
				value: Condition.CONDITION_IS_LESS_THAN,
				label: localize('positron.isLessThan', "is less than"),
			}),
			new DropDownListBoxOption({
				value: Condition.CONDITION_IS_GREATER_THAN,
				label: localize('positron.isGreaterThan', "is greater than"),
			}),
			new DropDownListBoxOption({
				value: Condition.CONDITION_IS_EXACTLY,
				label: localize('positron.isExactly', "is exactly"),
			}),
			new DropDownListBoxOption({
				value: Condition.CONDITION_IS_BETWEEN,
				label: localize('positron.isBetween', "is between"),
			}),
			new DropDownListBoxOption({
				value: Condition.CONDITION_IS_NOT_BETWEEN,
				label: localize('positron.isNotBetween', "is not between"),
			})
		];

		// Get the container for the anchor element.
		const container = options.layoutService.getContainer(
			DOM.getWindow(options.anchorElement)
		);

		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer({
			container,
			keyEventProcessor: new StopCommandsKeyEventProcessor(options)
		});

		/**
		 * onDismiss
		 */
		const dismissHandler = () => {
			renderer.dispose();
			resolve();
		};

		/**
		 * onValueChanged handler for filter condition.
		 * @param identifier
		 */
		const conditionValueChangedHandler = (identifier: string | undefined) => {
			console.log(`Select Condition changed to ${identifier}`);
		};

		/**
		 * onPressed handler.
		 */
		const pressedHandler = () => {
			renderer.dispose();
			resolve();
		};

		/**
		 * AddRowFilterModalPopup component.
		 * @returns The rendered component.
		 */
		const AddRowFilterModalPopup = () => {
			// Render.
			return (
				<PositronModalPopup
					renderer={renderer}
					containerElement={container}
					anchorElement={options.anchorElement}
					popupPosition='bottom'
					popupAlignment='left'
					minWidth={275}
					width={'max-content'}
					height={'min-content'}
					keyboardNavigation='dialog'
					onDismiss={dismissHandler}
				>
					<div className='add-row-filter-modal-popup-body'>
						<DropDownListBox<string>
							keybindingService={options.keybindingService}
							layoutService={options.layoutService}
							title='Select Condition'
							items={conditionItems}
							onValueChanged={conditionValueChangedHandler}
						/>

						{/*
						<ComboBox
							layoutService={layoutService}
							className='combo-box'
							searchable={true}
							title='Select Column'
							items={columnsComboBoxItemsProvider}
							onValueChanged={identifier => console.log(`Select Column changed to ${identifier}`)}
						/>
						*/}
						<Button className='solid button-apply-filter' onPressed={pressedHandler}>
							Apply Filter
						</Button>
					</div>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		renderer.render(<AddRowFilterModalPopup />);
	});
};
