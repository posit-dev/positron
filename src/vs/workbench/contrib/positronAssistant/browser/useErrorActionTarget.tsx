/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useMemo, useState } from 'react';

// Other dependencies.
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { IErrorActionTarget, IErrorActionTargetService } from '../common/errorActionTargets.js';

/**
 * The contributed target selected in the ai.errorActions.target setting, kept
 * current as the setting and installed extensions change.
 * @returns The target, or undefined when errors should go to Posit Assistant.
 */
export function useErrorActionTarget(): IErrorActionTarget | undefined {
	const services = usePositronReactServicesContext();
	const errorActionTargetService = useMemo(() => services.get(IErrorActionTargetService), [services]);
	const [target, setTarget] = useState(() => errorActionTargetService.getConfiguredTarget());

	useEffect(() => {
		const disposable = errorActionTargetService.onDidChange(() => setTarget(errorActionTargetService.getConfiguredTarget()));
		return () => disposable.dispose();
	}, [errorActionTargetService]);

	return target;
}
