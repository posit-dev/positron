/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useMemo, useState } from 'react';

// Other dependencies.
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { IErrorAssistantInfo, IErrorAssistantService } from '../common/errorAssistant.js';

/**
 * The active error assistant, which errors are sent to, kept current as it
 * changes.
 * @returns The assistant, or undefined when there is nowhere to send errors.
 */
export function useActiveErrorAssistant(): IErrorAssistantInfo | undefined {
	const services = usePositronReactServicesContext();
	const errorAssistantService = useMemo(() => services.get(IErrorAssistantService), [services]);
	const [assistant, setAssistant] = useState(() => errorAssistantService.activeAssistant);

	useEffect(() => {
		setAssistant(errorAssistantService.activeAssistant);
		const disposable = errorAssistantService.onDidChangeActiveAssistant(setAssistant);
		return () => disposable.dispose();
	}, [errorAssistantService]);

	return assistant;
}
