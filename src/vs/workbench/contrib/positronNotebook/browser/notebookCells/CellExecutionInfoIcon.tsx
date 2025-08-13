/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellExecutionInfoIcon.css';

// React.
import React, { useRef, useState, useCallback } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { useObservedValue } from '../useObservedValue.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';
import { CellExecutionInfoPopup } from './CellExecutionInfoPopup.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

interface CellExecutionInfoIconProps {
	cell: PositronNotebookCodeCell;
}


export function CellExecutionInfoIcon({ cell }: CellExecutionInfoIconProps) {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Reference hooks.
	const containerRef = useRef<HTMLDivElement>(null);

	// State hooks.
	const [popupRenderer, setPopupRenderer] = useState<PositronModalReactRenderer | null>(null);
	const [hoverTimeoutId, setHoverTimeoutId] = useState<number | null>(null);

	// Observed values for icon display (popup will observe its own values)
	const executionOrder = useObservedValue(cell.lastExecutionOrder);
	const lastRunSuccess = useObservedValue(cell.lastRunSuccess);
	const executionStatus = useObservedValue(cell.executionStatus);


	// Icon hover handlers
	const handleMouseEnter = useCallback(() => {
		if (!popupRenderer && containerRef.current) {
			const targetWindow = DOM.getWindow(containerRef.current);
			const timeoutId = targetWindow.setTimeout(() => {
				const renderer = new PositronModalReactRenderer({
					container: services.workbenchLayoutService.getContainer(DOM.getWindow(containerRef.current!)),
					onDisposed: () => setPopupRenderer(null)
				});

				// Render the popup
				renderer.render(
					<CellExecutionInfoPopup
						anchorElement={containerRef.current!}
						autoCloseDelay={250}
						autoCloseOnMouseLeave={true}
						cell={cell}
						renderer={renderer}
					/>
				);

				setPopupRenderer(renderer);
			}, 250); // 250ms delay for even faster response

			setHoverTimeoutId(timeoutId);
		}
	}, [services, cell, popupRenderer]);

	const handleMouseLeave = useCallback(() => {
		// Clear the hover timeout if we leave before the popup shows
		if (hoverTimeoutId !== null && containerRef.current) {
			const targetWindow = DOM.getWindow(containerRef.current);
			targetWindow.clearTimeout(hoverTimeoutId);
			setHoverTimeoutId(null);
		}
	}, [hoverTimeoutId]);

	// Show pending state if the cell has never been executed
	const showPending = executionOrder === undefined;

	// Determine the status class for styling
	let statusClass = 'cell-execution-info-icon';
	if (showPending) {
		statusClass += ' cell-execution-info-icon-pending';
	} else if (executionStatus === 'running') {
		statusClass += ' cell-execution-info-icon-running';
	} else if (lastRunSuccess === false) {
		statusClass += ' cell-execution-info-icon-failed';
	} else if (lastRunSuccess === true) {
		statusClass += ' cell-execution-info-icon-success';
	}

	// Determine status for test attribute
	let dataExecutionStatus = 'idle';
	if (showPending) {
		dataExecutionStatus = 'pending';
	} else if (executionStatus === 'running') {
		dataExecutionStatus = 'running';
	} else if (lastRunSuccess === false) {
		dataExecutionStatus = 'failed';
	} else if (lastRunSuccess === true) {
		dataExecutionStatus = 'success';
	}

	return (
		<div
			ref={containerRef}
			aria-busy={executionStatus === 'running'}
			aria-label='Cell execution info'
			className={statusClass}
			data-execution-order={executionOrder}
			data-execution-status={dataExecutionStatus}
			role='status'
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			{showPending ? (
				<span className='execution-order-badge'>-</span>
			) : executionStatus === 'running' ? (
				<span
				    aria-label='Cell is executing'
					className='execution-icon codicon codicon-sync codicon-modifier-spin'
					role='img'
				></span>
			) : (
				<span className='execution-order-badge'>{String(executionOrder)}</span>
			)}
		</div>
	);
}
