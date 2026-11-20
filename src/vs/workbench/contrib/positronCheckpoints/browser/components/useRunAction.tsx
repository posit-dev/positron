/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { OperationResult } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { ICheckpointsMessageService } from '../checkpointsMessages.js';
import { runAction, RunActionCall, RunActionMode } from '../runAction.js';

/** `runAction` for React components, which have the services context instead of an accessor. */
export function useRunAction(): (mode: RunActionMode, call: RunActionCall) => Promise<OperationResult | undefined> {
	const services = usePositronReactServicesContext();
	return useCallback((mode, call) => runAction(services, mode, call), [services]);
}

/** The sentence on the status line of the view, updated when an action publishes a new one. */
export function useCheckpointsMessage(): string | undefined {
	const services = usePositronReactServicesContext();
	const [message, setMessage] = useState(() => services.get(ICheckpointsMessageService).message);

	useEffect(() => {
		const messageService = services.get(ICheckpointsMessageService);
		setMessage(messageService.message);
		const listener = messageService.onDidChangeMessage(() => setMessage(messageService.message));
		return () => listener.dispose();
	}, [services]);

	return message;
}
