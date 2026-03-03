/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useRef } from 'react';
import { Delayer } from '../../../../../../base/common/async.js';
import { useDisposableEffect } from '../../useDisposableEffect.js';

export function useDelayer(createDelayer: () => Delayer<void>) {
	const delayerRef = useRef<Delayer<void> | undefined>(undefined);
	if (!delayerRef.current) {
		delayerRef.current = createDelayer();
	}

	// Dispose on unmount
	useDisposableEffect(() => delayerRef.current!, []);

	return delayerRef.current!;
}
