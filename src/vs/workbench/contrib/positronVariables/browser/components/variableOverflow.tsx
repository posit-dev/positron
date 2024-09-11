/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./variableOverflow';

// React.
import * as React from 'react';
import { CSSProperties, MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import * as platform from 'vs/base/common/platform';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { usePositronVariablesContext } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesContext';
import { VerticalSplitter, VerticalSplitterResizeParams } from 'vs/base/browser/ui/positronComponents/splitters/verticalSplitter';
import { IVariableOverflow as IVariableOverflow } from 'vs/workbench/services/positronVariables/common/interfaces/variableOverflow';

/**
 * VariableOverflowProps interface.
 */
export interface VariableOverflowProps {
	nameColumnWidth: number;
	detailsColumnWidth: number;
	variableOverflow: IVariableOverflow;
	selected: boolean;
	focused: boolean;
	style: CSSProperties;
	onSelected: () => void;
	onDeselected: () => void;
	onBeginResizeNameColumn: () => VerticalSplitterResizeParams;
	onResizeNameColumn: (newNameColumnWidth: number) => void;
}

/**
 * VariableOverflow component.
 * @param props A VariableOverflowProps that contains the component properties.
 * @returns The rendered component.
 */
export const VariableOverflow = (props: VariableOverflowProps) => {
	/**
	 * Context hooks.
	 */
	const positronVariablesContext = usePositronVariablesContext();

	/**
	 * onMouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Handle the event.
		switch (e.button) {
			// Main button.
			case 0:
				if (props.selected && (platform.isMacintosh ? e.metaKey : e.ctrlKey)) {
					props.onDeselected();
				} else {
					props.onSelected();
				}
				break;

			// Secondary button.
			case 2:
				props.onSelected();
				break;
		}
	};

	// Create the class names.
	const classNames = positronClassNames(
		'variable-overflow',
		{
			'selected': props.selected
		},
		{
			'focused': props.focused
		}
	);

	// Format the value.
	const value = localize(
		'positron.moreValues',
		"{0} more values",
		props.variableOverflow.overflowValues.toLocaleString()
	);

	// Render.
	return (
		<div className={classNames} onMouseDown={mouseDownHandler} style={props.style}>
			<div className='name-column' style={{ width: props.nameColumnWidth, minWidth: props.nameColumnWidth }}>
				<div className='name-column-indenter' style={{ marginLeft: props.variableOverflow.indentLevel * 20 }}>
					<div className='name-value'>
						[...]
					</div>
				</div>
			</div>
			<VerticalSplitter
				configurationService={positronVariablesContext.configurationService}
				onBeginResize={props.onBeginResizeNameColumn}
				onResize={props.onResizeNameColumn}
			/>
			<div className='details-column' style={{ width: props.detailsColumnWidth - 6, minWidth: props.detailsColumnWidth - 6 }}>
				<div className='value'>
					{value}
				</div>
			</div>
		</div>
	);
};
