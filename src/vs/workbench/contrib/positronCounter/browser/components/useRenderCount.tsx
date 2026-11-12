/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useRef } from 'react';
import { localize } from '../../../../../nls.js';

/**
 * Counts how many times the calling component has rendered. Demo-only: it makes
 * selector-scoped re-renders visible in the Counter editor.
 */
export function useRenderCount(): number {
	const count = useRef(0);
	count.current++;
	return count.current;
}

/** Shows a component's render count. */
export const RenderCount = ({ renders }: { renders: number }) => (
	<span className='counter-render-count'>
		{localize('positron.counter.renders', "Renders: {0}", renders)}
	</span>
);
