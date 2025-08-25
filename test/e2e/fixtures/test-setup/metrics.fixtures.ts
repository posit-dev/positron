/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { recordDataFileLoad, recordDataFilter, recordDataSort, recordToCode, type DataExplorerAutoContext, type DataExplorerShortcutOptions } from '../../utils/metrics/metric-data-explorer.js';
import { recordRunCell, type NotebookShortcutOptions } from '../../utils/metrics/metric-notebooks.js';
import { type RecordMetric, type MetricResult, type MetricContext, type MetricTargetType } from '../../utils/metrics/metric-base.js';
import { Application, MultiLogger } from '../../infra/index.js';

/**
 * Creates a metrics recorder for performance testing
 */
export function MetricsFixture(app: Application, logger: MultiLogger): RecordMetric {
	const dataExplorerAutoContext: DataExplorerAutoContext = {
		getRowCount: async () => {
			return app.workbench.dataExplorer.grid.getRowCount();
		},
		getColumnCount: async () => {
			return app.workbench.dataExplorer.grid.getColumnCount();
		}
	};

	return {
		dataExplorer: {
			loadData: async <T>(
				operation: () => Promise<T>,
				targetType: MetricTargetType,
				options?: DataExplorerShortcutOptions
			): Promise<MetricResult<T>> => {
				return recordDataFileLoad(operation, targetType, !!app.code.electronApp, logger, dataExplorerAutoContext, options);
			},
			filter: async <T>(
				operation: () => Promise<T>,
				targetType: MetricTargetType,
				options?: DataExplorerShortcutOptions
			): Promise<MetricResult<T>> => {
				return recordDataFilter(operation, targetType, !!app.code.electronApp, logger, dataExplorerAutoContext, options);
			},
			sort: async <T>(
				operation: () => Promise<T>,
				targetType: MetricTargetType,
				options?: DataExplorerShortcutOptions
			): Promise<MetricResult<T>> => {
				return recordDataSort(operation, targetType, !!app.code.electronApp, logger, dataExplorerAutoContext, options);
			},
			toCode: async <T>(
				operation: () => Promise<T>,
				targetType: MetricTargetType,
				options?: DataExplorerShortcutOptions
			): Promise<MetricResult<T>> => {
				return recordToCode(operation, targetType, !!app.code.electronApp, logger, dataExplorerAutoContext, options);
			}
		},
		notebooks: {
			runCell: async <T>(
				operation: () => Promise<T>,
				targetType: MetricTargetType,
				language?: string,
				description?: string,
				context?: MetricContext | (() => Promise<MetricContext>)
			): Promise<MetricResult<T>> => {
				const options: NotebookShortcutOptions = {
					description,
					additionalContext: context
				};
				return recordRunCell(operation, targetType, !!app.code.electronApp, logger, language, options);
			}
		}
	};
}
