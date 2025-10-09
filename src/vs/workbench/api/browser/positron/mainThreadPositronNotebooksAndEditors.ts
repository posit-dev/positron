/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { diffMaps } from '../../../../base/common/collections.js';
import { IPositronNotebookInstance } from '../../../contrib/positronNotebook/browser/IPositronNotebookInstance.js';

/**
 * This module implements an alternative of MainThreadNotebooksAndEditors for IPositronNotebookInstance
 * instead of INotebookEditor. It connects Positron notebooks to the extension API without
 * having to implement the INotebookEditor interface.
 */

//#region MainThreadPositronNotebookInstancesStateComputer
/**
 * State of Positron notebook instances.
 */
export class PositronNotebookInstanceState {
	static delta(before: PositronNotebookInstanceState | undefined, after: PositronNotebookInstanceState): PositronNotebookInstanceStateDelta {
		if (!before) {
			return new PositronNotebookInstanceStateDelta(
				[], [...after.instances.values()],
				[...after.visibleInstances.values()],
				undefined, after.activeInstanceId,
			);
		}
		const instanceDelta = diffMaps(before.instances, after.instances);
		const oldActiveInstanceId = before.activeInstanceId !== after.activeInstanceId ? before.activeInstanceId : undefined;
		const newActiveInstanceId = before.activeInstanceId !== after.activeInstanceId ? after.activeInstanceId : undefined;
		const visibleInstanceDelta = diffMaps(before.visibleInstances, after.visibleInstances);
		const visibleInstances = visibleInstanceDelta.added.length === 0 && visibleInstanceDelta.removed.length === 0
			? undefined
			: [...after.visibleInstances.values()];
		return new PositronNotebookInstanceStateDelta(
			instanceDelta.removed,
			instanceDelta.added,
			visibleInstances,
			oldActiveInstanceId,
			newActiveInstanceId,
		);
	}

	constructor(
		readonly instances: Map<string, IPositronNotebookInstance>,
		readonly activeInstanceId: string | undefined | null,
		readonly visibleInstances: Map<string, IPositronNotebookInstance>
	) { }
}

/**
 * Delta of changes between two Positron notebook instance states.
 */
class PositronNotebookInstanceStateDelta {
	readonly isEmpty: boolean;

	constructor(
		readonly removedInstances: IPositronNotebookInstance[],
		readonly addedInstances: IPositronNotebookInstance[],
		readonly visibleInstances: IPositronNotebookInstance[] | undefined,
		readonly oldActiveInstanceId: string | null | undefined,
		readonly newActiveInstanceId: string | null | undefined,
	) {
		this.isEmpty = addedInstances.length === 0 &&
			removedInstances.length === 0 &&
			(visibleInstances === undefined || visibleInstances.length === 0) &&
			oldActiveInstanceId === newActiveInstanceId;
	}
}
