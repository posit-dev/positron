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
exports.setFixtureScreenshot = setFixtureScreenshot;
exports.getFixtureScreenshot = getFixtureScreenshot;
exports.captureScreenshotOnError = captureScreenshotOnError;
exports.copyUserSettings = copyUserSettings;
exports.renameTempLogsDir = renameTempLogsDir;
const path_1 = __importDefault(require("path"));
const fs = __importStar(require("fs"));
const promises_1 = require("fs/promises");
const constants_1 = require("./constants");
let fixtureScreenshot;
function setFixtureScreenshot(screenshot) {
    fixtureScreenshot = screenshot;
}
function getFixtureScreenshot() {
    return fixtureScreenshot;
}
/**
 * Capture a screenshot when an error occurs in a fixture
 */
async function captureScreenshotOnError(app, logsPath, error) {
    console.error('Error occurred in fixture:', error);
    const screenshotPath = path_1.default.join(logsPath, 'fixture-failure.png');
    try {
        const page = app.code?.driver?.currentPage;
        if (page) {
            const screenshot = await page.screenshot({ path: screenshotPath });
            setFixtureScreenshot(screenshot);
        }
    }
    catch (screenshotError) {
        console.warn('Failed to capture screenshot:', screenshotError);
    }
}
/**
 * Copy user settings to the specified user data directory.
 * If running in a Docker environment, merges standard settings with Docker-specific overrides.
 *
 * @param userDir The user data directory to copy settings into
 */
async function copyUserSettings(userDir) {
    const settingsFileName = 'settings.json';
    const fixturesDir = path_1.default.join(constants_1.ROOT_PATH, 'test/e2e/fixtures');
    const settingsFile = path_1.default.join(fixturesDir, settingsFileName);
    // Start from the current settings.json in fixtures
    let mergedSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    // 1. Merge Docker-specific overrides when running in Docker
    if (fs.existsSync('/.dockerenv')) {
        const dockerSettingsFile = path_1.default.join(fixturesDir, 'settingsDocker.json');
        if (fs.existsSync(dockerSettingsFile)) {
            const dockerSettings = JSON.parse(fs.readFileSync(dockerSettingsFile, 'utf8'));
            mergedSettings = {
                ...mergedSettings,
                ...dockerSettings,
            };
        }
    }
    // 2. Merge skip-pyrefly settings if ALLOW_PYREFLY is not explicitly 'true'
    if (process.env.ALLOW_PYREFLY !== 'true') {
        const skipPyreflyFile = path_1.default.join(fixturesDir, 'settingsSkipPyrefly.json');
        if (fs.existsSync(skipPyreflyFile)) {
            const skipPyreflySettings = JSON.parse(fs.readFileSync(skipPyreflyFile, 'utf8'));
            mergedSettings = {
                ...mergedSettings,
                ...skipPyreflySettings,
            };
        }
    }
    // Write merged settings directly to user data directory (avoids race condition with shared fixture file)
    await (0, promises_1.mkdir)(userDir, { recursive: true });
    const userSettingsFile = path_1.default.join(userDir, settingsFileName);
    fs.writeFileSync(userSettingsFile, JSON.stringify(mergedSettings, null, 2));
    return userDir;
}
/**
 * Rename a temporary logs directory to a more descriptive name based on the test spec.
 * If a directory with the target name already exists, it will be overwritten.
 * If SPEC_NAME is not defined, uses a generic worker-based name.
 *
 * @param logger The logger instance to use for logging.
 * @param logsPath The path to the logs directory.
 * @param workerInfo Information about the worker process.
 * @returns A promise that resolves when the operation is complete.
 */
async function renameTempLogsDir(logger, logsPath, workerInfo) {
    const specLogsPath = path_1.default.join(path_1.default.dirname(logsPath), constants_1.SPEC_NAME || `worker-${workerInfo.workerIndex}`);
    try {
        await (0, promises_1.access)(logsPath, promises_1.constants.F_OK);
    }
    catch {
        console.error(`moveAndOverwrite: source path does not exist: ${logsPath}`);
        return 'unable to rename temp logs dir';
    }
    // check if the destination exists and delete it if so
    try {
        await (0, promises_1.access)(specLogsPath, promises_1.constants.F_OK);
        await (0, promises_1.rm)(specLogsPath, { recursive: true, force: true });
    }
    catch (err) { }
    // ensure parent directory of destination path exists
    const destinationDir = path_1.default.dirname(specLogsPath);
    await (0, promises_1.mkdir)(destinationDir, { recursive: true });
    // rename source to destination
    try {
        await (0, promises_1.rename)(logsPath, specLogsPath);
        logger.setPath(specLogsPath);
        logger.log('Logger path updated to:', specLogsPath);
    }
    catch (err) {
        logger.log(`moveAndOverwrite: failed to move ${logsPath} to ${specLogsPath}:`, err);
    }
    return specLogsPath;
}
//# sourceMappingURL=shared-utils.js.map