/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { usePositronReactServicesContext } from './positronReactRendererContext.js';
import { ContextKeyValue } from '../../platform/contextkey/common/contextkey.js';


/**
 * usePositronConfiguration hook.
 * @param key Configuration key to retrieve.
 * @param watch Whether to watch for changes. Default true.
 * @returns The configuration value.
 */
export const usePositronConfiguration = <T,>(key: string, watch: boolean = true): T => {
	const { configurationService } = usePositronReactServicesContext();
	const [value, setValue] = useState(() => configurationService.getValue<T>(key));

	useEffect(() => {
		if (!watch) {
			return;
		}
		const disposable = configurationService.onDidChangeConfiguration(e => {
			e.affectsConfiguration(key) && setValue(configurationService.getValue<T>(key));
		});
		return () => disposable.dispose();
	}, [configurationService, key, watch]);

	return value;
}

/**
 * usePositronContextKey hook.
 * @param key Context key to retrieve.
 * @param watch Whether to watch for changes. Default true.
 * @returns The context value.
 */
export const usePositronContextKey = <T extends ContextKeyValue,>(key: string, watch: boolean = true): T | undefined => {
	const { contextKeyService } = usePositronReactServicesContext();
	const [value, setValue] = useState(() => contextKeyService.getContextKeyValue<T>(key));

	useEffect(() => {
		if (!watch) {
			return;
		}
		const disposable = contextKeyService.onDidChangeContext(e => {
			const keySet = new Set([key]);
			e.affectsSome(keySet) && setValue(contextKeyService.getContextKeyValue<T>(key));
		});
		return () => disposable.dispose();
	}, [contextKeyService, key, watch]);

	return value;
}
