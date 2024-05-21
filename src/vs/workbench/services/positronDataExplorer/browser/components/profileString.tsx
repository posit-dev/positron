/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./profileString';

// React.
import * as React from 'react';
import { useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { editorFontApplier } from 'vs/workbench/browser/editorFontApplier';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';

/**
 * ProfileStringProps interface.
 */
interface ProfileStringProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ProfileString component.
 * @param props A ProfileStringProps that contains the component properties.
 * @returns The rendered component.
 */
export const ProfileString = (props: ProfileStringProps) => {
	let stats: any = props.instance.getColumnSummaryStats(props.columnIndex)?.string_stats!;
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

	// Render.
	return (
		<div ref={ref} className='tabular-info'>
			<div className='labels'>
				<div className='label'>NA</div>
				<div className='label'>Empty</div>
				<div className='label'>Unique:</div>
			</div>
			<div className='values'>
				<div className='values-left'>
					<div className='value'>{nullCount}</div>
					<div className='value'>{stats.num_empty}</div>
					<div className='value'>{stats.num_unique}</div>
				</div>
			</div>
		</div>
	);
};
