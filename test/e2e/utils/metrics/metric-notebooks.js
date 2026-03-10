"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordNotebookMetric = void 0;
exports.createNotebookMetric = createNotebookMetric;
exports.recordRunCell = recordRunCell;
const metric_factory_js_1 = require("./metric-factory.js");
//-----------------------
// Create Feature Factory
//-----------------------
const { recordMetric: recordNotebookMetric } = (0, metric_factory_js_1.createFeatureMetricFactory)('notebooks');
exports.recordNotebookMetric = recordNotebookMetric;
//-----------------------
// Factory Functions
//-----------------------
/**
 * Creates a notebook metric object with the feature_area preset
 *
 * @param params Parameters for the metric excluding feature_area and duration_ms
 * @returns A partially complete metric object ready for duration_ms to be added
 */
function createNotebookMetric(params) {
    return {
        feature_area: 'notebooks',
        ...params
    };
}
/**
 * Shortcut for recording notebook cell execution with language context
 */
async function recordRunCell(operation, targetType, isElectronApp, logger, language, options = {}) {
    const { description, additionalContext } = options;
    // Build context with language if provided
    let context_json;
    if (language || additionalContext) {
        context_json = async () => {
            let baseContext = {};
            if (language) {
                baseContext.language = language;
            }
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
    return recordNotebookMetric(operation, {
        action: 'run_cell',
        target_type: targetType,
        target_description: description || `Running ${language || targetType} cell`,
        context_json
    }, isElectronApp, logger);
}
//# sourceMappingURL=metric-notebooks.js.map