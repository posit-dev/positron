/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

export type ValidatorFn = (value: string | number) => string | undefined;

/**
 * A hook to debounce the validation of input values.
 */
export function useDebouncedValidator({ validator, value, debounceDelayMs = 100 }: { validator?: ValidatorFn; value: string | number; debounceDelayMs?: number }) {
	const [errorMsg, setErrorMsg] = React.useState<string | undefined>(undefined);

	const callbackTimeoutRef = React.useRef<NodeJS.Timeout | undefined>();

	const clearCallbackTimeout = React.useCallback(() => {
		if (!callbackTimeoutRef.current) { return; }
		clearTimeout(callbackTimeoutRef.current);
	}, []);

	React.useEffect(() => {
		if (!validator) { return; }

		clearCallbackTimeout();

		callbackTimeoutRef.current = setTimeout(() => {
			setErrorMsg(validator(value));
		}, debounceDelayMs);

		return clearCallbackTimeout;
	}, [clearCallbackTimeout, validator, value, debounceDelayMs]);

	return errorMsg;
}

