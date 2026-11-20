/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICheckpointsEngineProxy, OperationResult } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';

/**
 * What the dialogs opened by `runAction` can do to the engine. `runAction` passes them in, so
 * the dialogs do not import it.
 */
export interface IDialogActions {
	/** Runs an engine call as an action of the view: the result is routed like any other. */
	run(call: (engine: ICheckpointsEngineProxy) => Promise<OperationResult>): Promise<OperationResult | undefined>;

	/**
	 * Removes a recovery snapshot.
	 * @returns True when it was removed. On failure the view says the action could not finish.
	 */
	removeRecoverySnapshot(operationId: string): Promise<boolean>;
}
