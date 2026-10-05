/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useMemo } from 'react';

// Other dependencies.
import { Event } from '../../../../../../base/common/event.js';
import { usePositronDataExplorerContext } from '../../../positronDataExplorerContext.js';
import { DataExplorerClientStatus } from '../../../../../services/languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { ActivityStatus, ActivityStatusIndicator } from '../../../../positronComponents/activityStatusIndicator/activityStatusIndicator.js';

/**
 * Maps a data explorer client status to an activity status.
 */
function toActivityStatus(status: DataExplorerClientStatus): ActivityStatus {
	switch (status) {
		case DataExplorerClientStatus.Idle:
			return 'idle';
		case DataExplorerClientStatus.Computing:
			return 'computing';
		case DataExplorerClientStatus.Disconnected:
			return 'disconnected';
		case DataExplorerClientStatus.Error:
			return 'error';
	}
}

/**
 * StatusBarActivityIndicator component.
 * @returns The rendered component.
 */
export const StatusBarActivityIndicator = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();
	const client = context.instance.dataExplorerClientInstance;

	// The mapped event must keep its identity across renders, or the indicator resubscribes.
	const onDidChangeStatus = useMemo(() => Event.map(client.onDidStatusUpdate, toActivityStatus), [client]);

	// Render.
	return <ActivityStatusIndicator status={toActivityStatus(client.status)} onDidChangeStatus={onDidChangeStatus} />;
};
