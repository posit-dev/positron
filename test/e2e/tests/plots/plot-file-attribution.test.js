"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const countLines = (content) => content.split('\n').filter(line => line.trim()).length;
const languageConfigs = [
    {
        session: 'r',
        fileName: 'plot-attribution-test.R',
        fileContent: 'plot(1:10)\n',
        tags: [_test_setup_1.tags.ARK],
        runFileCommand: 'r.sourceCurrentFile',
    },
    {
        session: 'python',
        fileName: 'plot-attribution-test.py',
        fileContent: [
            'import matplotlib.pyplot as plt',
            'plt.plot([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])',
            'plt.show()',
            ''
        ].join('\n'),
        tags: [],
        runFileCommand: 'python.execInConsole',
    },
];
for (const config of languageConfigs) {
    _test_setup_1.test.describe(`Plot File Attribution`, { tag: [_test_setup_1.tags.PLOTS, ...config.tags] }, () => {
        _test_setup_1.test.beforeEach(async function ({ app, sessions }) {
            const filePath = path.join(app.workspacePathOrFolder, config.fileName);
            fs.writeFileSync(filePath, config.fileContent);
            await sessions.start(config.session);
        });
        _test_setup_1.test.afterEach(async function ({ app, hotKeys }) {
            await hotKeys.closeAllEditors();
            await hotKeys.clearPlots();
            await app.workbench.plots.waitForNoPlots({ timeout: 3000 });
        });
        _test_setup_1.test.afterAll(async function ({ cleanup }) {
            await cleanup.removeTestFiles([config.fileName]);
        });
        (0, _test_setup_1.test)(`${capitalize(config.session)} - Plot origin shows source file after line execution`, async function ({ app, openFile, hotKeys }) {
            const { plots, editors } = app.workbench;
            // Open the file and run each line of code to generate a plot
            await openFile(config.fileName);
            for (let i = 0; i < countLines(config.fileContent); i++) {
                await hotKeys.runLineOfCode();
            }
            // Wait for the plot to appear and verify the origin button
            await plots.waitForCurrentPlot();
            await plots.expectOriginButtonVisible();
            await plots.expectOriginButtonContain(config.fileName);
            // Close the editor and click the origin button to verify it opens the correct file
            await hotKeys.closeAllEditors();
            await plots.clickOriginFileButton();
            await editors.verifyTab(config.fileName, { isVisible: true, isSelected: true });
        });
        (0, _test_setup_1.test)(`${capitalize(config.session)} - Plot origin shows source file after run file command`, async function ({ app, openFile, runCommand, hotKeys }) {
            const { plots, editors } = app.workbench;
            // Open the file and run the command to execute the entire file
            await openFile(config.fileName);
            await runCommand(config.runFileCommand);
            // Wait for the plot to appear and verify the origin button
            await plots.waitForCurrentPlot();
            await plots.expectOriginButtonVisible();
            await plots.expectOriginButtonContain(config.fileName);
            // Close the editor and click the origin button to verify it opens the correct file
            await hotKeys.closeAllEditors();
            await plots.clickOriginFileButton();
            await editors.verifyTab(config.fileName, { isVisible: true, isSelected: true });
        });
    });
}
//# sourceMappingURL=plot-file-attribution.test.js.map