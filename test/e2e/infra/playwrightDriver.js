"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightDriver = void 0;
exports.wait = wait;
const path_1 = require("path");
const fs_1 = require("fs");
const logger_1 = require("./logger");
const processes_1 = require("./processes");
// Load axe-core source for injection into pages (works with Electron)
let axeSource = '';
try {
    const axePath = require.resolve('axe-core/axe.min.js');
    axeSource = (0, fs_1.readFileSync)(axePath, 'utf-8');
}
catch {
    // axe-core may not be installed; keep axeSource empty to avoid failing module initialization
    axeSource = '';
}
class PlaywrightDriver {
    application;
    context;
    _currentPage;
    serverProcess;
    whenLoaded;
    options;
    static traceCounter = 1;
    static screenShotCounter = 1;
    static vscodeToPlaywrightKey = {
        cmd: 'Meta',
        ctrl: 'Control',
        shift: 'Shift',
        enter: 'Enter',
        escape: 'Escape',
        right: 'ArrowRight',
        up: 'ArrowUp',
        down: 'ArrowDown',
        left: 'ArrowLeft',
        home: 'Home',
        esc: 'Escape'
    };
    constructor(application, context, _currentPage, serverProcess, whenLoaded, options) {
        this.application = application;
        this.context = context;
        this._currentPage = _currentPage;
        this.serverProcess = serverProcess;
        this.whenLoaded = whenLoaded;
        this.options = options;
    }
    get browserContext() {
        return this.context;
    }
    get page() {
        return this._currentPage;
    }
    get currentPage() {
        return this._currentPage;
    }
    /**
     * Get all open windows/pages.
     * For Electron apps, returns all Electron windows.
     * For browser contexts, returns all pages.
     */
    getAllWindows() {
        if ('windows' in this.application) {
            return this.application.windows();
        }
        return this.context.pages();
    }
    /**
     * Switch to a different window by index or URL pattern.
     * @param indexOrUrl - Window index (0-based) or a string to match against the URL.
     *                     When using a string, it first tries to find an exact URL match,
     *                     then falls back to finding the first URL that contains the pattern.
     * @returns The switched-to page, or undefined if not found
     * @note When switching windows, any existing CDP session will be cleared since it
     *       remains attached to the previous page and cannot be used with the new page.
     */
    switchToWindow(indexOrUrl) {
        const windows = this.getAllWindows();
        if (typeof indexOrUrl === 'number') {
            if (indexOrUrl >= 0 && indexOrUrl < windows.length) {
                this._currentPage = windows[indexOrUrl];
                // Clear CDP session as it's attached to the previous page
                this._cdpSession = undefined;
                return this._currentPage;
            }
        }
        else {
            // First try exact match, then fall back to substring match
            let found = windows.find(w => w.url() === indexOrUrl);
            if (!found) {
                found = windows.find(w => w.url().includes(indexOrUrl));
            }
            if (found) {
                this._currentPage = found;
                // Clear CDP session as it's attached to the previous page
                this._cdpSession = undefined;
                return this._currentPage;
            }
        }
        return undefined;
    }
    /**
     * Get information about all windows.
     */
    getWindowsInfo() {
        const windows = this.getAllWindows();
        return windows.map((p, index) => ({
            index,
            url: p.url(),
            isCurrent: p === this._currentPage
        }));
    }
    /**
     * Take a screenshot of the current window.
     * @param fullPage - Whether to capture the full scrollable page
     * @returns Screenshot as a Buffer
     */
    async screenshotBuffer(fullPage = false) {
        return await this.page.screenshot({
            type: 'png',
            fullPage
        });
    }
    /**
     * Get the accessibility snapshot of the current window.
     */
    async getAccessibilitySnapshot() {
        return await this.page.accessibility.snapshot();
    }
    /**
     * Click on an element using CSS selector with options.
     */
    async clickSelector(selector, options) {
        await this.page.click(selector, {
            button: options?.button ?? 'left',
            clickCount: options?.clickCount ?? 1
        });
    }
    /**
     * Type text into an element.
     * @param selector - CSS selector for the element
     * @param text - Text to type
     * @param slowly - Whether to type character by character (triggers key events)
     */
    async typeText(selector, text, slowly = false) {
        if (slowly) {
            await this.page.type(selector, text, { delay: 50 });
        }
        else {
            await this.page.fill(selector, text);
        }
    }
    /**
     * Evaluate a JavaScript expression in the current window.
     */
    async evaluateExpression(expression) {
        return await this.page.evaluate(expression);
    }
    /**
     * Get information about elements matching a selector.
     */
    async getLocatorInfo(selector, action) {
        const locator = this.page.locator(selector);
        switch (action) {
            case 'count':
                return await locator.count();
            case 'textContent':
                return await locator.allTextContents();
            case 'innerHTML':
                return await locator.allInnerTexts();
            case 'boundingBox':
                return await locator.first().boundingBox();
            case 'isVisible':
                return await locator.first().isVisible();
            default:
                return {
                    count: await locator.count(),
                    firstVisible: await locator.first().isVisible().catch(() => false)
                };
        }
    }
    /**
     * Wait for an element to reach a specific state.
     */
    async waitForElement(selector, options) {
        await this.page.waitForSelector(selector, {
            state: options?.state ?? 'visible',
            timeout: options?.timeout ?? 30000
        });
    }
    /**
     * Hover over an element.
     */
    async hoverSelector(selector) {
        await this.page.hover(selector);
    }
    /**
     * Drag from one element to another.
     */
    async dragSelector(sourceSelector, targetSelector) {
        await this.page.dragAndDrop(sourceSelector, targetSelector);
    }
    /**
     * Press a key or key combination.
     */
    async pressKey(key) {
        await this.page.keyboard.press(key);
    }
    /**
     * Move mouse to a specific position.
     */
    async mouseMove(x, y) {
        await this.page.mouse.move(x, y);
    }
    /**
     * Click at a specific position.
     */
    async mouseClick(x, y, options) {
        await this.page.mouse.click(x, y, {
            button: options?.button ?? 'left',
            clickCount: options?.clickCount ?? 1
        });
    }
    /**
     * Drag from one position to another.
     */
    async mouseDrag(startX, startY, endX, endY) {
        await this.page.mouse.move(startX, startY);
        await this.page.mouse.down();
        await this.page.mouse.move(endX, endY);
        await this.page.mouse.up();
    }
    /**
     * Select an option in a dropdown.
     */
    async selectOption(selector, value) {
        return await this.page.selectOption(selector, value);
    }
    /**
     * Fill multiple form fields at once.
     */
    async fillForm(fields) {
        for (const field of fields) {
            await this.page.fill(field.selector, field.value);
        }
    }
    /**
     * Get console messages from the current window.
     */
    async getConsoleMessages() {
        const messages = await this.page.consoleMessages();
        return messages.map(m => ({
            type: m.type(),
            text: m.text()
        }));
    }
    /**
     * Wait for text to appear, disappear, or a specified time to pass.
     */
    async waitForText(options) {
        const { text, textGone, timeout = 30000 } = options;
        if (text) {
            await this.page.getByText(text).first().waitFor({ state: 'visible', timeout });
        }
        if (textGone) {
            await this.page.getByText(textGone).first().waitFor({ state: 'hidden', timeout });
        }
    }
    /**
     * Wait for a specified time in milliseconds.
     */
    async waitForTime(ms) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Verify an element is visible.
     */
    async verifyElementVisible(selector) {
        try {
            await this.page.locator(selector).first().waitFor({ state: 'visible', timeout: 5000 });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Verify text is visible on the page.
     */
    async verifyTextVisible(text) {
        try {
            await this.page.getByText(text).first().waitFor({ state: 'visible', timeout: 5000 });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Get the value of an input element.
     */
    async getInputValue(selector) {
        return await this.page.inputValue(selector);
    }
    /**
     * Returns the browser type used for this driver (e.g., 'chromium', 'webkit', 'firefox', 'chromium-msedge').
     */
    get browser() {
        return this.options.browser;
    }
    async startTracing(name) {
        if (!this.options.tracing) {
            return; // tracing disabled
        }
        try {
            await (0, logger_1.measureAndLog)(() => this.context.tracing.startChunk({ title: name }), `startTracing${name ? ` for ${name}` : ''}`, this.options.logger);
        }
        catch (error) {
            // Tracing may not have initialized successfully on some browsers - ignore
        }
    }
    // --- Start Positron ---
    async stopTracing(name, persist = false, customPath) {
        // --- End Positron ---
        if (!this.options.tracing) {
            return; // tracing disabled
        }
        try {
            let persistPath = undefined;
            if (persist) {
                // --- Start Positron ---
                persistPath = customPath || (0, path_1.join)(this.options.logsPath, `playwright-trace-${PlaywrightDriver.traceCounter++}-${name ? name.replace(/\s+/g, '-') : ''}.zip`);
                // --- End Positron ---
            }
            await (0, logger_1.measureAndLog)(() => this.context.tracing.stopChunk({ path: persistPath }), `stopTracing${name ? ` for ${name}` : ''}`, this.options.logger);
        }
        catch (error) {
            // Ignore
        }
    }
    async didFinishLoad() {
        await this.whenLoaded;
    }
    _cdpSession;
    async startCDP() {
        if (this._cdpSession) {
            return;
        }
        this._cdpSession = await this.page.context().newCDPSession(this.page);
    }
    async collectGarbage() {
        if (!this._cdpSession) {
            throw new Error('CDP not started');
        }
        await this._cdpSession.send('HeapProfiler.collectGarbage');
    }
    async evaluate(options) {
        if (!this._cdpSession) {
            throw new Error('CDP not started');
        }
        return await this._cdpSession.send('Runtime.evaluate', options);
    }
    async releaseObjectGroup(parameters) {
        if (!this._cdpSession) {
            throw new Error('CDP not started');
        }
        await this._cdpSession.send('Runtime.releaseObjectGroup', parameters);
    }
    async queryObjects(parameters) {
        if (!this._cdpSession) {
            throw new Error('CDP not started');
        }
        return await this._cdpSession.send('Runtime.queryObjects', parameters);
    }
    async callFunctionOn(parameters) {
        if (!this._cdpSession) {
            throw new Error('CDP not started');
        }
        return await this._cdpSession.send('Runtime.callFunctionOn', parameters);
    }
    async takeHeapSnapshot() {
        if (!this._cdpSession) {
            throw new Error('CDP not started');
        }
        let snapshot = '';
        const listener = (c) => {
            snapshot += c.chunk;
        };
        this._cdpSession.addListener('HeapProfiler.addHeapSnapshotChunk', listener);
        await this._cdpSession.send('HeapProfiler.takeHeapSnapshot');
        this._cdpSession.removeListener('HeapProfiler.addHeapSnapshotChunk', listener);
        return snapshot;
    }
    async getProperties(parameters) {
        if (!this._cdpSession) {
            throw new Error('CDP not started');
        }
        return await this._cdpSession.send('Runtime.getProperties', parameters);
    }
    // --- Start Positron ---
    // Changed from private to public for e2e test fixture screenshot capturing
    // --- End Positron ---
    async takeScreenshot(name) {
        try {
            const nameSuffix = name ? `-${name.replace(/\s+/g, '-')}` : '';
            const persistPath = (0, path_1.join)(this.options.logsPath, `playwright-screenshot-${PlaywrightDriver.screenShotCounter++}${nameSuffix}.png`);
            await (0, logger_1.measureAndLog)(() => this.page.screenshot({ path: persistPath, type: 'png' }), 'takeScreenshot', this.options.logger);
        }
        catch (error) {
            // Ignore
        }
    }
    async reload() {
        await this.page.reload();
    }
    async close() {
        // Stop tracing
        try {
            if (this.options.tracing) {
                await (0, logger_1.measureAndLog)(() => this.context.tracing.stop(), 'stop tracing', this.options.logger);
            }
        }
        catch (error) {
            // Tracing may not have initialized successfully on some browsers - ignore
        }
        // Web: Extract client logs
        if (this.options.web) {
            try {
                await (0, logger_1.measureAndLog)(() => this.saveWebClientLogs(), 'saveWebClientLogs()', this.options.logger);
            }
            catch (error) {
                this.options.logger.log(`Error saving web client logs (${error})`);
            }
        }
        //  exit via `close` method
        try {
            await (0, logger_1.measureAndLog)(() => this.application.close(), 'playwright.close()', this.options.logger);
        }
        catch (error) {
            this.options.logger.log(`Error closing application (${error})`);
        }
        // Server: via `teardown`
        if (this.serverProcess) {
            await (0, logger_1.measureAndLog)(() => (0, processes_1.teardown)(this.serverProcess, this.options.logger), 'teardown server process', this.options.logger);
        }
        // --- Start Positron ---
        // Wait for child process handles to drain after application closes
        // This gives time for ChildProcess, Socket, Pipe, and WriteWrap handles to close
        // before the test worker attempts to tear down
        try {
            await (0, logger_1.measureAndLog)(() => this.wait(2000), 'wait for handles to drain', this.options.logger);
        }
        catch (error) {
            this.options.logger.log(`Error during handle drain wait (${error})`);
        }
        // --- End Positron ---
    }
    async saveWebClientLogs() {
        const logs = await this.getLogs();
        for (const log of logs) {
            const absoluteLogsPath = (0, path_1.join)(this.options.logsPath, log.relativePath);
            await fs_1.promises.mkdir((0, path_1.dirname)(absoluteLogsPath), { recursive: true });
            await fs_1.promises.writeFile(absoluteLogsPath, log.contents);
        }
    }
    async sendKeybinding(keybinding, accept) {
        const chords = keybinding.split(' ');
        for (let i = 0; i < chords.length; i++) {
            const chord = chords[i];
            if (i > 0) {
                await this.wait(100);
            }
            if (keybinding.startsWith('Alt') || keybinding.startsWith('Control') || keybinding.startsWith('Backspace')) {
                await this.page.keyboard.press(keybinding);
                return;
            }
            const keys = chord.split('+');
            const keysDown = [];
            for (let i = 0; i < keys.length; i++) {
                if (keys[i] in PlaywrightDriver.vscodeToPlaywrightKey) {
                    keys[i] = PlaywrightDriver.vscodeToPlaywrightKey[keys[i]];
                }
                await this.page.keyboard.down(keys[i]);
                keysDown.push(keys[i]);
            }
            while (keysDown.length > 0) {
                await this.page.keyboard.up(keysDown.pop());
            }
        }
        await accept?.();
    }
    async click(selector, xoffset, yoffset) {
        const { x, y } = await this.getElementXY(selector, xoffset, yoffset);
        await this.page.mouse.click(x + (xoffset ? xoffset : 0), y + (yoffset ? yoffset : 0));
    }
    async setValue(selector, text) {
        return this.page.evaluate(([driver, selector, text]) => driver.setValue(selector, text), [await this.getDriverHandle(), selector, text]);
    }
    async getTitle() {
        return this.page.title();
    }
    async isActiveElement(selector) {
        return this.page.evaluate(([driver, selector]) => driver.isActiveElement(selector), [await this.getDriverHandle(), selector]);
    }
    async getElements(selector, recursive = false) {
        return this.page.evaluate(([driver, selector, recursive]) => driver.getElements(selector, recursive), [await this.getDriverHandle(), selector, recursive]);
    }
    async getElementXY(selector, xoffset, yoffset) {
        return this.page.evaluate(([driver, selector, xoffset, yoffset]) => driver.getElementXY(selector, xoffset, yoffset), [await this.getDriverHandle(), selector, xoffset, yoffset]);
    }
    async typeInEditor(selector, text) {
        return this.page.evaluate(([driver, selector, text]) => driver.typeInEditor(selector, text), [await this.getDriverHandle(), selector, text]);
    }
    async getEditorSelection(selector) {
        return this.page.evaluate(([driver, selector]) => driver.getEditorSelection(selector), [await this.getDriverHandle(), selector]);
    }
    async getTerminalBuffer(selector) {
        return this.page.evaluate(([driver, selector]) => driver.getTerminalBuffer(selector), [await this.getDriverHandle(), selector]);
    }
    async writeInTerminal(selector, text) {
        return this.page.evaluate(([driver, selector, text]) => driver.writeInTerminal(selector, text), [await this.getDriverHandle(), selector, text]);
    }
    async getLocaleInfo() {
        return this.evaluateWithDriver(([driver]) => driver.getLocaleInfo());
    }
    async getLocalizedStrings() {
        return this.evaluateWithDriver(([driver]) => driver.getLocalizedStrings());
    }
    async getLogs() {
        return this.page.evaluate(([driver]) => driver.getLogs(), [await this.getDriverHandle()]);
    }
    async evaluateWithDriver(pageFunction) {
        return this.page.evaluate(pageFunction, [await this.getDriverHandle()]);
    }
    wait(ms) {
        return wait(ms);
    }
    whenWorkbenchRestored() {
        return this.evaluateWithDriver(([driver]) => driver.whenWorkbenchRestored());
    }
    async getDriverHandle() {
        return this.page.evaluateHandle('window.driver');
    }
    async isAlive() {
        try {
            await this.getDriverHandle();
            return true;
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Run an accessibility scan on the current page using axe-core.
     * Uses direct script injection to work with Electron.
     * @param options Configuration options for the accessibility scan.
     * @returns The axe-core scan results including any violations found.
     */
    async runAccessibilityScan(options) {
        // Inject axe-core into the page if not already present
        await this.page.evaluate(axeSource);
        // Build axe-core run options
        const runOptions = {
            runOnly: {
                type: 'tag',
                values: options?.tags ?? ['wcag2a', 'wcag2aa', 'wcag21aa']
            }
        };
        // Disable specific rules if requested
        if (options?.disableRules && options.disableRules.length > 0) {
            runOptions.rules = {};
            for (const ruleId of options.disableRules) {
                runOptions.rules[ruleId] = { enabled: false };
            }
        }
        // Build context for axe.run
        const context = {};
        if (options?.selector) {
            context.include = [options.selector];
        }
        // Exclude known problematic areas
        context.exclude = [
            ['.monaco-editor .view-lines'],
            ['.xterm-screen canvas']
        ];
        // Run axe-core analysis
        const results = await (0, logger_1.measureAndLog)(() => this.page.evaluate(([ctx, opts]) => {
            // @ts-expect-error axe is injected globally
            return window.axe.run(ctx, opts);
        }, [context, runOptions]), 'runAccessibilityScan', this.options.logger);
        return results;
    }
    /**
     * Run an accessibility scan and throw an error if any violations are found.
     * @param options Configuration options for the accessibility scan.
     * @throws Error if accessibility violations are detected.
     */
    async assertNoAccessibilityViolations(options) {
        const results = await this.runAccessibilityScan(options);
        // Filter out violations for specific elements based on excludeRules
        let filteredViolations = results.violations;
        if (options?.excludeRules) {
            filteredViolations = results.violations.map((violation) => {
                const excludePatterns = options.excludeRules[violation.id];
                if (!excludePatterns) {
                    return violation;
                }
                // Filter out nodes that match any of the exclude patterns
                const filteredNodes = violation.nodes.filter((node) => {
                    const target = node.target.join(' ');
                    const html = node.html || '';
                    // Check if any exclude pattern appears in target or HTML
                    return !excludePatterns.some(pattern => target.includes(pattern) || html.includes(pattern));
                });
                return { ...violation, nodes: filteredNodes };
            }).filter((violation) => violation.nodes.length > 0);
        }
        if (filteredViolations.length > 0) {
            const violationMessages = filteredViolations.map((violation) => {
                const nodes = violation.nodes.map((node) => {
                    const target = node.target.join(' > ');
                    const html = node.html || 'N/A';
                    // Extract class from HTML for easier identification
                    const classMatch = html.match(/class="([^"]+)"/);
                    const className = classMatch ? classMatch[1] : 'no class';
                    return [
                        `  Element: ${target}`,
                        `    Class: ${className}`,
                        `    HTML: ${html}`,
                        `    Issue: ${node.failureSummary}`
                    ].join('\n');
                }).join('\n\n');
                return [
                    `[${violation.id}] ${violation.help} (${violation.impact})`,
                    `  Help URL: ${violation.helpUrl}`,
                    nodes
                ].join('\n');
            }).join('\n\n---\n\n');
            throw new Error(`Accessibility violations found:\n\n${violationMessages}\n\n` +
                `Total: ${filteredViolations.length} violation(s) affecting ${filteredViolations.reduce((sum, v) => sum + v.nodes.length, 0)} element(s)`);
        }
    }
    async clickAndDrag(opts) {
        const from = opts.from;
        const to = opts.to ?? { x: from.x + (opts.delta?.x ?? 0), y: from.y + (opts.delta?.y ?? 0) };
        await this.page.mouse.move(from.x, from.y);
        await this.page.mouse.down();
        await this.page.mouse.move(to.x, to.y);
        await this.page.mouse.up();
    }
}
exports.PlaywrightDriver = PlaywrightDriver;
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=playwrightDriver.js.map