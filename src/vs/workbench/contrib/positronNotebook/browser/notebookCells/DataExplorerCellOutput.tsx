/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useState, useCallback } from 'react';

// Other dependencies.
import { IOutputItemDto } from '../../../notebook/common/notebookCommon.js';
import { ParsedDataExplorerOutput } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { parseOutputData } from '../getOutputContents.js';
import { renderHtml } from '../../../../../base/browser/positron/renderHtml.js';
import { InlineDataExplorer } from './InlineDataExplorer.js';
import { localize } from '../../../../../nls.js';

/**
 * Wrapper component for data explorer outputs that handles fallback to HTML
 * when the data explorer comm is unavailable (e.g. after notebook reload).
 *
 * Only rendered while the inline data explorer is enabled: when it is off the cell drops
 * the payload before parsing, so no output ever resolves to a data explorer.
 */
export const DataExplorerCellOutput = React.memo(function DataExplorerCellOutput({ parsed, outputs }: {
	parsed: ParsedDataExplorerOutput;
	outputs: IOutputItemDto[];
}) {
	const [useFallback, setUseFallback] = useState(false);

	const handleFallback = useCallback(() => {
		setUseFallback(true);
	}, []);

	if (useFallback) {
		const htmlOutput = outputs.find(o => o.mime === 'text/html');
		if (htmlOutput) {
			const htmlParsed = parseOutputData(htmlOutput);
			if (htmlParsed.type === 'html') {
				return renderHtml(htmlParsed.content);
			}
		}
		// Fallback was triggered but no HTML output is available.
		// Show an explicit message instead of re-rendering InlineDataExplorer
		// (which would loop back to loading/fallback indefinitely).
		return <div className='inline-data-explorer-error'>
			<span className='codicon codicon-warning' />
			{localize('dataUnavailableFallback', 'Data unavailable. Re-run cell to view.')}
		</div>;
	}

	return <InlineDataExplorer {...parsed} onFallback={handleFallback} />;
}, (prevProps, nextProps) => {
	// Custom comparison: only rerender if commId changes or outputs change
	return prevProps.parsed.commId === nextProps.parsed.commId &&
		prevProps.outputs === nextProps.outputs;
});
