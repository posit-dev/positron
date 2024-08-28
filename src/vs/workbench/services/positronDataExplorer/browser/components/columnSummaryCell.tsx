/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnSummaryCell';

// React.
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { HoverPosition } from 'vs/base/browser/ui/hover/hoverWidget';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';
import { VectorHistogram } from 'vs/workbench/services/positronDataExplorer/browser/components/vectorHistogram';
import { ColumnProfileDate } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileDate';
import { ColumnProfileNumber } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileNumber';
import { ColumnProfileString } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileString';
import { VectorFrequencyTable } from 'vs/workbench/services/positronDataExplorer/browser/components/vectorFrequencyTable';
import { ColumnProfileBoolean } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileBoolean';
import { ColumnProfileDatetime } from 'vs/workbench/services/positronDataExplorer/browser/components/columnProfileDatetime';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { ColumnDisplayType, ColumnProfileType, ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { dataExplorerExperimentalFeatureEnabled } from 'vs/workbench/services/positronDataExplorer/common/positronDataExplorerExperimentalConfig';

/**
 * Constants.
 */
const SPARKLINE_WIDTH = 80;
const SPARKLINE_HEIGHT = 20;
const SPARKLINE_X_AXIS_HEIGHT = 0.5;

/**
 * ColumnSummaryCellProps interface.
 */
interface ColumnSummaryCellProps {
	hoverService: IHoverService;
	instance: TableSummaryDataGridInstance;
	columnSchema: ColumnSchema;
	columnIndex: number;
	onDoubleClick: () => void;
}

/**
 * ColumnSummaryCell component.
 * @param props A ColumnSummaryCellProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnSummaryCell = (props: ColumnSummaryCellProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Reference hooks.
	const dataTypeRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [mouseInside, setMouseInside] = useState(false);

	/**
	 * Determines whether summary stats is supported.
	 * @returns true, if summary stats is supported; otherwise, false.
	 */
	const isSummaryStatsSupported = () => {
		// Determine the summary stats support status.
		const columnProfilesFeatures = props.instance.getSupportedFeatures().get_column_profiles;
		const summaryStatsSupportStatus = columnProfilesFeatures.supported_types.find(status =>
			status.profile_type === ColumnProfileType.SummaryStats
		);

		// If the summary status support status is undefined, return false.
		if (!summaryStatsSupportStatus) {
			return false;
		}

		// Return the summary stats support status.
		return dataExplorerExperimentalFeatureEnabled(
			summaryStatsSupportStatus.support_status,
			props.instance.configurationService
		);
	};

	/**
	 * ColumnSparkline component.
	 * @returns The rendered component.
	 */
	const ColumnSparkline = () => {
		// Render.
		switch (props.columnSchema.type_display) {
			// Column display types that render a histogram sparkline.
			case ColumnDisplayType.Number: {
				// Get the column histogram.
				const columnHistogram = props.instance.getColumnProfileSmallHistogram(props.columnIndex);
				if (!columnHistogram) {
					return null;
				}

				// Render the column sparkline.
				return (
					<div
						className='column-sparkline'
						style={{
							width: SPARKLINE_WIDTH,
							height: SPARKLINE_HEIGHT + SPARKLINE_X_AXIS_HEIGHT
						}}
					>
						<VectorHistogram
							graphWidth={SPARKLINE_WIDTH}
							graphHeight={SPARKLINE_HEIGHT}
							xAxisHeight={SPARKLINE_X_AXIS_HEIGHT}
							columnHistogram={columnHistogram}
						/>
					</div >
				);
			}

			// Column display types that render a frequency table sparkline.
			case ColumnDisplayType.Boolean:
			case ColumnDisplayType.String: {
				// Get the column frequency table.
				const columnFrequencyTable = props.instance.getColumnProfileSmallFrequencyTable(props.columnIndex);
				if (!columnFrequencyTable) {
					return null;
				}

				// Render the column sparkline.
				return (
					<div
						className='column-sparkline'
						style={{
							width: SPARKLINE_WIDTH,
							height: SPARKLINE_HEIGHT
						}}
					>
						<VectorFrequencyTable
							graphWidth={SPARKLINE_WIDTH}
							graphHeight={SPARKLINE_HEIGHT}
							xAxisHeight={SPARKLINE_X_AXIS_HEIGHT}
							columnFrequencyTable={columnFrequencyTable}
						/>
					</div >
				);
			}

			// Column display types that do not render a sparkline.
			case ColumnDisplayType.Date:
			case ColumnDisplayType.Datetime:
			case ColumnDisplayType.Time:
			case ColumnDisplayType.Object:
			case ColumnDisplayType.Array:
			case ColumnDisplayType.Struct:
			case ColumnDisplayType.Unknown:
				// Render nothing.
				return null;

			// This shouldn't ever happen.
			default:
				// Render nothing.
				return null;
		}
	};

	/**
	 * ColumnNullPercent component.
	 * @param props A ColumnNullPercentProps that contains the component properties.
	 * @returns The rendered component.
	 */
	const ColumnNullPercent = () => {
		// Set the null percent and graph null percent.
		let nullPercent = props.instance.getColumnProfileNullPercent(props.columnIndex);
		let graphNullPercent = nullPercent;
		if (nullPercent !== undefined) {
			if (nullPercent <= 0) {
				nullPercent = graphNullPercent = 0;
			} else if (nullPercent >= 100) {
				nullPercent = graphNullPercent = 100;
			} else {
				// Pin the graph null percent such that anything above 0% and below 5% reads as 5% and
				// anything below 100% above 95% reads as 95%.
				graphNullPercent = Math.min(Math.max(nullPercent, 5), 95);
			}
		}

		// Render.
		return (
			<div className='column-null-percent'>
				{nullPercent !== undefined &&
					<div className={positronClassNames('text-percent', { 'zero': nullPercent === 0 })}>
						{nullPercent}%
					</div>
				}
				<div className='graph-percent'>
					<svg viewBox='0 0 52 14' shapeRendering='geometricPrecision'>
						<defs>
							<clipPath id='clip-indicator'>
								<rect x='1' y='1' width='50' height='12' rx='6' ry='6' />
							</clipPath>
						</defs>
						{graphNullPercent === undefined ?
							<g>
								<rect className='empty'
									x='1'
									y='1'
									width='50'
									height='12'
									rx='6'
									ry='6'
									strokeWidth='1'
								/>
							</g> :
							<g>
								<rect className='background'
									x='1'
									y='1'
									width='50'
									height='12'
									rx='6'
									ry='6'
									strokeWidth='1'
								/>
								<rect className='indicator'
									x='1'
									y='1'
									width={50 * ((100 - graphNullPercent) / 100)}
									height='12'
									rx='6'
									ry='6'
									clipPath='url(#clip-indicator)'
								/>
							</g>
						}
					</svg>
				</div>
			</div >
		);
	};

	/**
	 * ColumnProfile component.
	 * @returns The rendered component.
	 */
	const ColumnProfile = () => {
		// Return the profile for the display type.
		switch (props.columnSchema.type_display) {
			// Number.
			case ColumnDisplayType.Number:
				return <ColumnProfileNumber instance={props.instance} columnIndex={props.columnIndex} />;

			// Boolean.
			case ColumnDisplayType.Boolean:
				return <ColumnProfileBoolean instance={props.instance} columnIndex={props.columnIndex} />;

			// String.
			case ColumnDisplayType.String:
				return <ColumnProfileString instance={props.instance} columnIndex={props.columnIndex} />;

			// Date.
			case ColumnDisplayType.Date:
				return <ColumnProfileDate instance={props.instance} columnIndex={props.columnIndex} />;

			// Datetime.
			case ColumnDisplayType.Datetime:
				return <ColumnProfileDatetime instance={props.instance} columnIndex={props.columnIndex} />;

			// Column display types that do not render a profile.
			case ColumnDisplayType.Time:
			case ColumnDisplayType.Object:
			case ColumnDisplayType.Array:
			case ColumnDisplayType.Struct:
			case ColumnDisplayType.Unknown:
				// Render nothing.
				return null;

			// This shouldn't ever happen.
			default:
				// Render nothing.
				return null;
		}
	};

	// Set the data type icon.
	const dataTypeIcon = (() => {
		// Determine the alignment based on type.
		switch (props.columnSchema.type_display) {
			// Number.
			case ColumnDisplayType.Number:
				return 'codicon-positron-data-type-number';

			// Boolean.
			case ColumnDisplayType.Boolean:
				return 'codicon-positron-data-type-boolean';

			// String.
			case ColumnDisplayType.String:
				return 'codicon-positron-data-type-string';

			// Date.
			case ColumnDisplayType.Date:
				return 'codicon-positron-data-type-date';

			// Datetime.
			case ColumnDisplayType.Datetime:
				return 'codicon-positron-data-type-date-time';

			// Time.
			case ColumnDisplayType.Time:
				return 'codicon-positron-data-type-time';

			// Object.
			case ColumnDisplayType.Object:
				return 'codicon-positron-data-type-object';

			// Array.
			case ColumnDisplayType.Array:
				return 'codicon-positron-data-type-array';

			// Struct.
			case ColumnDisplayType.Struct:
				return 'codicon-positron-data-type-struct';

			// Unknown.
			case ColumnDisplayType.Unknown:
				return 'codicon-positron-data-type-unknown';

			// This shouldn't ever happen.
			default:
				return 'codicon-question';
		}
	})();

	// Get the expanded state of the column.
	const expanded = props.instance.isColumnExpanded(props.columnIndex);

	// Set the summary stats supported flag.
	let summaryStatsSupported;
	switch (props.columnSchema.type_display) {
		case ColumnDisplayType.Number:
		case ColumnDisplayType.Boolean:
		case ColumnDisplayType.String:
		case ColumnDisplayType.Date:
		case ColumnDisplayType.Datetime:
			summaryStatsSupported = isSummaryStatsSupported();
			break;

		case ColumnDisplayType.Time:
		case ColumnDisplayType.Object:
		case ColumnDisplayType.Array:
		case ColumnDisplayType.Struct:
		case ColumnDisplayType.Unknown:
			summaryStatsSupported = false;
			break;

		// This shouldn't ever happen.
		default:
			summaryStatsSupported = false;
			break;
	}

	// Determine whether this is the cursor.
	const cursor = props.columnIndex === props.instance.cursorRowIndex;

	// Render.
	return (
		<div
			className='column-summary'
			onDoubleClick={props.onDoubleClick}
			onMouseEnter={() => setMouseInside(true)}
			onMouseLeave={() => setMouseInside(false)}
			onMouseDown={() => {
				props.instance.scrollToRow(props.columnIndex);
				props.instance.setCursorRow(props.columnIndex);
			}}
		>
			{(mouseInside || cursor) &&
				<div
					className={positronClassNames(
						'cursor',
						{ 'focused': context.instance.focused && cursor }
					)}
				/>
			}
			<div className='basic-info'>
				<div
					className={
						positronClassNames(
							'expand-collapse-button',
							{ 'disabled': !summaryStatsSupported }
						)
					}
					onClick={summaryStatsSupported ? () =>
						props.instance.toggleExpandColumn(props.columnIndex) : undefined
					}
				>
					{expanded ?
						<div className={`expand-collapse-icon codicon codicon-chevron-down`} /> :
						<div className={`expand-collapse-icon codicon codicon-chevron-right`} />
					}
				</div>
				<div
					ref={dataTypeRef}
					className={`data-type-icon codicon ${dataTypeIcon}`}
					onMouseOver={() =>
						props.hoverService.showHover({
							content: `${props.columnSchema.type_name}`,
							target: dataTypeRef.current,
							position: {
								hoverPosition: HoverPosition.ABOVE,
							},
							persistence: {
								hideOnHover: false
							},
							appearance: {
								showHoverHint: true,
								showPointer: true
							}
						}, false)
					}
					onMouseLeave={() => props.hoverService.hideHover()}
				/>
				<div className='column-name'>
					{props.columnSchema.column_name}
				</div>
				{!expanded && <ColumnSparkline />}
				<ColumnNullPercent />
			</div>
			{expanded && <ColumnProfile />}
		</div>
	);
};
