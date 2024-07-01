/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./profileNumber';

// React.
import * as React from 'react';
import { useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { editorFontApplier } from 'vs/workbench/browser/editorFontApplier';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';

/**
 * ProfileNumberProps interface.
 */
interface ProfileNumberProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ProfileNumber component.
 * @param props A ProfileNumberProps that contains the component properties.
 * @returns The rendered component.
 */
export const ProfileNumber = (props: ProfileNumberProps) => {
	let stats: any = props.instance.getColumnSummaryStats(props.columnIndex)?.number_stats!;
	const nullCount = props.instance.getColumnNullCount(props.columnIndex);
	if (!stats) {
		stats = {};
	}

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Use the editor font.
		disposableStore.add(
			editorFontApplier(
				props.instance.configurationService,
				ref.current
			)
		);

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [props.instance.configurationService]);

	const statsEntries = [
		['NA', nullCount],
	];
	if (stats.mean) {
		statsEntries.push(['Mean', stats.mean]);
	}
	if (stats.median) {
		statsEntries.push(['Median', stats.median]);
	}
	if (stats.stdev) {
		statsEntries.push(['SD', stats.stdev]);
	}
	if (stats.min_value) {
		statsEntries.push(['Min', stats.min_value]);
	}
	if (stats.max_value) {
		statsEntries.push(['Max', stats.max_value]);
	}

	// Render.
	return (
		<div ref={ref} className='tabular-info'>
			<div className='labels'>
				{statsEntries.map((entry, index) => (
					<div key={index} className='label'>{entry[0]}</div>
				))}
			</div>
			<div className='values'>
				<div className='values-left'>
					{statsEntries.map((entry, index) => (
						<div key={index} className='value'>{entry[1]}</div>
					))}
				</div>
			</div>
		</div>
	);
};
