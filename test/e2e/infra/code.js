"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
exports.Code = void 0;
exports.launch = launch;
exports.findElement = findElement;
exports.findElements = findElements;
exports.createCodeFromPage = createCodeFromPage;
const os = __importStar(require("os"));
const logger_1 = require("./logger");
const playwrightBrowser_1 = require("./playwrightBrowser");
const playwrightDriver_1 = require("./playwrightDriver");
const playwrightElectron_1 = require("./playwrightElectron");
const processes_1 = require("./processes");
// --- Start Positron ---
const tree_kill_1 = __importDefault(require("tree-kill"));
const util_1 = require("util");
const playwrightExternalServer_1 = require("./playwrightExternalServer");
const treeKillAsync = (0, util_1.promisify)(tree_kill_1.default);
const instances = new Set();
function registerInstance(process, logger, type) {
    const instance = { kill: () => (0, processes_1.teardown)(process, logger) };
    instances.add(instance);
    const safeToKill = new Promise(resolve => {
        process.stdout?.on('data', data => {
            const output = data.toString();
            if (output.indexOf('calling app.quit()') >= 0 && type === 'electron') {
                setTimeout(() => resolve(), 500 /* give Electron some time to actually terminate fully */);
            }
            logger.log(`[${type}] stdout: ${output}`);
        });
        process.stderr?.on('data', error => logger.log(`[${type}] stderr: ${error}`));
    });
    process.once('exit', (code, signal) => {
        logger.log(`[${type}] Process terminated (pid: ${process.pid}, code: ${code}, signal: ${signal})`);
        instances.delete(instance);
    });
    return { safeToKill };
}
async function teardownAll(signal) {
    stopped = true;
    for (const instance of instances) {
        await instance.kill();
    }
    if (typeof signal === 'number') {
        process.exit(signal);
    }
}
let stopped = false;
process.on('exit', () => teardownAll());
process.on('SIGINT', () => teardownAll(128 + 2)); // https://nodejs.org/docs/v14.16.0/api/process.html#process_signal_events
process.on('SIGTERM', () => teardownAll(128 + 15)); // same as above
async function launch(options) {
    if (stopped) {
        throw new Error('Smoke test process has terminated, refusing to spawn Code');
    }
    // --- Start Positron ---
    // External server smoke tests (e.g. Posit Workbench, Positron Server)
    if (options.web && options.useExternalServer) {
        if (!options.externalServerUrl) {
            throw new Error('External server URL must be provided when useExternalServer is true');
        }
        const { driver } = await (0, logger_1.measureAndLog)(() => (0, playwrightExternalServer_1.launch)(options, options.externalServerUrl), 'launch playwright (external server)', options.logger);
        return new Code(driver, options.logger, null, undefined, options.quality, options.version);
    }
    // --- End Positron ---
    // Browser smoke tests
    if (options.web) {
        const { serverProcess, driver } = await (0, logger_1.measureAndLog)(() => (0, playwrightBrowser_1.launch)(options), 'launch playwright (browser)', options.logger);
        registerInstance(serverProcess, options.logger, 'server');
        return new Code(driver, options.logger, serverProcess, undefined, options.quality, options.version);
    }
    // Electron smoke tests (playwright)
    else {
        // --- Start Positron ---
        const { electronProcess, driver, electronApp } = await (0, logger_1.measureAndLog)(() => (0, playwrightElectron_1.launch)(options), 'launch playwright (electron)', options.logger);
        const { safeToKill } = registerInstance(electronProcess, options.logger, 'electron');
        return new Code(driver, options.logger, electronProcess, safeToKill, options.quality, options.version, electronApp);
        // --- End Positron ---
    }
}
class Code {
    logger;
    mainProcess;
    safeToKill;
    quality;
    version;
    electronApp;
    driver;
    constructor(driver, logger, 
    // --- Start Positron ---
    mainProcess, 
    // --- End Positron ---
    safeToKill, quality, version, 
    // --- Start Positron ---
    // Only available when running against Electron
    electronApp) {
        this.logger = logger;
        this.mainProcess = mainProcess;
        this.safeToKill = safeToKill;
        this.quality = quality;
        this.version = version;
        this.electronApp = electronApp;
        this.driver = new Proxy(driver, {
            get(target, prop) {
                if (typeof prop === 'symbol') {
                    throw new Error('Invalid usage');
                }
                // eslint-disable-next-line local/code-no-any-casts
                const targetProp = target[prop];
                if (typeof targetProp !== 'function') {
                    return targetProp;
                }
                return function (...args) {
                    logger.log(`${prop}`, ...args.filter(a => typeof a === 'string'));
                    return targetProp.apply(this, args);
                };
            }
        });
    }
    get editContextEnabled() {
        return !(this.quality === 2 /* Quality.Stable */ && this.version.major === 1 && this.version.minor < 101);
    }
    async startTracing(name) {
        return await this.driver.startTracing(name);
    }
    // --- Start Positron ---
    async stopTracing(name, persist = false, customPath) {
        return await this.driver.stopTracing(name, persist, customPath);
    }
    // --- End Positron ---
    /**
     * Dispatch a keybinding to the application.
     * @param keybinding The keybinding to dispatch, e.g. 'ctrl+shift+p'.
     * @param accept The acceptance function to await before returning. Wherever
     * possible this should verify that the keybinding did what was expected,
     * otherwise it will likely be a cause of difficult to investigate race
     * conditions. This is particularly insidious when used in the automation
     * library as it can surface across many test suites.
     *
     * This requires an async function even when there's no implementation to
     * force the author to think about the accept callback and prevent mistakes
     * like not making it async.
     */
    async dispatchKeybinding(keybinding, accept) {
        await this.driver.sendKeybinding(keybinding, accept);
    }
    async didFinishLoad() {
        return this.driver.didFinishLoad();
    }
    async exit() {
        // --- Start Positron ---
        // On macOS, kill the process tree BEFORE driver.close() to prevent orphaned children
        // If we wait for the process to exit naturally, children get reparented and we can't kill them
        if (process.platform === 'darwin' && this.mainProcess?.pid) {
            this.logger.log('Smoke test exit(): proactively killing process tree on macOS before close');
            await this.killProcessTree(this.mainProcess.pid);
        }
        // --- End Positron ---
        return (0, logger_1.measureAndLog)(() => new Promise(resolve => {
            // If no main process (external server mode), just close the driver
            if (!this.mainProcess) {
                this.driver.close().finally(() => resolve());
                return;
            }
            const pid = this.mainProcess.pid;
            let processExited = false;
            let driverClosed = false;
            let driverCloseTimeout;
            // Helper to resolve when both process has exited AND driver.close() has completed
            const maybeResolve = () => {
                if (processExited && driverClosed) {
                    if (driverCloseTimeout) {
                        clearTimeout(driverCloseTimeout);
                    }
                    resolve();
                }
                else if (processExited && !driverClosed && !driverCloseTimeout) {
                    // Process exited but driver.close() hasn't completed yet.
                    // Start a failsafe timeout to prevent hanging if driver.close() wedges.
                    driverCloseTimeout = setTimeout(() => {
                        if (!driverClosed) {
                            this.logger.log('Smoke test exit(): WARNING - driver.close() did not complete within 5s after process exit, resolving anyway to prevent hang');
                            driverClosed = true;
                            resolve();
                        }
                    }, 5000);
                }
            };
            // Start the exit flow via driver - track when it completes
            this.driver.close().finally(() => {
                this.logger.log('Smoke test exit(): driver.close() completed');
                driverClosed = true;
                maybeResolve();
            });
            let safeToKill = false;
            this.safeToKill?.then(() => {
                this.logger.log('Smoke test exit(): safeToKill() called');
                safeToKill = true;
            });
            // Await the exit of the application
            (async () => {
                let retries = 0;
                while (!processExited) {
                    retries++;
                    if (safeToKill) {
                        this.logger.log('Smoke test exit(): call did not terminate the process yet, but safeToKill is true, so we can kill it');
                        await this.killProcessTree(pid);
                        processExited = true;
                        maybeResolve();
                        return;
                    }
                    switch (retries) {
                        // after 10 seconds: forcefully kill
                        case 20: {
                            this.logger.log('Smoke test exit(): call did not terminate process after 10s, forcefully exiting the application...');
                            await this.killProcessTree(pid);
                            processExited = true;
                            maybeResolve();
                            return;
                        }
                        // after 20 seconds: give up
                        case 40: {
                            this.logger.log('Smoke test exit(): call did not terminate process after 20s, giving up');
                            await this.killProcessTree(pid);
                            processExited = true;
                            maybeResolve();
                            return;
                        }
                    }
                    try {
                        process.kill(pid, 0); // throws an exception if the process doesn't exist anymore.
                        await this.wait(500);
                    }
                    catch (error) {
                        this.logger.log('Smoke test exit(): call terminated process successfully');
                        processExited = true;
                        maybeResolve();
                    }
                }
            })();
        }), 'Code#exit()', this.logger);
    }
    // --- Start Positron ---
    // private kill(pid: number): void {
    // 	try {
    // 		process.kill(pid, 0); // throws an exception if the process doesn't exist anymore.
    // 	} catch (e) {
    // 		this.logger.log('Smoke test kill(): returning early because process does not exist anymore');
    // 		return;
    // 	}
    // 	try {
    // 		this.logger.log(`Smoke test kill(): Trying to SIGTERM process: ${pid}`);
    // 		process.kill(pid);
    // 	} catch (e) {
    // 		this.logger.log('Smoke test kill(): SIGTERM failed', e);
    // 	}
    // }
    /**
     * Kill the entire process tree starting from the given PID.
     * This ensures child processes (kernels, language servers, etc.) are also terminated.
     * Uses two-phase approach: SIGTERM first, then SIGKILL if still alive (macOS only).
     */
    async killProcessTree(pid) {
        const isAlive = () => {
            try {
                process.kill(pid, 0);
                return true;
            }
            catch {
                return false;
            }
        };
        if (!isAlive()) {
            this.logger.log('Smoke test killProcessTree(): process does not exist, skipping');
            return;
        }
        // Phase 1: Attempt graceful shutdown with SIGTERM
        this.logger.log(`Smoke test killProcessTree(): Attempting SIGTERM for PID ${pid}`);
        try {
            const processStub = { pid };
            await (0, processes_1.teardown)(processStub, this.logger);
        }
        catch (e) {
            this.logger.log(`Smoke test killProcessTree(): teardown failed: ${e}`);
        }
        await this.wait(500);
        if (!isAlive()) {
            this.logger.log(`Smoke test killProcessTree(): PID ${pid} exited after SIGTERM`);
            return;
        }
        // Phase 2: Process survived SIGTERM, escalate to SIGKILL (macOS only)
        if (process.platform === 'darwin') {
            this.logger.log(`Smoke test killProcessTree(): PID ${pid} still alive after SIGTERM; escalating to SIGKILL`);
            try {
                // Kill entire process tree with SIGKILL, not just parent
                await treeKillAsync(pid, 'SIGKILL');
            }
            catch (e) {
                this.logger.log(`Smoke test killProcessTree(): SIGKILL failed: ${e}`);
            }
            await this.wait(500);
            if (!isAlive()) {
                this.logger.log(`Smoke test killProcessTree(): PID ${pid} exited after SIGKILL`);
            }
            else {
                this.logger.log(`Smoke test killProcessTree(): PID ${pid} STILL alive after SIGKILL (unexpected)`);
            }
        }
        else {
            this.logger.log(`Smoke test killProcessTree(): PID ${pid} survived SIGTERM on non-macOS platform`);
        }
        // Note: dbus-daemon cleanup removed to prevent interference with parallel tests
        // The shared dbus session (started in xvfb setup) should handle all Electron instances
        // Any orphaned dbus-daemon processes will be cleaned up by docker --init zombie reaping
    }
    // --- End Positron ---
    async getElement(selector) {
        return (await this.driver.getElements(selector))?.[0];
    }
    async getElements(selector, recursive) {
        return this.driver.getElements(selector, recursive);
    }
    async waitForTextContent(selector, textContent, accept, retryCount) {
        accept = accept || (result => textContent !== undefined ? textContent === result : !!result);
        return await this.poll(() => this.driver.getElements(selector).then(els => els.length > 0 ? Promise.resolve(els[0].textContent) : Promise.reject(new Error('Element not found for textContent'))), s => accept(typeof s === 'string' ? s : ''), `get text content '${selector}'`, retryCount);
    }
    async waitAndClick(selector, xoffset, yoffset, retryCount = 200) {
        await this.poll(() => this.driver.click(selector, xoffset, yoffset), () => true, `click '${selector}'`, retryCount);
    }
    async waitForSetValue(selector, value) {
        await this.poll(() => this.driver.setValue(selector, value), () => true, `set value '${selector}'`);
    }
    async waitForElements(selector, recursive, accept = result => result.length > 0) {
        return await this.poll(() => this.driver.getElements(selector, recursive), accept, `get elements '${selector}'`);
    }
    async waitForElement(selector, accept = result => !!result, retryCount = 200) {
        return await this.poll(() => this.driver.getElements(selector).then(els => els[0]), accept, `get element '${selector}'`, retryCount);
    }
    async waitForActiveElement(selector, retryCount = 200) {
        await this.poll(() => this.driver.isActiveElement(selector), r => r, `is active element '${selector}'`, retryCount);
    }
    async waitForTitle(accept) {
        await this.poll(() => this.driver.getTitle(), accept, `get title`);
    }
    async waitForTypeInEditor(selector, text) {
        await this.poll(() => this.driver.typeInEditor(selector, text), () => true, `type in editor '${selector}'`);
    }
    async waitForEditorSelection(selector, accept) {
        await this.poll(() => this.driver.getEditorSelection(selector), accept, `get editor selection '${selector}'`);
    }
    async waitForTerminalBuffer(selector, accept) {
        await this.poll(() => this.driver.getTerminalBuffer(selector), accept, `get terminal buffer '${selector}'`);
    }
    async writeInTerminal(selector, value) {
        await this.poll(() => this.driver.writeInTerminal(selector, value), () => true, `writeInTerminal '${selector}'`);
    }
    async whenWorkbenchRestored() {
        await this.poll(() => this.driver.whenWorkbenchRestored(), () => true, `when workbench restored`);
    }
    getLocaleInfo() {
        return this.driver.getLocaleInfo();
    }
    getLocalizedStrings() {
        return this.driver.getLocalizedStrings();
    }
    getLogs() {
        return this.driver.getLogs();
    }
    wait(millis) {
        return this.driver.wait(millis);
    }
    async poll(fn, acceptFn, timeoutMessage, retryCount = 200, retryInterval = 100 // millis
    ) {
        let trial = 1;
        let lastError = '';
        while (true) {
            if (trial > retryCount) {
                this.logger.log('Timeout!');
                this.logger.log(lastError);
                this.logger.log(`Timeout: ${timeoutMessage} after ${(retryCount * retryInterval) / 1000} seconds.`);
                throw new Error(`Timeout: ${timeoutMessage} after ${(retryCount * retryInterval) / 1000} seconds.`);
            }
            let result;
            try {
                result = await fn();
                if (acceptFn(result)) {
                    return result;
                }
                else {
                    lastError = 'Did not pass accept function';
                }
            }
            catch (e) {
                lastError = Array.isArray(e.stack) ? e.stack.join(os.EOL) : e.stack;
            }
            await this.wait(retryInterval);
            trial++;
        }
    }
}
exports.Code = Code;
function findElement(element, fn) {
    const queue = [element];
    while (queue.length > 0) {
        const element = queue.shift();
        if (fn(element)) {
            return element;
        }
        queue.push(...element.children);
    }
    return null;
}
function findElements(element, fn) {
    const result = [];
    const queue = [element];
    while (queue.length > 0) {
        const element = queue.shift();
        if (fn(element)) {
            result.push(element);
        }
        queue.push(...element.children);
    }
    return result;
}
// --- Start Positron ---
/**
 * Creates a minimal Code instance from a Playwright Page for use with POMs in secondary windows.
 * This is not a fully functional Code instance - only suitable for POM interactions that primarily
 * use code.driver.currentPage. Operations requiring the main process (like exit() or tracing) will not work.
 *
 * @param parentCode The parent Code instance to borrow configuration from
 * @param page The Playwright Page for the secondary window
 * @returns A minimal Code instance wrapping the given page
 */
function createCodeFromPage(parentCode, page) {
    // Create a minimal PlaywrightDriver with the new page
    const minimalOptions = {
        workspacePath: '',
        logger: parentCode.logger,
        logsPath: '',
        crashesPath: '',
        quality: parentCode.quality,
        version: parentCode.version
    };
    const driver = new playwrightDriver_1.PlaywrightDriver(parentCode.electronApp, // Use parent's electron app
    page.context(), // Get context from the page
    page, // The new page
    undefined, // No server process
    page.waitForLoadState(), // Simple load promise
    minimalOptions);
    // Create a minimal Code instance
    return new Code(driver, parentCode.logger, // Reuse parent logger
    null, // No main process
    undefined, // No safeToKill
    parentCode.quality, parentCode.version, parentCode.electronApp);
}
// --- End Positron ---
//# sourceMappingURL=code.js.map