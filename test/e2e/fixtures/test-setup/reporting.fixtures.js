"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttachScreenshotsToReportFixture = AttachScreenshotsToReportFixture;
exports.AttachLogsToReportFixture = AttachLogsToReportFixture;
exports.TracingFixture = TracingFixture;
const fs = __importStar(require("fs"));
const path = require("path");
const archiver_1 = __importDefault(require("archiver"));
function AttachScreenshotsToReportFixture() {
    return async (options, use) => {
        const { app, testInfo } = options;
        let screenShotCounter = 1;
        const page = app.code.driver.currentPage;
        const screenshots = [];
        app.code.driver.takeScreenshot = async function (name) {
            const screenshotPath = testInfo.outputPath(`${screenShotCounter++}-${name}.png`);
            await page.screenshot({ path: screenshotPath });
            screenshots.push(screenshotPath);
        };
        await use();
        // if test failed, take and attach screenshot
        if (testInfo.status !== testInfo.expectedStatus) {
            const screenshot = await page.screenshot();
            await testInfo.attach('on-test-end', { body: screenshot, contentType: 'image/png' });
        }
        for (const screenshotPath of screenshots) {
            testInfo.attachments.push({ name: path.basename(screenshotPath), path: screenshotPath, contentType: 'image/png' });
        }
    };
}
function AttachLogsToReportFixture() {
    return async (options, use) => {
        const { suiteId, logsPath, testInfo } = options;
        await use();
        if (!suiteId) {
            return;
        }
        const zipPath = path.join(logsPath, 'logs.zip');
        const output = fs.createWriteStream(zipPath);
        const archive = (0, archiver_1.default)('zip', { zlib: { level: 9 } });
        archive.on('error', (err) => {
            throw err;
        });
        archive.pipe(output);
        // add all log files to the archive
        archive.glob('**/*', { cwd: logsPath, ignore: ['logs.zip'] });
        // wait for the archive to finalize and the output stream to close
        await new Promise((resolve, reject) => {
            output.on('close', () => resolve(undefined));
            output.on('error', reject);
            archive.finalize();
        });
        // attach the zipped file to the report
        await testInfo.attach(`logs-${path.basename(testInfo.file)}.zip`, {
            path: zipPath,
            contentType: 'application/zip',
        });
        // remove the logs.zip file
        try {
            await fs.promises.unlink(zipPath);
        }
        catch (err) {
            console.error(`Failed to remove ${zipPath}:`, err);
        }
    };
}
function TracingFixture() {
    return async (options, use) => {
        const { app, testInfo } = options;
        // Determine execution mode
        const isCommandLineRun = process.env.npm_execpath && !(process.env.PW_UI_MODE === 'true');
        // Use Playwright's built-in tracing only for browser-based runs (extension, UI mode).
        // Use custom tracing for Positron desktop runs or CLI runs.
        if (testInfo.project.use.browserName &&
            !isCommandLineRun) {
            await use(app);
        }
        else {
            // start tracing
            await app.startTracing(testInfo.titlePath.join(' › '));
            await use(app);
            // stop tracing
            const title = path.basename(`_trace`); // do NOT use title of 'trace' - conflicts with the default trace
            const tracePath = testInfo.outputPath(`${title}.zip`);
            await app.stopTracing(title, true, tracePath);
            // attach the trace to the report if CI and test failed or not in CI
            const isCI = process.env.CI === 'true';
            if (!isCI || testInfo.status !== testInfo.expectedStatus || testInfo.retry || process.env.PW_TRACE === 'on') {
                testInfo.attachments.push({ name: 'trace', path: tracePath, contentType: 'application/zip' });
            }
            else if (isCI) {
                // In CI, delete trace files for passing tests to save disk space in blob reports
                try {
                    await fs.promises.unlink(tracePath);
                }
                catch (error) {
                    // Ignore - trace file may not exist or may already be deleted
                }
            }
        }
    };
}
//# sourceMappingURL=reporting.fixtures.js.map