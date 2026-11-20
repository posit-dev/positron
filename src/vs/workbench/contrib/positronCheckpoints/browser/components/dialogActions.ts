/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { UnsavedEditorsMode } from '../../../../services/positronCheckpoints/browser/unsavedEditorsGuard.js';
import { ICheckpointsEngineProxy, OperationResult } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';

/**
 * What the dialogs opened by `runAction` can do to the engine. `runAction` passes them in, so
 * the dialogs do not import it.
 */
export interface IDialogActions {
	/**
	 * Runs an engine call as an action of the view: the result is routed like any other. `mode`
	 * says how unsaved edits are treated, as for `runAction`: a call that can rewrite files uses
	 * `file-changing`, and one that neither reads nor writes files in the project uses `no-guard`.
	 */
	run(mode: UnsavedEditorsMode | 'no-guard', call: (engine: ICheckpointsEngineProxy) => Promise<OperationResult>): Promise<OperationResult | undefined>;

	/**
	 * Removes a recovery snapshot. After a removal, every view reads the state of the project
	 * again.
	 * @returns True when it was removed. On failure the view says the action could not finish.
	 */
	removeRecoverySnapshot(operationId: string): Promise<boolean>;
}
