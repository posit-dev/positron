/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getDurationString } from '../../../../base/common/date.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { INotebookExecutionService } from '../../notebook/common/notebookExecutionService.js';
import { NOTEBOOK_EXPERIMENTAL_SHOW_EXECUTION_INFO_KEY } from '../common/runtimeNotebookKernelConfig.js';

const CELL_STRING = localize('status.notebook.executionInfo.cell', 'cell');

/**
 * A status bar entry that displays information about the current notebook execution,
 * such as the total duration and number of cells executed.
 */
export class NotebookExecutionStatus extends Disposable {
	/** The ID of the status bar entry. */
	private static readonly _ID = 'status.notebook.executionInfo';

	/** The name of the status bar entry. */
	private static readonly _NAME = localize('status.notebook.executionInfo.name', 'Execution Info');

	/** Accessor for the status bar entry. */
	private readonly _entryAccessor: IStatusbarEntryAccessor;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@INotebookExecutionService private readonly _notebookExecutionService: INotebookExecutionService,
		@IStatusbarService private readonly _statusbarService: IStatusbarService,
	) {
		super();

		// Add the status bar entry.
		this._entryAccessor = this._register(this._statusbarService.addEntry({
			ariaLabel: '',
			name: NotebookExecutionStatus._NAME,
			text: '',
		}, NotebookExecutionStatus._ID, StatusbarAlignment.RIGHT));

		// Update the visibility when the configuration changes.
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(NOTEBOOK_EXPERIMENTAL_SHOW_EXECUTION_INFO_KEY)) {
				this.updateVisibility();
			}
		}));

		// Update the visibility initially.
		this.updateVisibility();

		this._register(this._notebookExecutionService.onDidStartNotebookCellsExecution(e => {
			const cellCountString = getCountString(e.cellHandles.length, CELL_STRING);
			const text = localize('status.notebook.executionInfo.startExecution', 'Executing {0}', cellCountString);
			this._entryAccessor.update({
				ariaLabel: text,
				name: NotebookExecutionStatus._NAME,
				text,
			});
		}));

		this._register(this._notebookExecutionService.onDidEndNotebookCellsExecution(e => {
			const cellCountString = getCountString(e.cellHandles.length, CELL_STRING);
			const durationString = getDurationString(e.duration, true);
			const text = localize('status.notebook.executionInfo.endExecution', 'Executed {0} in {1}', cellCountString, durationString);
			this._entryAccessor.update({
				ariaLabel: text,
				name: NotebookExecutionStatus._NAME,
				text,
			});
		}));
	}

	/**
	 * Update the visibility of the status bar entry based on the user's configuration.
	 */
	private updateVisibility(): void {
		const visible = this._configurationService.getValue<boolean>(NOTEBOOK_EXPERIMENTAL_SHOW_EXECUTION_INFO_KEY);
		this._statusbarService.updateEntryVisibility(NotebookExecutionStatus._ID, visible);
	}
}

/**
 * Format a count and unit for display.
 *
 * @param count The count to format.
 * @param unit The unit to format e.g. 'cell'.
 * @returns The formatted count e.g. '1 cell' or '2 cells'.
 */
function getCountString(count: number, unit: string): string {
	if (count === 1) {
		return `${count} ${unit}`;
	}
	return `${count} ${unit}s`;
}
