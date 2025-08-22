/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataGridCornerTopLeft.css';

// React.
import React, { useRef } from 'react';

// Other dependencies.
import * as nls from '../../../../nls.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';
import { VerticalSplitter } from '../../../../base/browser/ui/positronComponents/splitters/verticalSplitter.js';

/**
 * DataGridCornerTopLeftProps interface.
 */
interface DataGridCornerTopLeftProps {
	onClick: () => void;
}

/**
 * DataGridCornerTopLeft component.
 * @param props A DataGridCornerTopLeftProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridCornerTopLeft = (props: DataGridCornerTopLeftProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Ref for hover tooltip.
	const containerRef = useRef<HTMLDivElement>(undefined!);

	// Get hover manager from the instance.
	const hoverManager = context.instance.hoverManager;

	// Localized tooltip text.
	const tooltipText = nls.localize(
		'positronDataGrid.scrollToTopLeft',
		'Scroll to top-left'
	);

	// Render.
	return (
		<div
			ref={containerRef}
			className='data-grid-corner-top-left'
			title={!hoverManager ? tooltipText : undefined}
			onClick={props.onClick}
			onMouseLeave={hoverManager ? () => hoverManager.hideHover() : undefined}
			onMouseOver={hoverManager ? () => hoverManager.showHover(containerRef.current, tooltipText) : undefined}
		>
			<div className='border-overlay' />
			<VerticalSplitter
				onBeginResize={() => ({
					minimumWidth: 20,
					maximumWidth: context.instance.maximumColumnWidth,
					startingWidth: context.instance.rowHeadersWidth
				})}
				onResize={async width =>
					await context.instance.setRowHeadersWidth(width)
				}
			/>
		</div>
	);
};
