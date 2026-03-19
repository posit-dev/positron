"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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
exports.tags = exports.expect = exports.test = void 0;
// Playwright and testing imports
const playwright = __importStar(require("@playwright/test"));
const { test: base, expect: playwrightExpect } = playwright;
exports.expect = playwrightExpect;
// Node.js built-in modules
const path_1 = require("path");
// Local imports
const infra_1 = require("../infra");
Object.defineProperty(exports, "tags", { enumerable: true, get: function () { return infra_1.TestTags; } });
const packageManager_1 = require("../pages/utils/packageManager");
const test_setup_1 = require("../fixtures/test-setup");
const load_environment_vars_js_1 = require("../fixtures/load-environment-vars.js");
const app_workbench_fixtures_js_1 = require("../fixtures/test-setup/app-workbench.fixtures.js");
// used specifically for app fixture error handling in test.afterAll
let appFixtureFailed = false;
let appFixtureScreenshot;
let renamedLogsPath = 'not-set';
// Test fixtures
exports.test = base.extend({
    suiteId: ['', { scope: 'worker', option: true }],
    envVars: [async ({}, use, workerInfo) => {
            const projectName = workerInfo.project.name;
            (0, load_environment_vars_js_1.loadEnvironmentVars)(projectName);
            (0, load_environment_vars_js_1.validateEnvironmentVars)([
                'POSITRON_PY_VER_SEL',
                'POSITRON_R_VER_SEL',
                'POSITRON_PY_ALT_VER_SEL',
                'POSITRON_R_ALT_VER_SEL',
            ], { allowEmpty: false });
            if (projectName === 'e2e-workbench') {
                (0, load_environment_vars_js_1.validateEnvironmentVars)([
                    'POSIT_WORKBENCH_PASSWORD'
                ], { allowEmpty: false });
            }
            await use(projectName);
        }, { scope: 'worker', auto: true }],
    snapshots: [true, { scope: 'worker', auto: true }],
    logsPath: [async ({}, use, workerInfo) => {
            const project = workerInfo.project.use;
            const logsPath = (0, path_1.join)(test_setup_1.LOGS_ROOT_PATH, project.artifactDir, test_setup_1.TEMP_DIR);
            await use(logsPath);
        }, { scope: 'worker', auto: true }],
    logger: [async ({ logsPath }, use) => {
            const logger = (0, infra_1.createLogger)(logsPath);
            await use(logger);
        }, { auto: true, scope: 'worker' }],
    options: [async ({ logsPath, logger, snapshots }, use, workerInfo) => {
            const project = workerInfo.project.use;
            const optionsFixture = (0, test_setup_1.OptionsFixture)();
            const options = await optionsFixture(logsPath, logger, snapshots, project, workerInfo);
            await use(options);
        }, { scope: 'worker', auto: true }],
    userDataDir: [async ({ options }, use, workerInfo) => {
            const projectName = workerInfo.project.name;
            if (['server', 'workbench'].includes(projectName)) {
                // For external/workbench projects, this fixture isn't used, they handle it separately
                await use('');
            }
            else {
                // Default case for e2e-electron, e2e-chromium, and other projects
                const userDataDirFixture = (0, test_setup_1.UserDataDirFixture)();
                const userDir = await userDataDirFixture(options);
                await use(userDir);
            }
        }, { scope: 'worker', auto: true }],
    restartApp: [async ({ app }, use) => {
            await app.restart();
            await app.workbench.sessions.expectNoStartUpMessaging();
            await use(app);
        }, { scope: 'test', timeout: 60000 }],
    // placeholder for area-specific fixtures that need to run before app starts
    // e.g. changing settings that require an app reload
    // see notebooks-positron/_test.setup.ts for example usage
    beforeApp: [
        async ({}, use) => {
            await use();
        },
        { scope: 'worker' }
    ],
    app: [async ({ options, logsPath, logger, beforeApp: _beforeApp }, use, workerInfo) => {
            const { app, start, stop } = await (0, test_setup_1.AppFixture)({ options, logsPath, logger, workerInfo });
            try {
                await start();
                await use(app);
            }
            catch (error) {
                appFixtureFailed = true;
                const screenshotPath = (0, path_1.join)(logsPath, 'app-start-failure.png');
                try {
                    const page = app.code?.driver?.currentPage;
                    if (page) {
                        appFixtureScreenshot = await page.screenshot({ path: screenshotPath });
                    }
                }
                catch {
                    // ignore
                }
                throw error; // re-throw the error to ensure test failure
            }
            finally {
                await stop();
                renamedLogsPath = await (0, test_setup_1.renameTempLogsDir)(logger, logsPath, workerInfo);
            }
        }, { scope: 'worker', auto: true, timeout: 60000 }],
    assistant: [
        async ({ app }, use) => {
            await use(app.workbench.assistant);
        },
        { scope: 'test' }
    ],
    sessions: [
        async ({ app }, use) => {
            await use(app.workbench.sessions);
        },
        { scope: 'test' }
    ],
    r: [
        async ({ sessions }, use) => {
            await sessions.start('r', { reuse: true });
            await use();
        },
        { scope: 'test' }
    ],
    python: [
        async ({ sessions }, use) => {
            await sessions.start('python', { reuse: true });
            await use();
        },
        { scope: 'test' }
    ],
    // ex: await packages.manage('snowflake', 'install');
    // ex: await packages.manage('renv', 'uninstall');
    packages: [async ({ app }, use) => {
            const packageManager = new packageManager_1.PackageManager(app);
            await use(packageManager);
        }, { scope: 'test' }],
    devTools: [async ({ app }, use) => {
            await app.workbench.quickaccess.runCommand('workbench.action.toggleDevTools');
            await use();
        }, { scope: 'test' }],
    // ex: await openFile('workspaces/basic-rmd-file/basicRmd.rmd');
    openFile: async ({ app }, use) => {
        const fileOps = (0, test_setup_1.FileOperationsFixture)(app);
        await use(fileOps.openFile);
    },
    // ex: await openDataFile('workspaces/large_r_notebook/spotify.ipynb');
    openDataFile: async ({ app }, use) => {
        const fileOps = (0, test_setup_1.FileOperationsFixture)(app);
        await use(fileOps.openDataFile);
    },
    // ex: await openFolder(path.join('qa-example-content/workspaces/r_testing'));
    openFolder: async ({ app }, use) => {
        const fileOps = (0, test_setup_1.FileOperationsFixture)(app);
        await use(fileOps.openFolder);
    },
    // ex: await saveFileAs(path.join(app.workspacePathOrFolder, 'newfile.txt'));
    saveFileAs: async ({ app }, use) => {
        await use(async (filePath) => {
            const { quickaccess, quickInput } = app.workbench;
            await quickaccess.runCommand('workbench.action.files.saveAs', { keepOpen: true });
            await quickInput.waitForQuickInputOpened();
            await quickInput.type(filePath);
            await quickInput.clickOkButton();
        });
    },
    // ex: await runCommand('workbench.action.files.save');
    runCommand: async ({ app }, use) => {
        await use(async (command, options) => {
            await app.workbench.quickaccess.runCommand(command, options);
        });
    },
    runDockerCommand: async ({}, use, testInfo) => {
        await use(async (command, description) => {
            if (testInfo.project.name !== 'e2e-workbench' && testInfo.project.name !== 'e2e-remote-ssh') {
                throw new Error('runDockerCommand is only available in the e2e-workbench & e2e-remote-ssh projects');
            }
            return (0, app_workbench_fixtures_js_1.runDockerCommand)(command, description); // <-- return result
        });
    },
    // ex: await executeCode('Python', 'print("Hello, world!")');
    executeCode: async ({ app }, use) => {
        await use(async (language, code, options) => {
            await app.workbench.console.executeCode(language, code, options);
        });
    },
    // ex: await hotKeys.copy();
    hotKeys: async ({ app }, use) => {
        const hotKeys = app.workbench.hotKeys;
        await use(hotKeys);
    },
    // ex: await settings.set({'editor.actionBar.enabled': true});
    settings: [async ({ app }, use) => {
            const settingsFixture = (0, test_setup_1.SettingsFixture)(app);
            await use(settingsFixture);
        }, { scope: 'worker' }],
    // direct access to the settings file
    // e.g. to apply area-specific settings before the app start
    // see notebooks-positron/_test.setup.ts for example usage
    settingsFile: [async ({ userDataDir }, use) => {
            const manager = new infra_1.SettingsFile((0, path_1.join)(userDataDir, infra_1.USER_SETTINGS_FILENAME));
            await manager.backupIfExists();
            await use(manager);
            await manager.restoreFromBackup();
        }, { scope: 'worker' }],
    vsCodeSettings: [async ({}, use) => {
            const manager = new infra_1.SettingsFile(infra_1.SettingsFile.getVSCodeSettingsPath());
            await manager.backupIfExists();
            await use(manager);
            await manager.restoreFromBackup();
        }, { scope: 'worker' }],
    attachScreenshotsToReport: [async ({ app }, use, testInfo) => {
            const attachScreenshotsFixture = (0, test_setup_1.AttachScreenshotsToReportFixture)();
            await attachScreenshotsFixture({ app, testInfo }, use);
        }, { auto: true }],
    attachLogsToReport: [async ({ suiteId, logsPath }, use, testInfo) => {
            const attachLogsFixture = (0, test_setup_1.AttachLogsToReportFixture)();
            await attachLogsFixture({ suiteId, logsPath, testInfo }, use);
        }, { auto: true }],
    tracing: [async ({ app }, use, testInfo) => {
            const tracingFixture = (0, test_setup_1.TracingFixture)();
            await tracingFixture({ app, testInfo }, use);
        }, { auto: true, scope: 'test' }],
    page: async ({ app }, use) => {
        await use(app.code.driver.currentPage);
    },
    autoTestFixture: [async ({ logger, suiteId, app }, use, testInfo) => {
            if (!suiteId) {
                throw new Error('suiteId is required');
            }
            logger.log('');
            logger.log(`>>> Test start: '${testInfo.title ?? 'unknown'}' <<<`);
            logger.log('');
            await use();
            // Disabling for now to see if it improves teardown stability
            // await app.workbench.console.logConsoleContents();
            // await app.workbench.terminal.logTerminalContents();
            const failed = testInfo.status !== testInfo.expectedStatus;
            const testTitle = testInfo.title;
            const endLog = failed ? `>>> !!! FAILURE !!! Test end: '${testTitle}' !!! FAILURE !!! <<<` : `>>> Test end: '${testTitle}' <<<`;
            logger.log('');
            logger.log(endLog);
            logger.log('');
            // --- Start Positron ---
            // Log system diagnostics at end of each test for monitoring resource usage
            if (process.env.ENABLE_DIAGNOSTIC_LOGGING === 'true') {
                try {
                    const freeMemory = (0, infra_1.getFreeMemory)();
                    const processList = (0, infra_1.getCondensedProcessList)();
                    const loadAvgAndCpu = (0, infra_1.getLoadAverageAndCpuUsage)();
                    console.log(`Free Memory: ${freeMemory}`);
                    console.log(`Processes: ${processList}`);
                    console.log(`${loadAvgAndCpu}`);
                }
                catch (error) {
                    console.log(`Error logging system diagnostics: ${error}`);
                }
            }
            // --- End Positron ---
        }, { scope: 'test', auto: true }],
    metric: [async ({ logger, app }, use) => {
            const metricsRecorder = (0, test_setup_1.MetricsFixture)(app, logger);
            await use(metricsRecorder);
        }, { scope: 'test' }],
    cleanup: async ({ app }, use) => {
        const cleanup = new infra_1.TestTeardown(app.workspacePathOrFolder);
        await use(cleanup);
    },
});
// Runs once per worker. If a worker handles multiple specs, these hooks only run for the first spec.
// However, we are using `suiteId` to ensure each suite gets a new worker (and a fresh app
// instance). This also ensures these before/afterAll hooks will run for EACH spec
exports.test.beforeAll(async ({ logger }, testInfo) => {
    // since the worker doesn't know or have access to the spec name when it starts,
    // we store the spec name in a global variable. this ensures logs are written
    // to the correct folder even when the app is scoped to "worker".
    // by storing the spec name globally, we can rename the logs folder after the suite finishes.
    // note: workers are intentionally restarted per spec to scope logs by spec
    // and provide a fresh app instance for each spec.
    (0, test_setup_1.setSpecName)(testInfo.titlePath[0]);
    logger.log('');
    logger.log(`>>> Suite start: '${testInfo.titlePath[0] ?? 'unknown'}' <<<`);
    logger.log('');
});
exports.test.afterAll(async function ({ logger, suiteId, }, testInfo) {
    try {
        logger.log('');
        logger.log(`>>> Suite end: '${testInfo.titlePath[0] ?? 'unknown'}' <<<`);
        logger.log('');
    }
    catch (error) {
        // ignore
    }
    if (appFixtureFailed) {
        try {
            if (appFixtureScreenshot) {
                await testInfo.attach('app-start-failure', {
                    body: appFixtureScreenshot,
                    contentType: 'image/png',
                });
            }
        }
        catch (e) {
            console.log(e);
        }
        try {
            const attachLogs = (0, test_setup_1.AttachLogsToReportFixture)();
            await attachLogs({ suiteId, logsPath: renamedLogsPath, testInfo }, async () => { });
        }
        catch (e) {
            console.log(e);
        }
        appFixtureFailed = false;
        appFixtureScreenshot = undefined;
    }
    // Dump active handles/requests to help debug worker teardown timeouts
    // Enable with ENABLE_DIAGNOSTIC_LOGGING=true
    if (process.env.ENABLE_DIAGNOSTIC_LOGGING === 'true') {
        try {
            const util = require('util');
            function summarizeHandle(h) {
                const name = h?.constructor?.name ?? typeof h;
                if (name === 'ChildProcess') {
                    return {
                        type: name,
                        pid: h.pid,
                        spawnfile: h.spawnfile,
                        spawnargs: h.spawnargs,
                        connected: h.connected,
                        killed: h.killed,
                        exitCode: h.exitCode,
                        signalCode: h.signalCode,
                    };
                }
                if (name === 'Socket') {
                    return {
                        type: name,
                        local: `${h.localAddress ?? ''}:${h.localPort ?? ''}`,
                        remote: `${h.remoteAddress ?? ''}:${h.remotePort ?? ''}`,
                        bytesWritten: h.bytesWritten,
                        bytesRead: h.bytesRead,
                        destroyed: h.destroyed,
                        pending: h.pending,
                    };
                }
                if (name === 'Pipe') {
                    return {
                        type: name,
                        fd: h.fd,
                    };
                }
                // default: show a shallow inspection
                return {
                    type: name,
                    info: util.inspect(h, { depth: 1, maxArrayLength: 10 }),
                };
            }
            // eslint-disable-next-line local/code-no-any-casts
            const handles = process._getActiveHandles?.() ?? [];
            // eslint-disable-next-line local/code-no-any-casts
            const requests = process._getActiveRequests?.() ?? [];
            console.log(`\n[afterAll] Active handles=${handles.length} requests=${requests.length}`);
            for (const h of handles) {
                console.log(' handle:', summarizeHandle(h));
            }
            // Group requests by type for cleaner output
            const byType = new Map();
            const writeWraps = [];
            for (const r of requests) {
                const t = r?.constructor?.name ?? typeof r;
                byType.set(t, (byType.get(t) ?? 0) + 1);
                // Collect WriteWrap samples for detailed inspection
                if (t === 'WriteWrap' && writeWraps.length < 3) {
                    writeWraps.push(r);
                }
            }
            console.log(' requestsByType:', Object.fromEntries(byType));
            // Show detailed info for first few WriteWrap requests (the smoking gun)
            if (writeWraps.length > 0) {
                console.log(' WriteWrap samples (first 3):');
                for (const w of writeWraps) {
                    try {
                        const handleType = w.handle?.constructor?.name ?? 'unknown';
                        const handleDestroyed = w.handle?.destroyed ?? 'unknown';
                        console.log(`   - handle: ${handleType}, destroyed: ${handleDestroyed}`);
                    }
                    catch {
                        console.log('   - (unable to inspect)');
                    }
                }
            }
        }
        catch (error) {
            console.log(`Error dumping handles: ${error}`);
        }
    }
});
//# sourceMappingURL=_test.setup.js.map