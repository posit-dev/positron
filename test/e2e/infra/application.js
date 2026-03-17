"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Application = exports.Quality = void 0;
const workbench_1 = require("./workbench");
const code_1 = require("./code");
const logger_1 = require("./logger");
const profiler_1 = require("./profiler");
const test_1 = require("@playwright/test");
const workbench_pwb_js_1 = require("./workbench-pwb.js");
const LOAD_TIMEOUT = 60000;
const READINESS_LOCATORS = {
    monacoWorkbench: '.monaco-workbench',
    explorerFoldersView: '.explorer-folders-view',
    activityBar: '.activitybar',
    statusBar: '.statusbar',
    remoteHost: '.monaco-workbench .statusbar-item[id="status.host"]',
    positWorkbenchSignIn: 'Sign in to Posit Workbench'
};
var Quality;
(function (Quality) {
    Quality[Quality["Dev"] = 0] = "Dev";
    Quality[Quality["Insiders"] = 1] = "Insiders";
    Quality[Quality["Stable"] = 2] = "Stable";
    Quality[Quality["Exploration"] = 3] = "Exploration";
    Quality[Quality["OSS"] = 4] = "OSS";
})(Quality || (exports.Quality = Quality = {}));
/**
 * Creates the appropriate workbench instance based on external server configuration
 */
