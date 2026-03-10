"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordDataExplorerMetric = void 0;
exports.createDataExplorerMetric = createDataExplorerMetric;
exports.recordDataFileLoad = recordDataFileLoad;
exports.recordDataFilter = recordDataFilter;
exports.recordDataSort = recordDataSort;
exports.recordToCode = recordToCode;
const metric_factory_js_1 = require("./metric-factory.js");
//-----------------------
// Create Feature Factory
//-----------------------
const { recordMetric: recordDataExplorerMetric } = (0, metric_factory_js_1.createFeatureMetricFactory)('data_explorer');
exports.recordDataExplorerMetric = recordDataExplorerMetric;
//-----------------------
// Factory Functions
//-----------------------
/**
 * Creates a data explorer metric object with the feature_area preset
 *
 * @param params Parameters for the metric excluding feature_area and duration_ms
 * @returns A partially complete metric object ready for duration_ms to be added
 */
function createDataExplorerMetric(params) {
    return {
        feature_area: 'data_explorer',
        ...params
    };
}
/**
 * Helper function to build context for data explorer operations
 */
function buildDataExplorerContext(autoContext, additionalContext, extraBaseContext = {}) {
    if (!autoContext && !additionalContext && Object.keys(extraBaseContext).length === 0) {
        return undefined;
    }
    return async () => {
        let baseContext = { ...extraBaseContext };
        // Add auto context if available
        if (autoContext) {
            baseContext = {
                ...baseContext,
                data_rows: await autoContext.getRowCount(),
                data_cols: await autoContext.getColumnCount()
            };
        }
        // Add additional context if available
        if (additionalContext) {
            if (typeof additionalContext === 'function') {
                const additional = await additionalContext();
                return { ...baseContext, ...additional };
            }
            else {
                return { ...baseContext, ...additionalContext };
            }
        }
        return baseContext;
    };
}
/**
 * Shortcut for recording data file load operations with auto-context
 */
async function recordDataFileLoad(operation, targetType, isElectronApp, logger, autoContext, options = {}) {
    const { description, additionalContext } = options;
    return recordDataExplorerMetric(operation, {
        action: 'load_data',
        target_type: targetType,
        target_description: description || `Loading ${targetType} file`,
        context_json: buildDataExplorerContext(autoContext, additionalContext)
    }, isElectronApp, logger);
}
/**
 * Shortcut for recording data explorer filter operations with auto-context
 */
async function recordDataFilter(operation, targetType, isElectronApp, logger, autoContext, options = {}) {
    const { description, additionalContext } = options;
    return recordDataExplorerMetric(operation, {
        action: 'filter',
        target_type: targetType,
        target_description: description || `Filtering ${targetType} data`,
        context_json: buildDataExplorerContext(autoContext, additionalContext, { filter_applied: true })
    }, isElectronApp, logger);
}
/**
 * Shortcut for recording data explorer sort operations with auto-context
 */
async function recordDataSort(operation, targetType, isElectronApp, logger, autoContext, options = {}) {
    const { description, additionalContext } = options;
    return recordDataExplorerMetric(operation, {
        action: 'sort',
        target_type: targetType,
        target_description: description || `Sorting ${targetType} data`,
        context_json: buildDataExplorerContext(autoContext, additionalContext, { sort_applied: true })
    }, isElectronApp, logger);
}
/**
 * Shortcut for recording to-code operations with auto-context
 */
async function recordToCode(operation, targetType, isElectronApp, logger, autoContext, options = {}) {
    const { description, additionalContext } = options;
    return recordDataExplorerMetric(operation, {
        action: 'to_code',
        target_type: targetType,
        target_description: description || `Converting ${targetType} data to code`,
        context_json: buildDataExplorerContext(autoContext, additionalContext)
    }, isElectronApp, logger);
}
//# sourceMappingURL=metric-data-explorer.js.map