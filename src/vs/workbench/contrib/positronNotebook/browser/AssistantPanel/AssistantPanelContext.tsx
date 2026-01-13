/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { INotebookCellDTO, INotebookContextDTO } from '../../../../api/common/positron/extHost.positron.protocol.js';

/**
 * AssistantPanelContextProps interface.
 */
export interface AssistantPanelContextProps {
	context: INotebookContextDTO | undefined;
	isLoading: boolean;
}

/**
 * AssistantPanelContext component.
 * Displays notebook cell information with expand/collapse functionality.
 */
export const AssistantPanelContext = (props: AssistantPanelContextProps) => {
	const { context, isLoading } = props;
	const [isExpanded, setIsExpanded] = useState(false);

	const getCellSummary = (): string => {
		if (isLoading) {
			return localize('assistantPanel.context.loading', 'Loading...');
		}
		if (!context || !context.allCells || context.allCells.length === 0) {
			return localize('assistantPanel.context.noCells', 'No cells included');
		}
		const count = context.allCells.length;
		if (count === context.cellCount) {
			return localize('assistantPanel.context.allCells', 'All {0} cells included', count);
		}
		return localize('assistantPanel.context.someCells', '{0} cells included', count);
	};

	const formatCellType = (cell: INotebookCellDTO): string => {
		return cell.type === 'code' ? 'code' : 'markdown';
	};

	const renderCellList = () => {
		if (!context?.allCells || context.allCells.length === 0) {
			return (
				<div className='assistant-panel-context-empty'>
					{localize('assistantPanel.context.emptyHelp',
						'No notebook cells to include. Add cells to your notebook to provide context for the assistant.')}
				</div>
			);
		}

		return (
			<div className='assistant-panel-context-expanded'>
				{context.allCells.map((cell) => (
					<div key={cell.id} className='assistant-panel-context-cell'>
						{localize('assistantPanel.context.cellItem', 'Cell {0} ({1})',
							cell.index + 1,
							formatCellType(cell)
						)}
					</div>
				))}
			</div>
		);
	};

	return (
		<div className='assistant-panel-section'>
			<div className='assistant-panel-section-header'>
				{localize('assistantPanel.context.header', 'What Assistant Can See')}
			</div>
			<div className='assistant-panel-section-content'>
				<button
					className='assistant-panel-context-summary'
					onClick={() => setIsExpanded(!isExpanded)}
				>
					<span className={`expand-icon codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`} />
					<span>{getCellSummary()}</span>
				</button>
				{isExpanded && renderCellList()}
			</div>
		</div>
	);
};
