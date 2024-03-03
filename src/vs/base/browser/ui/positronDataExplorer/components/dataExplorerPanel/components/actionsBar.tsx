/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./actionsBar';

// React.
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
// import { DisposableStore } from 'vs/base/common/lifecycle';
// import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';

/**
 * ActionsBar component.
 * @returns The rendered component.
 */
export const ActionsBar = () => {
	const [lineCount, setLineCount] = useState(1);

	const lines: string[] = [];
	for (let i = 0; i < lineCount; i++) {
		lines.push(`Actions line ${i}`);
	}

	// Render.
	return (
		<div className='actions-bar' onClick={() => setLineCount(lineCount + 1)}>
			{lines.map((line, index) =>
				<div key={index}>{line}</div>
			)}
		</div>
	);
};
