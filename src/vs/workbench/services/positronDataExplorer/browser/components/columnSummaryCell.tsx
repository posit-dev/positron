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
import { ProfileDate } from 'vs/workbench/services/positronDataExplorer/browser/components/profileDate';
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';
import { ProfileNumber } from 'vs/workbench/services/positronDataExplorer/browser/components/profileNumber';
import { ProfileString } from 'vs/workbench/services/positronDataExplorer/browser/components/profileString';
import { ProfileBoolean } from 'vs/workbench/services/positronDataExplorer/browser/components/profileBoolean';
import { ProfileDatetime } from 'vs/workbench/services/positronDataExplorer/browser/components/profileDatetime';
import { ColumnNullPercent } from 'vs/workbench/services/positronDataExplorer/browser/components/columnNullPercent';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { ColumnSparklineHistogram } from 'vs/workbench/services/positronDataExplorer/browser/components/columnSparklineHistogram';
import { ColumnDisplayType, ColumnProfileType, ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { ColumnSparklineFrequencyTable } from 'vs/workbench/services/positronDataExplorer/browser/components/columnSparklineFrequencyTable';
import { checkDataExplorerExperimentalFeaturesEnabled, dataExplorerExperimentalFeatureEnabled } from 'vs/workbench/services/positronDataExplorer/common/positronDataExplorerExperimentalConfig';

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
	 * Sparkline component.
	 * @returns The rendered component.
	 */
	const Sparkline = () => {
		// Sparklines are an experimental feature.
		if (!checkDataExplorerExperimentalFeaturesEnabled(context.configurationService)) {
			return null;
		}

		// Render.
		switch (props.columnSchema.type_display) {
			// Column display types that render a histogram sparkline.
			case ColumnDisplayType.Number: {
				// Get the column histogram. If there is one, render the ColumnSparklineHistogram.
				const columnHistogram = props.instance.getColumnHistogram(props.columnIndex);
				if (columnHistogram) {
					return <ColumnSparklineHistogram columnHistogram={columnHistogram} />;
				}

				// Render nothing.
				return null;
			}

			// Column display types that render a frequency table sparkline.
			case ColumnDisplayType.Boolean:
			case ColumnDisplayType.String: {
				// Get the column frequency table. If there is one, render it and return.
				const columnFrequencyTable = props.instance.getColumnFrequencyTable(props.columnIndex);
				if (columnFrequencyTable) {
					return <ColumnSparklineFrequencyTable columnFrequencyTable={columnFrequencyTable} />;
				}

				// Render nothing.
				return null;
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
	 * Profile component.
	 * @returns The rendered component.
	 */
	const Profile = () => {
		// Return the profile for the display type.
		switch (props.columnSchema.type_display) {
			// Number.
			case ColumnDisplayType.Number:
				return <ProfileNumber instance={props.instance} columnIndex={props.columnIndex} />;

			// Boolean.
			case ColumnDisplayType.Boolean:
				return <ProfileBoolean instance={props.instance} columnIndex={props.columnIndex} />;

			// String.
			case ColumnDisplayType.String:
				return <ProfileString instance={props.instance} columnIndex={props.columnIndex} />;

			// Date.
			case ColumnDisplayType.Date:
				return <ProfileDate instance={props.instance} columnIndex={props.columnIndex} />;

			// Datetime.
			case ColumnDisplayType.Datetime:
				return <ProfileDatetime instance={props.instance} columnIndex={props.columnIndex} />;

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

	// Set the summary supported flag.
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
				{!expanded && <Sparkline />}
				<ColumnNullPercent {...props} />
			</div>
			{expanded && <Profile />}
		</div>
	);
};
