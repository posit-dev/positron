"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
exports.launch = launch;
const playwright = __importStar(require("@playwright/test"));
const vscode_uri_1 = require("vscode-uri");
const logger_1 = require("./logger");
const playwrightDriver_1 = require("./playwrightDriver");
/**
 * Launches a browser against an external server (e.g., one started via ./scripts/code-server.sh)
 */
async function launch(options, serverUrl) {
    // Launch browser
    const { browser, context, page, pageLoadedPromise } = await launchBrowser(options, serverUrl);
    return {
        driver: new playwrightDriver_1.PlaywrightDriver(browser, context, page, undefined, pageLoadedPromise, options)
    };
}
async function launchBrowser(options, serverUrl) {
    const { logger, workspacePath, tracing, snapshots, headless } = options;
    const [browserType, browserChannel] = (options.browser ?? 'chromium').split('-');
    const browser = await (0, logger_1.measureAndLog)(() => playwright[browserType].launch({
        headless: headless ?? false,
        timeout: 0,
        channel: browserChannel,
    }), 'playwright#launch', logger);
    browser.on('disconnected', () => logger.log(`Playwright: browser disconnected`));
    const context = await (0, logger_1.measureAndLog)(() => browser.newContext(), 'browser.newContext', logger);
    if (tracing) {
        try {
            await (0, logger_1.measureAndLog)(() => context.tracing.start({ screenshots: true, snapshots }), 'context.tracing.start()', logger);
            // Prevent duplicate tracing start calls
            context.tracing.start = async (...args) => {
                logger.log('Tracing is already managed, skipping default tracing start.');
            };
        }
        catch (error) {
            logger.log(`Playwright (External Server): Failed to start playwright tracing (${error})`);
        }
    }
    const page = await (0, logger_1.measureAndLog)(() => context.newPage(), 'context.newPage()', logger);
    await (0, logger_1.measureAndLog)(() => page.setViewportSize({ width: 1200, height: 800 }), 'page.setViewportSize', logger);
    if (options.verbose) {
        context.on('page', () => logger.log(`Playwright (External Server): context.on('page')`));
        context.on('requestfailed', e => logger.log(`Playwright (External Server): context.on('requestfailed') [${e.failure()?.errorText} for ${e.url()}]`));
        page.on('console', e => logger.log(`Playwright (External Server): window.on('console') [${e.text()}]`));
        page.on('dialog', () => logger.log(`Playwright (External Server): page.on('dialog')`));
        page.on('domcontentloaded', () => logger.log(`Playwright (External Server): page.on('domcontentloaded')`));
        page.on('load', () => logger.log(`Playwright (External Server): page.on('load')`));
        page.on('popup', () => logger.log(`Playwright (External Server): page.on('popup')`));
        page.on('framenavigated', () => logger.log(`Playwright (External Server): page.on('framenavigated')`));
        page.on('requestfailed', e => logger.log(`Playwright (External Server): page.on('requestfailed') [${e.failure()?.errorText} for ${e.url()}]`));
    }
    page.on('pageerror', async (error) => logger.log(`Playwright (External Server) ERROR: page error: ${error}`));
    page.on('crash', () => logger.log('Playwright (External Server) ERROR: page crash'));
    page.on('close', () => logger.log('Playwright (External Server): page close'));
    page.on('response', async (response) => {
        if (response.status() >= 400) {
            logger.log(`Playwright (External Server) ERROR: HTTP status ${response.status()} for ${response.url()}`);
        }
    });
    const payloadParam = `[${[
        '["enableProposedApi",""]',
        '["skipWelcome", "true"]',
        '["skipReleaseNotes", "true"]',
        `["logLevel","${options.verbose ? 'trace' : 'info'}"]`
    ].join(',')}]`;
    // Construct URL for external server
    let fullUrl;
    if (serverUrl.includes(':8787')) {
        // Workbench doesn't use VS Code-specific parameters, so just connect to the base URL
        fullUrl = serverUrl;
    }
    else {
        // Default VS Code server behavior (e.g., port 8080)
        const workspaceParam = workspacePath.endsWith('.code-workspace') ? 'workspace' : 'folder';
        const separator = serverUrl.includes('?') ? '&' : '?';
        fullUrl = `${serverUrl}${separator}${workspaceParam}=${vscode_uri_1.URI.file(workspacePath).path}&payload=${payloadParam}`;
    }
    logger.log(`Connecting to external server: ${fullUrl}`);
    const gotoPromise = (0, logger_1.measureAndLog)(() => page.goto(fullUrl), 'page.goto() [external server]', logger);
    const pageLoadedPromise = page.waitForLoadState('load');
    await gotoPromise;
    return { browser, context, page, pageLoadedPromise };
}
//# sourceMappingURL=playwrightExternalServer.js.map