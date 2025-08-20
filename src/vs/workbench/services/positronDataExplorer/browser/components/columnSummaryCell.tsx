/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './columnSummaryCell.css';

// React.
import React, { useRef, useEffect, useState } from 'react';

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
	console.log(`[ColumnSummaryCell] Rendering column ${props.columnIndex}`);

	// Context hooks.
	const context = usePositronDataGridContext();

	// Track sparkline requested state at the parent level
	const [sparklineRequested, setSparklineRequested] = useState(
		() => props.instance.isSparklineRequested(props.columnIndex)
	);

	// Listen for cache updates
	useEffect(() => {
		const disposable = props.instance.tableSummaryCache.onDidUpdate(() => {
			const newState = props.instance.isSparklineRequested(props.columnIndex);
			if (newState !== sparklineRequested) {
				console.log(`[Column ${props.columnIndex}] Parent state update: ${sparklineRequested} -> ${newState}`);
				setSparklineRequested(newState);
			}
		});
		return () => disposable.dispose();
	}, [props.columnIndex, props.instance, sparklineRequested]);

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
		// Check if this is a large dataset (synchronous now)
		const isLargeDataset = props.instance.isLargeDataset();

		// Use parent's state
		console.log(`[Column ${props.columnIndex}] Render - sparklineRequested (from parent state):`, sparklineRequested);

		// Also check what data is available
		const columnHistogram = props.instance.getColumnProfileSmallHistogram(props.columnIndex);
		const columnFrequencyTable = props.instance.getColumnProfileSmallFrequencyTable(props.columnIndex);
		console.log(`[Column ${props.columnIndex}] Data available - histogram:`, !!columnHistogram, 'frequencyTable:', !!columnFrequencyTable);

		// Determines whether a sparkline is expected for this column type
		const shouldShowSparkline = () => {
			switch (props.columnSchema.type_display) {
				case ColumnDisplayType.Number:
				case ColumnDisplayType.Boolean:
				case ColumnDisplayType.String:
					console.log(`[Column ${props.columnIndex}] shouldShowSparkline: true for type ${props.columnSchema.type_display}`);
					return true;
				default:
					console.log(`[Column ${props.columnIndex}] shouldShowSparkline: false for type ${props.columnSchema.type_display}`);
					return false;
			}
		};

		// Check if sparkline computation should be skipped for large datasets
		const shouldSkipSparklineForLargeDataset = () => {
			const result = isLargeDataset && !sparklineRequested;
			console.log(`[Column ${props.columnIndex}] shouldSkipSparklineForLargeDataset: isLargeDataset=${isLargeDataset}, sparklineRequested=${sparklineRequested}, result=${result}`);
			return result;
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

		/**
		 * SparklineClickToCompute component.
		 * Displays a clickable placeholder for large datasets where sparklines
		 * need to be explicitly requested by the user.
		 */
		const SparklineClickToCompute = () => {
			// Reference for hover tooltip
			const sparklineRef = useRef<HTMLDivElement>(undefined!);

			const handleClick = async (e: React.MouseEvent) => {
				// Stop propagation to prevent parent handlers from interfering
				e.stopPropagation();
				e.preventDefault();

				console.log(`[Column ${props.columnIndex}] Button clicked! Before request - sparklineRequested (state):`, sparklineRequested);
				console.log(`[Column ${props.columnIndex}] Before request - isRequested (cache):`, props.instance.isSparklineRequested(props.columnIndex));
				console.log(`[Column ${props.columnIndex}] Before request - data available:`, {
					histogram: !!props.instance.getColumnProfileSmallHistogram(props.columnIndex),
					frequencyTable: !!props.instance.getColumnProfileSmallFrequencyTable(props.columnIndex)
				});

				// Immediately update parent state
				setSparklineRequested(true);

				try {
					// Request the sparkline for this column
					await props.instance.requestSparkline(props.columnIndex);
					console.log(`[Column ${props.columnIndex}] After request - isRequested (cache):`, props.instance.isSparklineRequested(props.columnIndex));
					console.log(`[Column ${props.columnIndex}] After request - data available:`, {
						histogram: !!props.instance.getColumnProfileSmallHistogram(props.columnIndex),
						frequencyTable: !!props.instance.getColumnProfileSmallFrequencyTable(props.columnIndex)
					});
					// Note: Parent component will re-render when cache updates
				} catch (err) {
					console.error('Failed to request sparkline:', err);
					// Revert state on error
					setSparklineRequested(false);
				}
			};

			return (
				<div
					ref={sparklineRef}
					className='column-sparkline click-to-compute'
					style={{
						width: SPARKLINE_WIDTH,
						height: SPARKLINE_HEIGHT + SPARKLINE_X_AXIS_HEIGHT,
						cursor: 'pointer'
					}}
					onMouseDown={handleClick}
					onClick={(e) => e.stopPropagation()}
					onMouseLeave={() => props.instance.hoverManager.hideHover()}
					onMouseOver={() =>
						props.instance.hoverManager.showHover(
							sparklineRef.current,
							'Click to compute column profile sparkline'
						)
					}
				>
					<svg
						className='vector-histogram click-to-compute-sparkline'
						shapeRendering='crispEdges'
						viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT + SPARKLINE_X_AXIS_HEIGHT}`}
						style={{ pointerEvents: 'none' }}
					>
						<g>
							<rect className='x-axis'
								height={SPARKLINE_X_AXIS_HEIGHT}
								width={SPARKLINE_WIDTH}
								x={0}
								y={SPARKLINE_HEIGHT - SPARKLINE_X_AXIS_HEIGHT}
							/>
							<rect className='placeholder-bg'
								height={SPARKLINE_HEIGHT}
								width={SPARKLINE_WIDTH}
								x={0}
								y={0}
								rx={2}
							/>
							<text
								className='click-to-compute-text'
								x={SPARKLINE_WIDTH / 2}
								y={SPARKLINE_HEIGHT / 2}
								textAnchor='middle'
								dominantBaseline='central'
								fontSize={9}
							>
								Compute
							</text>
						</g>
					</svg>
				</div>
			);
		};

		// Render.
		switch (props.columnSchema.type_display) {
			// Column display types that render a histogram sparkline.
			case ColumnDisplayType.Number: {
				// Check if we should skip sparkline computation for large datasets
				if (shouldSkipSparklineForLargeDataset()) {
					return shouldShowSparkline() ? <SparklineClickToCompute /> : null;
				}

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
				// Check if we should skip sparkline computation for large datasets
				if (shouldSkipSparklineForLargeDataset()) {
					return shouldShowSparkline() ? <SparklineClickToCompute /> : null;
				}

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
		// Get the null percent value for this column
		const nullPercent = props.instance.getColumnProfileNullPercent(props.columnIndex);

		/**
		 * The graph null percent value is used to determine how much of the
		 * "progress bar" for missing values is filled in the UI. This value is
		 * not always the same as the null percent value.
		 *
		 * The null percent value is the percentage of null values in the column.
		 * The graph null percent value may be higher or lower than the null percent
		 * value to ensure the "progress bar" is visually readable by the user.
		 * This is relevant when the percentage of null values is very small or very large.
		 *
		 * In the very small case, we want to ensure that the bar does not look empty.
		 * In the very large case, we want to ensure that the bar does not look completely full.
		 */
		let graphNullPercent = nullPercent;

		if (nullPercent !== undefined) {
			if (nullPercent <= 0) {
				graphNullPercent = 0;
			} else if (nullPercent >= 100) {
				graphNullPercent = 100;
			} else {
				// Pin the graph null percent such that anything above 0% and below 5% reads as 5%
				// and anything below 100% above 95% reads as 95%. This ensures that the missing values
				// "progress bar" is visually readable by the user and does not appear incorrectly empty
				// or full. This is especially important for columns with very few rows.
				graphNullPercent = Math.min(Math.max(nullPercent, 5), 95);
			}
		}

		// Create a reference to the container div
		const containerRef = useRef<HTMLDivElement>(null);

		// Helper function to format the null percentage we display in the UI.
		const getDisplayNullPercent = () => {
			if (nullPercent === undefined) {
				return undefined;
			} else if (nullPercent <= 0) {
				return '0%';
			} else if (nullPercent >= 100) {
				return '100%';
			} else if (nullPercent > 0 && nullPercent < 1) {
				return '<1%';
			} else {
				/**
				 * We round the percentage to the nearest integer
				 * when displaying it in the UI to avoid cluttering
				 * the UI with too many decimal places.
				 */
				return `${Math.floor(nullPercent)}%`;
			}
		};

		// Create tooltip text based on nullPercent
		const getTooltipText = () => {
			// Get the null count for this column
			const nullCount = props.instance.getColumnProfileNullCount(props.columnIndex);

			if (nullPercent === undefined || nullCount === undefined) {
				return nls.localize(
					'positron.missingValues.calculating',
					'Calculating...'
				);
			} else if (nullPercent === 0) {
				return nls.localize(
					'positron.missingValues.none',
					'No missing values'
				);
			} else if (nullPercent === 100) {
				return nls.localize(
					'positron.missingValues.all',
					'All values are missing ({0} values)', nullCount.toLocaleString()
				);
			} else {
				// Format percentage for tooltip
				return nls.localize(
					'positron.missingValues.some',
					'{0} of values are missing ({1} values)',
					getDisplayNullPercent(),
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
						{getDisplayNullPercent()}
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
	console.log(`[Column ${props.columnIndex}] expanded=${expanded}`);

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
			onMouseDown={(e) => {
				// Check if the click is on the sparkline button
				const target = e.target as HTMLElement;
				if (target.closest('.click-to-compute')) {
					// Don't handle mouseDown if it's on the sparkline button
					e.stopPropagation();
					return;
				}
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
