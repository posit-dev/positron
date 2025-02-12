/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './variableOverflow.css';

// React.
import React, { CSSProperties, MouseEvent } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import * as platform from '../../../../../base/common/platform.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';
import { VerticalSplitter, VerticalSplitterResizeParams } from '../../../../../base/browser/ui/positronComponents/splitters/verticalSplitter.js';
import { IVariableOverflow as IVariableOverflow } from '../../../../services/positronVariables/common/interfaces/variableOverflow.js';

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
		<div className={classNames} style={props.style} onMouseDown={mouseDownHandler}>
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
