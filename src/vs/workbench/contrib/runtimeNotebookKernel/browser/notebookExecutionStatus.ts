/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getDurationString } from '../../../../base/common/date.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { NOTEBOOK_EXPERIMENTAL_SHOW_EXECUTION_INFO_KEY } from '../common/runtimeNotebookKernelServiceConfig.js';
import { RuntimeNotebookKernel } from './runtimeNotebookKernelService.js';

/**
 * A status bar entry that displays information about the current notebook execution,
 * such as the total duration and number of cells executed.
 */
export class NotebookExecutionStatus extends Disposable {
	/** The ID of the status bar entry. */
	private static readonly _ID = 'status.notebooks.executionInfo';

	/** The name of the status bar entry. */
	private static readonly _NAME = localize('status.notebooks.executionInfo.name', 'Execution Info');

	/** Accessor for the status bar entry. */
	private readonly _entryAccessor: IStatusbarEntryAccessor;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
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
	}

	/**
	 * Attach a runtime notebook kernel.
	 *
	 * @param kernel The runtime notebook kernel to attach.
	 * @returns A disposable that detaches the kernel when disposed.
	 */
	public attachKernel(kernel: RuntimeNotebookKernel): IDisposable {
		const disposables = this._register(new DisposableStore());

		// Update the text when an execution starts.
		disposables.add(kernel.onDidStartExecution(e => {
			const text = `Executing ${formatCount(e.cells.length, 'cell')}`
			this._entryAccessor.update({
				ariaLabel: text,
				name: NotebookExecutionStatus._NAME,
				text,
			});
		}));

		// Update the text when an execution ends.
		disposables.add(kernel.onDidEndExecution(e => {
			const text = `Executed ${formatCount(e.cells.length, 'cell')} ` +
				`in ${getDurationString(e.duration, true)}`;
			this._entryAccessor.update({
				ariaLabel: text,
				name: NotebookExecutionStatus._NAME,
				text,
			});
		}));

		return disposables;
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
function formatCount(count: number, unit: string): string {
	if (count === 1) {
		return `${count} ${unit}`;
	}
	return `${count} ${unit}s`;
}
