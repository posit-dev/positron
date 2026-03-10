"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsFixture = MetricsFixture;
const metric_data_explorer_js_1 = require("../../utils/metrics/metric-data-explorer.js");
const metric_notebooks_js_1 = require("../../utils/metrics/metric-notebooks.js");
const metric_assistant_js_1 = require("../../utils/metrics/metric-assistant.js");
/**
 * Creates a metrics recorder for performance testing
 */
function MetricsFixture(app, logger) {
    const dataExplorerAutoContext = {
        getRowCount: async () => {
            return app.workbench.dataExplorer.grid.getRowCount();
        },
        getColumnCount: async () => {
            return app.workbench.dataExplorer.grid.getColumnCount();
        }
    };
    return {
        dataExplorer: {
            loadData: async (operation, targetType, options) => {
                return (0, metric_data_explorer_js_1.recordDataFileLoad)(operation, targetType, !app.web, logger, dataExplorerAutoContext, options);
            },
            filter: async (operation, targetType, options) => {
                return (0, metric_data_explorer_js_1.recordDataFilter)(operation, targetType, !app.web, logger, dataExplorerAutoContext, options);
            },
            sort: async (operation, targetType, options) => {
                return (0, metric_data_explorer_js_1.recordDataSort)(operation, targetType, !app.web, logger, dataExplorerAutoContext, options);
            },
            toCode: async (operation, targetType, options) => {
                return (0, metric_data_explorer_js_1.recordToCode)(operation, targetType, !app.web, logger, dataExplorerAutoContext, options);
            }
        },
        notebooks: {
            runCell: async (operation, targetType, language, description, context) => {
                const options = {
                    description,
                    additionalContext: context
                };
                return (0, metric_notebooks_js_1.recordRunCell)(operation, targetType, !app.web, logger, language, options);
            }
        },
        assistant: {
            evalResponse: async (input, durationMs) => {
                return (0, metric_assistant_js_1.recordAssistantEval)(input, durationMs, !!app.code.electronApp, logger);
            }
        }
    };
}
//# sourceMappingURL=metrics.fixtures.js.map