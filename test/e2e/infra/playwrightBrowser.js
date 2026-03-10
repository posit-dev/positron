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
Object.defineProperty(exports, "__esModule", { value: true });
exports.launch = launch;
const playwright = __importStar(require("@playwright/test"));
const child_process_1 = require("child_process");
const path_1 = require("path");
const fs = __importStar(require("fs"));
const vscode_uri_1 = require("vscode-uri");
const logger_1 = require("./logger");
const playwrightDriver_1 = require("./playwrightDriver");
const root = (0, path_1.join)(__dirname, '..', '..', '..');
let port = 9000;
async function launch(options) {
    // Launch server
    const { serverProcess, endpoint } = await launchServer(options);
    // Launch browser
    const { browser, context, page, pageLoadedPromise } = await launchBrowser(options, endpoint);
    return {
        serverProcess,
        driver: new playwrightDriver_1.PlaywrightDriver(browser, context, page, serverProcess, pageLoadedPromise, options)
    };
}
// Modified `launchServer` function to add support for multiple ports to enable parallel test
// execution of browser tests. Also added helper functions: `getServerArgs`, `resolveServerLocation`,
// and `startServer` to make this code easier to read.
async function launchServer(options) {
    const { userDataDir, codePath, extensionsPath, logger, logsPath } = options;
    const serverLogsPath = (0, path_1.join)(logsPath, 'server');
    const codeServerPath = codePath ?? process.env.VSCODE_REMOTE_SERVER_PATH;
    const agentFolder = userDataDir;
    if (!agentFolder || !extensionsPath) {
        throw new Error('Cannot launch server with undefined userDataDir');
    }
    await (0, logger_1.measureAndLog)(() => fs.promises.mkdir(agentFolder, { recursive: true }), `mkdirp(${agentFolder})`, logger);
    const env = {
        VSCODE_REMOTE_SERVER_PATH: codeServerPath,
        ...process.env,
    };
    const maxRetries = 10;
    let serverProcess = null;
    let endpoint;
    for (let attempts = 0; attempts < maxRetries; attempts++) {
        const currentPort = port++;
        const args = getServerArgs(currentPort, extensionsPath, agentFolder, serverLogsPath, options.verbose);
        const serverLocation = resolveServerLocation(codeServerPath, logger);
        logger.log(`Attempting to start server on port ${currentPort}`);
        logger.log(`Command: '${serverLocation}' ${args.join(' ')}`);
        try {
            serverProcess = await startServer(serverLocation, args, env, logger);
            endpoint = await (0, logger_1.measureAndLog)(() => waitForEndpoint(serverProcess, logger), 'waitForEndpoint(serverProcess)', logger);
            logger.log(`Server started successfully on port ${currentPort}`);
            break; // Exit loop on success
        }
        catch (error) {
            if (error.message.includes('EADDRINUSE')) {
                logger.log(`Port ${currentPort} is already in use. Retrying...`);
                serverProcess?.kill();
            }
            else {
                throw error; // Rethrow non-port-related errors
            }
        }
    }
    if (!serverProcess || !endpoint) {
        throw new Error('Failed to launch the server after multiple attempts.');
    }
    return { serverProcess, endpoint };
}
function getServerArgs(port, extensionsPath, agentFolder, logsPath, verbose) {
    const args = [
        '--disable-telemetry',
        '--disable-experiments',
        '--disable-workspace-trust',
        `--port=${port}`,
        '--enable-smoke-test-driver',
        `--extensions-dir=${extensionsPath}`,
        `--server-data-dir=${agentFolder}`,
        '--accept-server-license-terms',
        `--logsPath=${logsPath}`,
        '--connection-token',
        'dev-token',
    ];
    if (verbose) {
        args.push('--log=trace');
    }
    return args;
}
function resolveServerLocation(codeServerPath, logger) {
    if (codeServerPath) {
        const { serverApplicationName } = require((0, path_1.join)(codeServerPath, 'product.json'));
        const serverLocation = (0, path_1.join)(codeServerPath, 'bin', `${serverApplicationName}${process.platform === 'win32' ? '.cmd' : ''}`);
        logger.log(`Using built server from '${serverLocation}'`);
        return serverLocation;
    }
    const scriptPath = (0, path_1.join)(root, `scripts/code-server.${process.platform === 'win32' ? 'bat' : 'sh'}`);
    logger.log(`Using source server from '${scriptPath}'`);
    return scriptPath;
}
async function startServer(serverLocation, args, env, logger) {
    logger.log(`Starting server: ${serverLocation}`);
    const serverProcess = (0, child_process_1.spawn)(serverLocation, args, { env, shell: process.platform === 'win32' });
    logger.log(`Server started (pid: ${serverProcess.pid})`);
    return serverProcess;
}
async function launchBrowser(options, endpoint) {
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
            // --- Start Positron ---
            // Yes, this is hacky, but we are unable to disable default tracing in Playwright browser tests
            // See related discussion: https://github.com/microsoft/playwright/issues/33303#issuecomment-2442096479
            context.tracing.start = async (...args) => {
                logger.log('Tracing is already managed, skipping default tracing start.');
            };
            // --- End Positron ---
        }
        catch (error) {
            logger.log(`Playwright (Browser): Failed to start playwright tracing (${error})`); // do not fail the build when this fails
        }
    }
    const page = await (0, logger_1.measureAndLog)(() => context.newPage(), 'context.newPage()', logger);
    await (0, logger_1.measureAndLog)(() => page.setViewportSize({ width: 1200, height: 800 }), 'page.setViewportSize', logger);
    if (options.verbose) {
        context.on('page', () => logger.log(`Playwright (Browser): context.on('page')`));
        context.on('requestfailed', e => logger.log(`Playwright (Browser): context.on('requestfailed') [${e.failure()?.errorText} for ${e.url()}]`));
        page.on('console', e => logger.log(`Playwright (Browser): window.on('console') [${e.text()}]`));
        page.on('dialog', () => logger.log(`Playwright (Browser): page.on('dialog')`));
        page.on('domcontentloaded', () => logger.log(`Playwright (Browser): page.on('domcontentloaded')`));
        page.on('load', () => logger.log(`Playwright (Browser): page.on('load')`));
        page.on('popup', () => logger.log(`Playwright (Browser): page.on('popup')`));
        page.on('framenavigated', () => logger.log(`Playwright (Browser): page.on('framenavigated')`));
        page.on('requestfailed', e => logger.log(`Playwright (Browser): page.on('requestfailed') [${e.failure()?.errorText} for ${e.url()}]`));
    }
    page.on('pageerror', async (error) => logger.log(`Playwright (Browser) ERROR: page error: ${error}`));
    page.on('crash', () => logger.log('Playwright (Browser) ERROR: page crash'));
    page.on('close', () => logger.log('Playwright (Browser): page close'));
    page.on('response', async (response) => {
        if (response.status() >= 400) {
            logger.log(`Playwright (Browser) ERROR: HTTP status ${response.status()} for ${response.url()}`);
        }
    });
    const payloadParam = `[${[
        '["enableProposedApi",""]',
        '["skipWelcome", "true"]',
        '["skipReleaseNotes", "true"]',
        `["logLevel","${options.verbose ? 'trace' : 'info'}"]`
    ].join(',')}]`;
    // Build URL with optional workspace path
    let url = `${endpoint}&`;
    if (workspacePath) {
        const workspaceParam = workspacePath.endsWith('.code-workspace') ? 'workspace' : 'folder';
        url += `${workspaceParam}=${vscode_uri_1.URI.file(workspacePath).path}&`;
    }
    url += `payload=${payloadParam}`;
    const gotoPromise = (0, logger_1.measureAndLog)(() => page.goto(url), 'page.goto()', logger);
    const pageLoadedPromise = page.waitForLoadState('load');
    await gotoPromise;
    return { browser, context, page, pageLoadedPromise };
}
function waitForEndpoint(server, logger) {
    return new Promise((resolve, reject) => {
        let endpointFound = false;
        server.stdout?.on('data', data => {
            if (!endpointFound) {
                logger.log(`[server] stdout: ${data}`); // log until endpoint found to diagnose issues
            }
            const matches = data.toString('ascii').match(/Web UI available at (.+)/);
            if (matches !== null) {
                endpointFound = true;
                resolve(matches[1]);
            }
        });
        server.stderr?.on('data', error => {
            if (!endpointFound) {
                logger.log(`[server] stderr: ${error}`); // log until endpoint found to diagnose issues
            }
            if (error.toString().indexOf('EADDRINUSE') !== -1) {
                reject(new Error(error));
            }
        });
    });
}
//# sourceMappingURL=playwrightBrowser.js.map