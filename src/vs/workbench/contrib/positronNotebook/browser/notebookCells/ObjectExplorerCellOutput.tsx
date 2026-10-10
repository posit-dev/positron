/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useCallback, useState } from 'react';

// Other dependencies.
import { IOutputItemDto } from '../../../notebook/common/notebookCommon.js';
import { ParsedObjectExplorerOutput } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { InlineObjectExplorer } from '../../../../browser/positronObjectExplorer/inlineObjectExplorer.js';
import { CellTextOutput } from './CellTextOutput.js';

/**
 * Shows an inline object explorer, or the output's plain text when the object explorer comm is
 * unavailable (e.g. after the notebook was reopened).
 */
export const ObjectExplorerCellOutput = React.memo(function ObjectExplorerCellOutput({ parsed, outputs }: {
	parsed: ParsedObjectExplorerOutput;
	outputs: IOutputItemDto[];
}) {
	const [useFallback, setUseFallback] = useState(false);
	const handleFallback = useCallback(() => setUseFallback(true), []);

	if (useFallback) {
		const text = outputs.find(output => output.mime === 'text/plain');
		return <CellTextOutput
			content={text ? text.data.toString() : ''}
			outputScrolling={true}
			type='text'
			onShowFullOutput={() => { }}
		/>;
	}

	return <InlineObjectExplorer clearsOutputActions commId={parsed.commId} title={parsed.title} onFallback={handleFallback} />;
}, (prevProps, nextProps) =>
	prevProps.parsed.commId === nextProps.parsed.commId && prevProps.outputs === nextProps.outputs
);
