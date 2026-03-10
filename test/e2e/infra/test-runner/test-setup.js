"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
exports.prepareTestEnv = prepareTestEnv;
exports.getPositronVersion = getPositronVersion;
const fs = __importStar(require("fs"));
const path_1 = require("path");
const child_process_1 = require("child_process");
const rimraf = require('rimraf');
const mkdirp = require('mkdirp');
const infra_1 = require("../../infra");
const logger_1 = require("./logger");
const os = __importStar(require("os"));
const TEST_DATA_PATH = (0, path_1.join)(os.tmpdir(), 'vscsmoke');
const WEB = process.env.WEB;
const REMOTE = process.env.REMOTE;
const BUILD = process.env.BUILD;
/**
 * Prepares the test environment for Electron or E2E Web tests.
 *   1. creates logger instance `test-setup`
 *   2. initializes the test environment
 *   3. prepares the test data directory
 */
function prepareTestEnv(rootPath, logsRootPath) {
    const logger = (0, logger_1.createLogger)(logsRootPath, 'prepare-test-env.log');
    try {
        initializeTestEnvironment(rootPath, logger);
        console.log('✓ Test environment ready');
        // Disabling this section of code for now. It's used to download a stable version of VSCode
        // Maybe we would want to update this to download a stable version of Positron some day?
        // if (!OPTS.web && !OPTS.remote && OPTS.build) {
        // 	// Only enabled when running with --build and not in web or remote
        // 	version = getBuildVersion(OPTS.build);
        // 	await ensureStableCode(TEST_DATA_PATH, logger, OPTS);
        // }
        prepareTestDataDirectory();
    }
    catch (error) {
        console.error('Failed to set up the test environment:', error);
        process.exit(1);
    }
}
/**
 * Sets up the test environment for Electron or Web e2e tests.
 */
function initializeTestEnvironment(rootPath = process.env.ROOT_PATH || 'ROOT_PATH not set initTestEnv', logger) {
    let version = null;
    //
    // #### E2E: Electron Tests ####
    //
    if (!WEB) {
        let testCodePath = BUILD;
        let electronPath;
        if (testCodePath) {
            electronPath = (0, infra_1.getBuildElectronPath)(testCodePath);
            version = getPositronVersion(testCodePath);
            if (version) {
                console.log(`POSITRON VERSION: ${version.positronVersion}-${version.buildNumber}`);
            }
        }
        else {
            testCodePath = (0, infra_1.getDevElectronPath)();
            electronPath = testCodePath;
            process.env.VSCODE_REPOSITORY = rootPath;
            process.env.VSCODE_DEV = '1';
            process.env.VSCODE_CLI = '1';
        }
        if (REMOTE) {
            logger.log(`Running desktop E2E Remote tests against ${electronPath}`);
        }
        else {
            logger.log(`Running E2E Desktop tests against ${electronPath}`);
        }
    }
    //
    // #### Web E2E Tests ####
    //
    else {
        const testCodeServerPath = BUILD || process.env.VSCODE_REMOTE_SERVER_PATH;
        if (typeof testCodeServerPath === 'string') {
            if (!fs.existsSync(testCodeServerPath)) {
                throw new Error(`Cannot find Code server at ${testCodeServerPath}.`);
            }
            else {
                logger.log(`Running E2E Web tests against ${testCodeServerPath}`);
            }
        }
        if (!testCodeServerPath) {
            process.env.VSCODE_REPOSITORY = rootPath;
            process.env.VSCODE_DEV = '1';
            process.env.VSCODE_CLI = '1';
            logger.log(`Running E2E Web out of sources`);
        }
    }
    return version;
}
/**
 * Cleans and prepares the test data directory.
 */
function prepareTestDataDirectory() {
    // skipping deletion if running in CI because extensions setup case needs to be able to leave behind its extensions
    if (!process.env.CI && fs.existsSync(TEST_DATA_PATH)) {
        rimraf.sync(TEST_DATA_PATH);
    }
    mkdirp.sync(TEST_DATA_PATH);
}
function getPositronVersion(testCodePath = process.env.BUILD || '') {
    // Dev mode - use version script directly
    if (!testCodePath) {
        return getVersionFromScript();
    }
    // Running against a build - read from built app's product.json
    return getVersionFromBuild(testCodePath);
}
/**
 * Get version info from the version script (dev mode)
 */
function getVersionFromScript() {
    const root = (0, path_1.join)(__dirname, '..', '..', '..', '..');
    const scriptPath = (0, path_1.join)(root, 'versions', 'show-version.cjs');
    try {
        const positronVersion = (0, child_process_1.execSync)(`node "${scriptPath}" --version`).toString().trim();
        const buildOutput = (0, child_process_1.execSync)(`node "${scriptPath}" --build`).toString().trim();
        const buildNumber = parseInt(buildOutput, 10);
        if (!positronVersion) {
            console.warn('Version script returned empty version');
            return null;
        }
        return {
            positronVersion,
            buildNumber: Number.isNaN(buildNumber) ? 0 : buildNumber
        };
    }
    catch (e) {
        console.warn('Failed to get version from script:', e);
        return null;
    }
}
/**
 * Get version info from a built application's product.json
 */
function getVersionFromBuild(testCodePath) {
    let productJsonPath;
    switch (process.platform) {
        case 'darwin':
            productJsonPath = (0, path_1.join)(testCodePath, 'Contents', 'Resources', 'app', 'product.json');
            break;
        case 'linux':
            productJsonPath = (0, path_1.join)(testCodePath, 'resources', 'app', 'product.json');
            break;
        case 'win32':
            productJsonPath = (0, path_1.join)(testCodePath, 'resources', 'app', 'product.json');
            break;
        default:
            return null;
    }
    try {
        const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
        const positronVersion = productJson.positronVersion ?? null;
        const buildNumber = productJson.positronBuildNumber ?? 0;
        if (!positronVersion) {
            throw new Error('positronVersion not found in product.json.');
        }
        return { positronVersion, buildNumber };
    }
    catch (error) {
        console.error('Error reading product.json:', error);
        return null;
    }
}
//# sourceMappingURL=test-setup.js.map