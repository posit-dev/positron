/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./filterBar';

// React.
import * as React from 'react';
import { MouseEvent, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
// import { DisposableStore } from 'vs/base/common/lifecycle';
// import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';

/**
 * FilterBar component.
 * @returns The rendered component.
 */
export const FilterBar = () => {
	const [lineCount, setLineCount] = useState(1);

	const lines: string[] = [];
	for (let i = 0; i < lineCount; i++) {
		lines.push(`Filter bar line ${i}`);
	}

	const clickHandler = (e: MouseEvent<HTMLElement>) => {
		if (e.metaKey) {
			setLineCount(1);
		} else {
			setLineCount(lineCount => lineCount + 1);
		}
	};

	// Render.
	return (
		<div className='filter-bar' onClick={clickHandler}>
			{lines.map((line, index) =>
				<div key={index} style={{ height: 22 }}>{line}</div>
			)}
		</div>
	);
};
