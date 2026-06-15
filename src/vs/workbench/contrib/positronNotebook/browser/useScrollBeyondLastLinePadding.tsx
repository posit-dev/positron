/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import { IObservable } from '../../../../base/common/observable.js';
import { ISize } from '../../../../base/browser/positronReactRenderer.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { useObservedValue } from './useObservedValue.js';

/**
 * Returns the paddingBottom value (in pixels) needed to implement scroll-beyond-last-line
 * in the notebook cells container, matching VS Code's native notebook behavior.
 *
 * Returns undefined when the setting is disabled so CSS controls the default bottom padding.
 */
export function useScrollBeyondLastLinePadding(
	configurationService: IConfigurationService,
	size: IObservable<ISize>,
): number | undefined {
	const { height } = useObservedValue(size);

	const [enabled, setEnabled] = React.useState(
		() => configurationService.getValue<boolean>('editor.scrollBeyondLastLine')
	);

	React.useEffect(() => {
		const disposable = configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.scrollBeyondLastLine')) {
				setEnabled(configurationService.getValue<boolean>('editor.scrollBeyondLastLine'));
			}
		});
		return () => disposable.dispose();
	}, [configurationService]);

	if (!enabled) {
		return undefined;
	}
	return Math.max(0, height - 50);
}
