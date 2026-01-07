/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './DeletionSentinel.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IDeletionSentinel } from '../IPositronNotebookInstance.js';
import { ActionButton } from '../utilityComponents/ActionButton.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { POSITRON_NOTEBOOK_DELETION_SENTINEL_TIMEOUT_KEY } from '../positronNotebookExperimentalConfig.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';

interface DeletionSentinelProps {
	sentinel: IDeletionSentinel;
	commandService: ICommandService;
	configurationService: IConfigurationService;
}

export const DeletionSentinel: React.FC<DeletionSentinelProps> = ({
	sentinel,
	commandService,
	configurationService
}) => {
	const instance = useNotebookInstance();
	const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>();

	React.useEffect(() => {
		// Auto-dismiss after timeout (configured via settings)
		const timeout = configurationService.getValue<number>(POSITRON_NOTEBOOK_DELETION_SENTINEL_TIMEOUT_KEY) ?? 10000;

		if (timeout > 0) {
			timeoutRef.current = setTimeout(() => {
				instance.removeDeletionSentinel(sentinel.id);
			}, timeout);
		}

		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, [sentinel.id, instance, configurationService]);

	const handleUndo = async () => {
		// Clear timeout
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}

		// Trigger undo command
		await commandService.executeCommand('undo');

		// Remove sentinel
		instance.removeDeletionSentinel(sentinel.id);
	};

	const handleDismiss = () => {
		instance.removeDeletionSentinel(sentinel.id);
	};

	const cellType = sentinel.cellKind === CellKind.Code ? 'Code' : 'Markdown';

	return (
		<div className="deletion-sentinel positron-notebook-cell">
			<div className="deletion-sentinel-flash" />
			<div className="deletion-sentinel-content">
				{/* Left selection bar area */}
				<div className="deletion-sentinel-selection-bar" />

				{/* Main cell content */}
				<div className="deletion-sentinel-cell-container">
					{/* Header with cell info and actions */}
					<div className="deletion-sentinel-header">
						<span className="deletion-sentinel-message">
							{localize('notebook.cellDeleted', "{0} cell {1} deleted", cellType, sentinel.originalIndex + 1)}
						</span>
						<div className="deletion-sentinel-actions">
							<ActionButton
								ariaLabel={localize('notebook.undo', "Undo")}
								className="deletion-sentinel-undo"
								onPressed={handleUndo}
							>
								{localize('notebook.undo', "Undo")}
							</ActionButton>
							<ActionButton
								ariaLabel={localize('notebook.dismiss', "Dismiss")}
								className="deletion-sentinel-dismiss"
								onPressed={handleDismiss}
							>
								{localize('notebook.dismiss', "Dismiss")}
							</ActionButton>
						</div>
					</div>

					{/* Code preview - displayed as plain greyed-out text */}
					<div className="deletion-sentinel-code-preview">
						{sentinel.cellContent ? (
							<pre className="deletion-sentinel-code-text">
								{sentinel.cellContent}
							</pre>
						) : (
							<div className="empty-cell-placeholder">
								{localize('notebook.emptyCell', "(empty cell)")}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
};
