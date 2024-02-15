/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnEntry';

// React.
import * as React from 'react';
import { CSSProperties } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DummyColumnInfo } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/columnsPanel';

/**
 * ColumnEntryProps interface.
 */
interface ColumnEntryProps {
	dummyColumnInfo: DummyColumnInfo;
	style: CSSProperties;
}

/**
 * ColumnEntry component.
 * @param props A ColumnEntryProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnEntry = (props: ColumnEntryProps) => {
	return (
		<div className='column-entry' key={props.dummyColumnInfo.key} style={props.style}>
			<div className='title'>{props.dummyColumnInfo.name}</div>
		</div>
	);
};
