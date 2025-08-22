/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataGridScrollbarCorner.css';

// React.
import React, { useRef } from 'react';

// Other dependencies.
import * as nls from '../../../../nls.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';

/**
 * DataGridScrollbarCornerProps interface.
 */
interface DataGridScrollbarCornerProps {
	onClick: () => void;
}

/**
 * DataGridScrollbarCorner component.
 * @param props A DataGridScrollbarCornerProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridScrollbarCorner = (props: DataGridScrollbarCornerProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Ref for hover tooltip.
	const containerRef = useRef<HTMLDivElement>(undefined!);

	// Get hover manager from the instance.
	const hoverManager = context.instance.hoverManager;

	// Localized tooltip text.
	const tooltipText = nls.localize(
		'positronDataGrid.scrollToBottomRight',
		'Scroll to bottom-right'
	);

	// Render.
	return (
		<div
			ref={containerRef}
			className='data-grid-scrollbar-corner'
			style={{
				width: context.instance.scrollbarThickness,
				height: context.instance.scrollbarThickness
			}}
			title={!hoverManager ? tooltipText : undefined}
			onClick={props.onClick}
			onMouseLeave={hoverManager ? () => hoverManager.hideHover() : undefined}
			onMouseOver={hoverManager ? () => hoverManager.showHover(containerRef.current, tooltipText) : undefined}
		/>
	);
};
