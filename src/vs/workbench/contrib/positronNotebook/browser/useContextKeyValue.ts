/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module
import * as React from 'react';
import { RawContextKey, ContextKeyValue, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * React hook that observes a context key value and re-renders when it changes.
 *
 * @param contextKeyService The scoped context key service to observe
 * @param key The RawContextKey to track
 * @returns The current value of the context key, or undefined if service is unavailable
 */
export function useContextKeyValue<T extends ContextKeyValue>(
	contextKeyService: IContextKeyService | undefined,
	key: RawContextKey<T>
): T | undefined {
	const [value, setValue] = React.useState<T | undefined>(() => {
		return contextKeyService ? key.getValue(contextKeyService) : undefined;
	});

	React.useEffect(() => {
		if (!contextKeyService) {
			return;
		}

		// Set initial value (in case service became available after initial render)
		setValue(key.getValue(contextKeyService));

		const keys = new Set([key.key]);
		const disposable = contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(keys)) {
				setValue(key.getValue(contextKeyService));
			}
		});

		return () => disposable.dispose();
	}, [contextKeyService, key]);

	return value;
}
