/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./profileBoolean';

// React.
import * as React from 'react';
import { useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { editorFontApplier } from 'vs/workbench/browser/editorFontApplier';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';

/**
 * ProfileBooleanProps interface.
 */
interface ProfileBooleanProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ProfileBoolean component.
 * @param props A ProfileStringProps that contains the component properties.
 * @returns The rendered component.
 */
export const ProfileBoolean = (props: ProfileBooleanProps) => {
	let stats: any = props.instance.getColumnSummaryStats(props.columnIndex)?.boolean_stats!;
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
				<div className='label'>True:</div>
				<div className='label'>False:</div>
			</div>
			<div className='values'>
				<div className='values-left'>
					<div className='value'>{nullCount}</div>
					<div className='value'>{stats.true_count}</div>
					<div className='value'>{stats.false_count}</div>
				</div>
			</div>
		</div>
	);
};
