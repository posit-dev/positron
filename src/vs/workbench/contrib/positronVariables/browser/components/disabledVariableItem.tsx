/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./disabledVariableItem';
import * as React from 'react';
import { CSSProperties } from 'react'; // eslint-disable-line no-duplicate-imports
import { VerticalSplitter, VerticalSplitterResizeParams } from 'vs/base/browser/ui/positronComponents/splitters/verticalSplitter';
import { IPositronVariablesInstance, PositronVariablesSorting } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesInstance';
import { IVariableItem } from 'vs/workbench/services/positronVariables/common/interfaces/variableItem';
import { formatSize } from 'vs/workbench/contrib/positronVariables/browser/components/variableItem';

/**
 * DisabledVariableItemProps interface.
 */
export interface DisabledVariableItemProps {
	nameColumnWidth: number;
	detailsColumnWidth: number;
	rightColumnVisible: boolean;
	variableItem: IVariableItem;
	style: CSSProperties;
	onBeginResizeNameColumn: () => VerticalSplitterResizeParams;
	onResizeNameColumn: (newNameColumnWidth: number) => void;
	positronVariablesInstance: IPositronVariablesInstance;
}

/**
 * DisabledVariableItem component.
 * @param props A DisabledVariableItemProps that contains the component properties.
 * @returns The rendered component.
 */
export const DisabledVariableItem = (props: DisabledVariableItemProps) => {

	/**
	 * RightColumn component.
	 * @returns The rendered component.
	 */
	const RightColumn = () => {
		if (props.rightColumnVisible) {
			if (props.positronVariablesInstance.sorting === PositronVariablesSorting.Name) {
				return (
					<div className='right-column'>
						<span>{props.variableItem.displayType}</span>
					</div>
				);
			} else {
				return (
					<div className='right-column'>
						<span>{formatSize(props.variableItem.size)}</span>
					</div>
				);
			}
		} else {
			return null;
		}
	};

	// Render.
	return (
		<div className={'variable-item disabled'} style={props.style}>
			<div className='name-column' style={{ width: props.nameColumnWidth, minWidth: props.nameColumnWidth }}>
				<div className='name-column-indenter' style={{ marginLeft: props.variableItem.indentLevel * 20 }}>
					<div className='gutter'>
						<div className='expand-collapse-area'></div>
					</div>
					<div className='name-value'>
						{props.variableItem.displayName}
					</div>
				</div>
			</div>
			<VerticalSplitter
				onBeginResize={props.onBeginResizeNameColumn}
				onResize={props.onResizeNameColumn}
			/>
			<div className='details-column' style={{ width: props.detailsColumnWidth - 6, minWidth: props.detailsColumnWidth - 6 }}>
				<div className='value'>
					{props.variableItem.displayValue}
				</div>
				<RightColumn />
			</div>
		</div>
	);
};
