/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnSparkline';

// React.
import * as React from 'react';

// Other dependencies.
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { ColumnSparklineHistogram } from 'vs/workbench/services/positronDataExplorer/browser/components/columnSparklineHistogram';

/**
 * ColumnSparklineProps interface.
 */
interface ColumnSparklineProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ColumnSparkline component.
 * @param props A ColumnSparklineProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnSparkline = (props: ColumnSparklineProps) => {
	// Get the column histogram. If there is one, render it and return.
	const columnHistogram = props.instance.getColumnHistogram(props.columnIndex);
	if (columnHistogram) {
		return <ColumnSparklineHistogram columnHistogram={columnHistogram} />;
	}

	// Render nothing.
	return null;
};
