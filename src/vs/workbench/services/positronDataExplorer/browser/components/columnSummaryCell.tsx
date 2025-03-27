/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './columnSummaryCell.css';

// React.
import React, { useRef, useEffect } from 'react';

// Other dependencies.
import * as nls from '../../../../../nls.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { usePositronDataGridContext } from '../../../../browser/positronDataGrid/positronDataGridContext.js';
import { VectorHistogram } from './vectorHistogram.js';
import { ColumnProfileDate } from './columnProfileDate.js';
import { ColumnProfileNumber } from './columnProfileNumber.js';
import { ColumnProfileObject } from './columnProfileObject.js';
import { ColumnProfileString } from './columnProfileString.js';
import { VectorFrequencyTable } from './vectorFrequencyTable.js';
import { ColumnProfileBoolean } from './columnProfileBoolean.js';
import { ColumnProfileDatetime } from './columnProfileDatetime.js';
import { TableSummaryDataGridInstance } from '../tableSummaryDataGridInstance.js';
import { ColumnDisplayType, ColumnProfileType, ColumnSchema } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { dataExplorerExperimentalFeatureEnabled } from '../../common/positronDataExplorerExperimentalConfig.js';
import { renderLeadingTrailingWhitespace } from './tableDataCell.js';

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
		// Determines whether a sparkline is expected for this column type
		const shouldShowSparkline = () => {
			switch (props.columnSchema.type_display) {
				case ColumnDisplayType.Number:
				case ColumnDisplayType.Boolean:
				case ColumnDisplayType.String:
					return true;
				default:
					return false;
			}
		};

		/**
		 * SparklineLoadingIndicator component.
		 * Displays a subtle loading animation while data is being computed.
		 */
		const SparklineLoadingIndicator = () => {
			return (
				<div
					className='column-sparkline'
					style={{
						width: SPARKLINE_WIDTH,
						height: SPARKLINE_HEIGHT + SPARKLINE_X_AXIS_HEIGHT
					}}
				>
					<svg
						className='vector-histogram loading-sparkline'
						shapeRendering='crispEdges'
						viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT + SPARKLINE_X_AXIS_HEIGHT}`}
					>
						<g>
							<rect className='x-axis'
								height={SPARKLINE_X_AXIS_HEIGHT}
								width={SPARKLINE_WIDTH}
								x={0}
								y={SPARKLINE_HEIGHT - SPARKLINE_X_AXIS_HEIGHT}
							/>
							<rect className='loading-indicator'
								height={SPARKLINE_HEIGHT * 0.3}
								rx={2}
								width={SPARKLINE_WIDTH * 0.8}
								x={SPARKLINE_WIDTH * 0.1}
								y={SPARKLINE_HEIGHT * 0.5}
							/>
						</g>
					</svg>
				</div>
			);
		};

		// Render.
		switch (props.columnSchema.type_display) {
			// Column display types that render a histogram sparkline.
			case ColumnDisplayType.Number: {
				// Get the column histogram.
				const columnHistogram = props.instance.getColumnProfileSmallHistogram(props.columnIndex);
				if (!columnHistogram) {
					return shouldShowSparkline() ? <SparklineLoadingIndicator /> : null;
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
							columnHistogram={columnHistogram}
							graphHeight={SPARKLINE_HEIGHT}
							graphWidth={SPARKLINE_WIDTH}
							hoverManager={props.instance.hoverManager}
							xAxisHeight={SPARKLINE_X_AXIS_HEIGHT}
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
					return shouldShowSparkline() ? <SparklineLoadingIndicator /> : null;
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
							columnFrequencyTable={columnFrequencyTable}
							graphHeight={SPARKLINE_HEIGHT}
							graphWidth={SPARKLINE_WIDTH}
							hoverManager={props.instance.hoverManager}
							xAxisHeight={SPARKLINE_X_AXIS_HEIGHT}
						/>
					</div >
				);
			}

			// Column display types that do not render a sparkline.
			case ColumnDisplayType.Date:
			case ColumnDisplayType.Datetime:
			case ColumnDisplayType.Time:
			case ColumnDisplayType.Interval:
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

		// Create a reference to the container div
		const containerRef = useRef<HTMLDivElement>(null);

		// Create tooltip text based on nullPercent
		const getTooltipText = () => {
			// Get the null count for this column
			const nullCount = props.instance.getColumnProfileNullCount(props.columnIndex);

			if (nullPercent === undefined || nullCount === undefined) {
				return nls.localize(
					'positron.missingValues.calculating',
					'Missing Values\nCalculating...'
				);
			} else if (nullPercent === 0) {
				return nls.localize(
					'positron.missingValues.none',
					'Missing Values\nNo missing values'
				);
			} else if (nullPercent === 100) {
				return nls.localize(
					'positron.missingValues.all',
					'Missing Values\nAll values are missing ({0} values)', nullCount.toLocaleString()
				);
			} else {
				return nls.localize(
					'positron.missingValues.some',
					'Missing Values\n{0}% of values are missing ({1} values)',
					nullPercent,
					nullCount.toLocaleString()
				);
			}
		};

		// Show tooltip when mouse enters
		const showTooltip = () => {
			if (containerRef.current) {
				props.instance.hoverManager.showHover(
					containerRef.current,
					getTooltipText()
				);
			}
		};

		// Hide tooltip when mouse leaves
		const hideTooltip = () => {
			props.instance.hoverManager.hideHover();
		};

		// Cleanup when component unmounts
		useEffect(() => {
			return () => {
				props.instance.hoverManager.hideHover();
			};
		}, []);

		// Render.
		return (
			<div
				ref={containerRef}
				className='column-null-percent'
				onMouseEnter={showTooltip}
				onMouseLeave={hideTooltip}
			>
				{nullPercent !== undefined &&
					<div className={positronClassNames('text-percent', { 'zero': nullPercent === 0 })}>
						{nullPercent}%
					</div>
				}
				<div className='graph-percent'>
					<svg shapeRendering='geometricPrecision' viewBox='0 0 52 14'>
						<defs>
							<clipPath id='clip-indicator'>
								<rect height='12' rx='6' ry='6' width='50' x='1' y='1' />
							</clipPath>
						</defs>
						{graphNullPercent === undefined ?
							<g>
								<rect className='empty'
									height='12'
									rx='6'
									ry='6'
									strokeWidth='1'
									width='50'
									x='1'
									y='1'
								/>
							</g> :
							<g>
								<rect className='background'
									height='12'
									rx='6'
									ry='6'
									strokeWidth='1'
									width='50'
									x='1'
									y='1'
								/>
								<rect className='indicator'
									clipPath='url(#clip-indicator)'
									height='12'
									rx='6'
									ry='6'
									width={50 * ((100 - graphNullPercent) / 100)}
									x='1'
									y='1'
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
				return <ColumnProfileNumber columnIndex={props.columnIndex} instance={props.instance} />;

			// Boolean.
			case ColumnDisplayType.Boolean:
				return <ColumnProfileBoolean columnIndex={props.columnIndex} instance={props.instance} />;

			// String.
			case ColumnDisplayType.String:
				return <ColumnProfileString columnIndex={props.columnIndex} instance={props.instance} />;

			// Date.
			case ColumnDisplayType.Date:
				return <ColumnProfileDate columnIndex={props.columnIndex} instance={props.instance} />;

			// Datetime.
			case ColumnDisplayType.Datetime:
				return <ColumnProfileDatetime columnIndex={props.columnIndex} instance={props.instance} />;

			// Object (pandas columns of dtype=object that are not uniformly typed).
			case ColumnDisplayType.Object:
				return <ColumnProfileObject columnIndex={props.columnIndex} instance={props.instance} />;

			// Column display types that do not render a profile.
			case ColumnDisplayType.Time:
			case ColumnDisplayType.Interval:
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

			// Time.
			case ColumnDisplayType.Interval:
				return 'codicon-positron-data-type-date-time';

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
		case ColumnDisplayType.Object:
			summaryStatsSupported = isSummaryStatsSupported();
			break;
		case ColumnDisplayType.Time:
		case ColumnDisplayType.Interval:
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

	const renderedColumn = renderLeadingTrailingWhitespace(props.columnSchema.column_name);

	// Determine whether this is the cursor.
	const cursor = props.columnIndex === props.instance.cursorRowIndex;

	// Render.
	return (
		<div
			className='column-summary'
			onDoubleClick={props.onDoubleClick}
			onMouseDown={() => {
				props.instance.scrollToRow(props.columnIndex);
				props.instance.setCursorRow(props.columnIndex);
			}}
		>
			<div
				className={positronClassNames(
					'cursor-indicator',
					{ 'cursor': cursor },
					{ 'focused': cursor && context.instance.focused }
				)}
			/>
			<div className='basic-info'>
				<div
					className={
						positronClassNames(
							'expand-collapse-button',
							{ 'disabled': !summaryStatsSupported }
						)
					}
					onClick={summaryStatsSupported ? async () =>
						await props.instance.toggleExpandColumn(props.columnIndex) : undefined
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
					onMouseLeave={() => props.instance.hoverManager.hideHover()}
					onMouseOver={() =>
						props.instance.hoverManager.showHover(
							dataTypeRef.current,
							`${props.columnSchema.type_name}`
						)
					}
				/>
				<div className='column-name'>
					{renderedColumn}
				</div>
				{!expanded && <ColumnSparkline />}
				<ColumnNullPercent />
			</div>
			{expanded && <ColumnProfile />}
		</div>
	);
};