function createWorkbench(code, options) {
    const isWorkbench = options.useExternalServer && options.externalServerUrl?.includes(':8787');
    return isWorkbench ? new workbench_pwb_js_1.PositWorkbench(code) : new workbench_1.Workbench(code);
}
class Application {
    options;
    constructor(options) {
        this.options = options;
        this._userDataPath = options.userDataDir || '';
        this._workspacePathOrFolder = options.workspacePath;
    }
    _code;
    get code() { return this._code; }
    _workbench;
    get workbench() { return this._workbench; }
    /**
     * Get the Posit Workbench instance. Only available in e2e-workbench contexts.
     */
    get positWorkbench() {
        if (this._workbench instanceof workbench_pwb_js_1.PositWorkbench) {
            return this._workbench;
        }
        throw new Error('positWorkbench is only available in e2e-workbench contexts');
    }
    get logger() {
        return this.options.logger;
    }
    get remote() {
        return !!this.options.remote;
    }
    get web() {
        return !!this.options.web;
    }
    _workspacePathOrFolder;
    get workspacePathOrFolder() {
        return this._workspacePathOrFolder;
    }
    get extensionsPath() {
        return this.options.extensionsPath || '';
    }
    _userDataPath;
    get userDataPath() {
        return this._userDataPath;
    }
    _profiler;
    get profiler() { return this._profiler; }
    async start() {
        await this._start();
    }
    async connectToExternalServer() {
        await this._connectToExternalServer();
    }
    async restart(options) {
        await (0, logger_1.measureAndLog)(() => (async () => {
            await this.stop();
            await this._start(options?.workspaceOrFolder, options?.extraArgs);
        })(), 'Application#restart()', this.logger);
    }
    async _start(workspaceOrFolder = this.workspacePathOrFolder, extraArgs = []) {
        this._workspacePathOrFolder = workspaceOrFolder;
        // Launch Code...
        const code = await this.startApplication(extraArgs);
        // ...and make sure the window is ready to interact
        await (0, logger_1.measureAndLog)(() => this.checkWindowReady(code), 'Application#checkWindowReady()', this.logger);
    }
    async stop() {
        if (this._code) {
            try {
                await this._code.exit();
            }
            finally {
                this._code = undefined;
            }
        }
    }
    async stopExternalServer() {
        // For external servers, we only need to close the browser connection
        // The external server keeps running
        if (this._code) {
            try {
                await this._code.driver.close();
            }
            finally {
                this._code = undefined;
            }
        }
    }
    async _connectToExternalServer() {
        // Connect to external server without launching
        const code = await this.connectToExternalApplication();
        // Make sure the window is ready to interact
        await (0, logger_1.measureAndLog)(() => this.checkWindowReady(code), 'Application#checkWindowReady() [external]', this.logger);
    }
    async connectToExternalApplication() {
        const code = this._code = await (0, code_1.launch)({
            ...this.options,
        });
        this._workbench = createWorkbench(this._code, this.options);
        this._profiler = new profiler_1.Profiler(this.code);
        return code;
    }
    async startTracing(name) {
        await this._code?.startTracing(name);
    }
    async stopTracing(name, persist, customPath) {
        await this._code?.stopTracing(name, persist, customPath);
    }
    async startApplication(extraArgs = []) {
        const code = this._code = await (0, code_1.launch)({
            ...this.options,
            extraArgs: [...(this.options.extraArgs || []), ...extraArgs],
        });
        this._workbench = createWorkbench(this._code, this.options);
        this._profiler = new profiler_1.Profiler(this.code);
        return code;
    }
    async checkWindowReady(code) {
        const isWorkbench = this.options.useExternalServer && this.options.externalServerUrl?.includes(':8787');
        const isPositronServer = this.options.useExternalServer && this.options.externalServerUrl?.includes(':8080');
        // We need a rendered workbench
        await (0, logger_1.measureAndLog)(() => code.didFinishLoad(), 'Application#checkWindowReady: wait for navigation to be committed', this.logger);
        // Readiness checks differ based on the type of connection
        if (isWorkbench) {
            await (0, logger_1.measureAndLog)(() => this.checkPositWorkbenchReady(code), 'Application#checkPositWorkbenchReady', this.logger);
        }
        else if (isPositronServer) {
            await (0, logger_1.measureAndLog)(() => this.checkPositronServerReady(code), 'Application#checkPositronServerReady', this.logger);
        }
        else {
            await (0, logger_1.measureAndLog)(() => this.checkPositronReady(code), 'Application#checkPositronReady', this.logger);
        }
        // Remote but not web: wait for a remote connection state change
        if (this.remote) {
            await (0, logger_1.measureAndLog)(() => (0, test_1.expect)(code.driver.currentPage.locator(READINESS_LOCATORS.remoteHost)).not.toContainText('Opening Remote'), 'Application#checkWindowReady: wait for remote indicator', this.logger);
        }
    }
    /**
     * Positron readiness checks
     */
    async checkPositronReady(code) {
        await (0, logger_1.measureAndLog)(() => (0, test_1.expect)(code.driver.currentPage.locator(READINESS_LOCATORS.monacoWorkbench)).toBeVisible({ timeout: 30000 }), 'Application#checkPositronReady: wait for monaco workbench', this.logger);
        await (0, logger_1.measureAndLog)(() => code.whenWorkbenchRestored(), 'Application#checkPositronReady: wait for workbench restored', this.logger);
        await (0, logger_1.measureAndLog)(() => (0, test_1.expect)(code.driver.currentPage.locator(READINESS_LOCATORS.explorerFoldersView)).toBeVisible({ timeout: LOAD_TIMEOUT }), 'Application#checkPositronReady: wait for explorer view', this.logger);
    }
    /**
     * Posit Workbench readiness checks
     */
    async checkPositWorkbenchReady(code) {
        await (0, logger_1.measureAndLog)(() => (0, test_1.expect)(code.driver.currentPage.getByText(READINESS_LOCATORS.positWorkbenchSignIn)).toBeVisible({ timeout: 30000 }), 'Application#checkPositWorkbenchReady: wait for sign in prompt', this.logger);
    }
    /**
     * External Positron Server readiness checks
     */
    async checkPositronServerReady(code) {
        await (0, logger_1.measureAndLog)(() => (0, test_1.expect)(code.driver.currentPage.locator(READINESS_LOCATORS.monacoWorkbench)).toBeVisible({ timeout: 30000 }), 'Application#checkPositronServerReady: wait for monaco workbench', this.logger);
        await (0, logger_1.measureAndLog)(() => (0, test_1.expect)(code.driver.currentPage.locator(READINESS_LOCATORS.explorerFoldersView)).toBeVisible({ timeout: LOAD_TIMEOUT }), 'Application#checkPositronServerReady: wait for explorer view', this.logger);
        await (0, logger_1.measureAndLog)(() => (0, test_1.expect)(code.driver.currentPage.locator(READINESS_LOCATORS.activityBar)).toBeVisible({ timeout: 30000 }), 'Application#checkPositronServerReady: wait for activity bar', this.logger);
        await (0, logger_1.measureAndLog)(() => (0, test_1.expect)(code.driver.currentPage.locator(READINESS_LOCATORS.statusBar)).toBeVisible({ timeout: 30000 }), 'Application#checkPositronServerReady: wait for status bar', this.logger);
    }
}
exports.Application = Application;
//# sourceMappingURL=application.js.map