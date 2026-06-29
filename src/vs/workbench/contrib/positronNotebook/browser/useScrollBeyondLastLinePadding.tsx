/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { useObservedValue } from './useObservedValue.js';
import { useNotebookInstance } from './NotebookInstanceProvider.js';

/**
 * Returns the paddingBlockEnd value (in pixels) needed to implement scroll-beyond-last-line
 * in the notebook cells container, matching VS Code's native notebook behavior. We rely on
 * padding to change the scrollable area because scrolling is handled by the browser in the
 * Positron Notebook Editor.
 *
 * Returns undefined when the setting is disabled so CSS controls the default bottom padding.
 */
export function useScrollBeyondLastLinePadding(
	configurationService: IConfigurationService,
): number | undefined {
	const { size } = useNotebookInstance();
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
