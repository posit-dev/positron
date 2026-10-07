/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useMemo, useState } from 'react';

// Other dependencies.
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { IErrorActionHandler, IErrorActionsService } from '../common/errorActions.js';

/** The error action handler errors go to, and whether it can continue the current chat. */
export interface IConfiguredErrorActionHandler {
	readonly handler: IErrorActionHandler;
	readonly canContinueChat: boolean;
}

/**
 * The error action handler errors go to (the one selected in the
 * ai.errorActions.agent setting, or Posit Assistant), kept current as the
 * setting, registrations, and handlers' availability change.
 * @returns The handler, or undefined when there is nowhere to send errors.
 */
export function useErrorActionHandler(): IConfiguredErrorActionHandler | undefined {
	const services = usePositronReactServicesContext();
	const errorActionsService = useMemo(() => services.get(IErrorActionsService), [services]);
	const [configured, setConfigured] = useState(() => getConfigured(errorActionsService));

	useEffect(() => {
		const disposable = errorActionsService.onDidChange(() => setConfigured(getConfigured(errorActionsService)));
		return () => disposable.dispose();
	}, [errorActionsService]);

	return configured;
}

/** Snapshot the configured handler, so a change to either field re-renders. */
function getConfigured(errorActionsService: IErrorActionsService): IConfiguredErrorActionHandler | undefined {
	const handler = errorActionsService.getConfigured();
	return handler && { handler, canContinueChat: errorActionsService.canContinueChat(handler) };
}
