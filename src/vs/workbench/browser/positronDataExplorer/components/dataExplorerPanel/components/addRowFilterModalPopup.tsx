/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./addRowFilterModalPopup';

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { DropDownListBox } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { DropDownListBoxSeparator } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxSeparator';
import { PositronModalPopup } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';

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
 * AddRowFilterModalPopupProps interface.
 */
interface AddRowFilterModalPopupProps {
	renderer: PositronModalReactRenderer;
	anchor: HTMLElement;
}

/**
 * AddRowFilterModalPopup component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const AddRowFilterModalPopup = (props: AddRowFilterModalPopupProps) => {
	// Render.
	return (
		<PositronModalPopup
			renderer={props.renderer}
			anchor={props.anchor}
			popupPosition='bottom'
			popupAlignment='left'
			minWidth={275}
			width={'max-content'}
			height={'min-content'}
			keyboardNavigation='dialog'
		>
			<div className='add-row-filter-modal-popup-body'>
				<DropDownListBox
					keybindingService={props.renderer.keybindingService}
					layoutService={props.renderer.layoutService}
					title='Select Column'
					entries={[
						new DropDownListBoxItem({
							identifier: Condition.CONDITION_IS_EMPTY,
							title: localize('positron.isEmpty', "is empty")
						}),
						new DropDownListBoxItem({
							identifier: Condition.CONDITION_IS_NOT_EMPTY,
							title: localize('positron.isNotEmpty', "is not empty")
						}),
						new DropDownListBoxSeparator(),
						new DropDownListBoxItem({
							identifier: Condition.CONDITION_IS_LESS_THAN,
							title: localize('positron.isLessThan', "is less than")
						}),
						new DropDownListBoxItem({
							identifier: Condition.CONDITION_IS_GREATER_THAN,
							title: localize('positron.isGreaterThan', "is greater than")
						}),
						new DropDownListBoxItem({
							identifier: Condition.CONDITION_IS_EXACTLY,
							title: localize('positron.isExactly', "is exactly")
						}),
						new DropDownListBoxItem({
							identifier: Condition.CONDITION_IS_BETWEEN,
							title: localize('positron.isBetween', "is between")
						}),
						new DropDownListBoxItem({
							identifier: Condition.CONDITION_IS_NOT_BETWEEN,
							title: localize('positron.isNotBetween', "is not between")
						})
					]}
					onSelectionChanged={identifier => console.log(`Select Column changed to ${identifier}`)}
				/>
				<Button className='solid button-apply-filter'>
					Apply Filter
				</Button>
			</div>
		</PositronModalPopup>
	);
};
