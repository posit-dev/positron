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
const playwrightDriver_1 = require("./playwrightDriver");
const electron_1 = require("./electron");
const logger_1 = require("./logger");
const fs = __importStar(require("fs"));
const isDocker = () => {
    return fs.existsSync('/.dockerenv');
};
async function launch(options) {
    // Resolve electron config and update
    const { electronPath, args, env } = await (0, electron_1.resolveElectronConfiguration)(options);
    args.push('--enable-smoke-test-driver');
    // the following args are required for running in docker as root
    if (isDocker()) {
        args.push('--disable-dev-shm-usage'); // required for docker
        args.push('--no-sandbox'); // required for root
        args.push('--enable-unsafe-swiftshader'); // minimize warnings related to GPU
        args.push('--use-gl=swiftshader'); // minimize warnings related to GPU
        args.push('--disable-gpu-compositing'); // minimize warnings related to GPU
    }
    // Launch electron via playwright
    const { electron, context, page } = await launchElectron({ electronPath, args, env }, options);
    const electronProcess = electron.process();
    return {
        electronProcess,
        driver: new playwrightDriver_1.PlaywrightDriver(electron, context, page, undefined /* no server process */, Promise.resolve() /* Window is open already */, options),
        electronApp: electron
    };
}
async function launchElectron(configuration, options) {
    const { logger, tracing, snapshots } = options;
    if (!fs.existsSync(configuration.electronPath || '')) {
        throw new Error(`Cannot find Positron at ${configuration.electronPath}. Please run Positron once first (scripts/code.sh, scripts\\code.bat) and try again.`);
    }
    const electron = await (0, logger_1.measureAndLog)(() => playwright._electron.launch({
        executablePath: configuration.electronPath,
        args: configuration.args,
        env: configuration.env,
        // --- Start Positron ---
        ...(options.recordVideo ? { recordVideo: options.recordVideo } : {}),
        // --- End Positron ---
        timeout: 0
    }), 'playwright-electron#launch', logger);
    let window = electron.windows()[0];
    if (!window) {
        window = await (0, logger_1.measureAndLog)(() => electron.waitForEvent('window', { timeout: 0 }), 'playwright-electron#firstWindow', logger);
    }
    const context = window.context();
    if (tracing) {
        try {
            await (0, logger_1.measureAndLog)(() => context.tracing.start({ screenshots: true, snapshots }), 'context.tracing.start()', logger);
        }
        catch (error) {
            logger.log(`Playwright (Electron): Failed to start playwright tracing (${error})`); // do not fail the build when this fails
        }
    }
    if (options.verbose) {
        electron.on('window', () => logger.log(`Playwright (Electron): electron.on('window')`));
        electron.on('close', () => logger.log(`Playwright (Electron): electron.on('close')`));
        context.on('page', () => logger.log(`Playwright (Electron): context.on('page')`));
        context.on('requestfailed', e => logger.log(`Playwright (Electron): context.on('requestfailed') [${e.failure()?.errorText} for ${e.url()}]`));
        window.on('dialog', () => logger.log(`Playwright (Electron): window.on('dialog')`));
        window.on('domcontentloaded', () => logger.log(`Playwright (Electron): window.on('domcontentloaded')`));
        window.on('load', () => logger.log(`Playwright (Electron): window.on('load')`));
        window.on('popup', () => logger.log(`Playwright (Electron): window.on('popup')`));
        window.on('framenavigated', () => logger.log(`Playwright (Electron): window.on('framenavigated')`));
        window.on('requestfailed', e => logger.log(`Playwright (Electron): window.on('requestfailed') [${e.failure()?.errorText} for ${e.url()}]`));
    }
    window.on('console', e => logger.log(`Playwright (Electron): window.on('console') [${e.text()}]`));
    window.on('pageerror', async (error) => logger.log(`Playwright (Electron) ERROR: page error: ${error}`));
    window.on('crash', () => logger.log('Playwright (Electron) ERROR: page crash'));
    window.on('close', () => logger.log('Playwright (Electron): page close'));
    window.on('response', async (response) => {
        if (response.status() >= 400) {
            logger.log(`Playwright (Electron) ERROR: HTTP status ${response.status()} for ${response.url()}`);
        }
    });
    return { electron, context, page: window };
}
//# sourceMappingURL=playwrightElectron.js.map