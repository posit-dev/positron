/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { recordDataFileLoad, recordDataFilter, recordDataSort, type MetricTargetType, type DataExplorerAutoContext, type DataExplorerShortcutOptions, recordToCode, RecordMetric } from '../../utils/metrics/index.js';
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
			): Promise<T> => {
				return recordDataFileLoad(operation, targetType, !!app.code.electronApp, logger, dataExplorerAutoContext, options);
			},
			filter: async <T>(
				operation: () => Promise<T>,
				targetType: MetricTargetType,
				options?: DataExplorerShortcutOptions
			): Promise<T> => {
				return recordDataFilter(operation, targetType, !!app.code.electronApp, logger, dataExplorerAutoContext, options);
			},
			sort: async <T>(
				operation: () => Promise<T>,
				targetType: MetricTargetType,
				options?: DataExplorerShortcutOptions
			): Promise<T> => {
				return recordDataSort(operation, targetType, !!app.code.electronApp, logger, dataExplorerAutoContext, options);
			},
			toCode: async <T>(
				operation: () => Promise<T>,
				targetType: MetricTargetType,
				options?: DataExplorerShortcutOptions
			): Promise<T> => {
				return recordToCode(operation, targetType, !!app.code.electronApp, logger, dataExplorerAutoContext, options);
			}
		},
	};
}
