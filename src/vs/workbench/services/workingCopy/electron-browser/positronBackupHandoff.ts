/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { getWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkingCopyBackupService } from '../common/workingCopyBackup.js';
import { WorkingCopyBackupService } from '../common/workingCopyBackupService.js';
import { NativeWorkingCopyBackupTracker } from './workingCopyBackupTracker.js';

export const IPositronBackupHandoffService = createDecorator<IPositronBackupHandoffService>('positronBackupHandoffService');

/**
 * Moves this window's working copy backups to another workspace home in
 * place, as a Canvas folder switch does, without letting the source's
 * teardown or the eventual shutdown touch the destination's backups.
 */
export interface IPositronBackupHandoffService {
	readonly _serviceBrand: undefined;

	/**
	 * Move this window's backups to another workspace home without letting
	 * the source's teardown touch the destination: backup operations are
	 * suspended and pending ones cancelled, `closeSource` runs (its
	 * unregisters are ignored), in-flight I/O is joined, the backup service
	 * is re-homed, the tracker re-inventories the new home, operations
	 * resume. Resolves after the inventory is published; a failed inventory
	 * leaves the tracker not-ready (no discards this session) and is logged,
	 * not thrown.
	 */
	rehome(backupWorkspaceHome: URI | undefined, closeSource: () => Promise<void>): Promise<void>;
}

/**
 * Resolves the window's backup tracker. Injected so tests can hand over a
 * tracker they own; production reads the workbench contribution.
 */
export type BackupTrackerProvider = () => NativeWorkingCopyBackupTracker;

/**
 * Default `BackupTrackerProvider`: the registered workbench contribution.
 */
function getNativeBackupTracker(): NativeWorkingCopyBackupTracker {
	return getWorkbenchContribution<NativeWorkingCopyBackupTracker>(NativeWorkingCopyBackupTracker.ID);
}

/**
 * See `IPositronBackupHandoffService`.
 */
export class PositronBackupHandoffService implements IPositronBackupHandoffService {

	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly trackerProvider: BackupTrackerProvider,
		@IWorkingCopyBackupService private readonly workingCopyBackupService: IWorkingCopyBackupService,
		@ILogService private readonly logService: ILogService,
	) { }

	async rehome(backupWorkspaceHome: URI | undefined, closeSource: () => Promise<void>): Promise<void> {
		const tracker = this.resolveTracker();
		const suspension = tracker?.suspendForHandoff();

		try {
			// Source editors close while backups still address the source
			// home; with the tracker suspended their unregisters discard
			// nothing.
			await closeSource();

			if (this.workingCopyBackupService instanceof WorkingCopyBackupService) {
				await this.workingCopyBackupService.joinBackups();
				this.workingCopyBackupService.reinitialize(backupWorkspaceHome);
				await tracker?.reinitializeBackups();
			} else {
				this.logService.warn(`[backup handoff] backup service cannot be re-homed, only the source was closed`);
			}
		} finally {
			suspension?.resume();
		}
	}

	private resolveTracker(): NativeWorkingCopyBackupTracker | undefined {
		try {
			return this.trackerProvider();
		} catch (error) {
			this.logService.error(`[backup handoff] backup tracker unavailable, re-homing without an inventory refresh`, error);

			return undefined;
		}
	}
}

registerSingleton(IPositronBackupHandoffService, new SyncDescriptor(PositronBackupHandoffService, [getNativeBackupTracker], true));
