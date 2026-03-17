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
exports.OptionsFixture = OptionsFixture;
exports.UserDataDirFixture = UserDataDirFixture;
const path_1 = require("path");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const infra_1 = require("../../infra");
const constants_1 = require("./constants");
const shared_utils_js_1 = require("./shared-utils.js");
function OptionsFixture() {
    return async (logsPath, logger, snapshots, project, workerInfo) => {
        const TEST_DATA_PATH = (0, path_1.join)(os.tmpdir(), 'vscsmoke');
        const EXTENSIONS_PATH = (0, path_1.join)(TEST_DATA_PATH, 'extensions-dir');
        const WORKSPACE_PATH = (0, path_1.join)(TEST_DATA_PATH, 'qa-example-content');
        const SPEC_CRASHES_PATH = (0, path_1.join)(constants_1.ROOT_PATH, '.build', 'crashes', project.artifactDir, constants_1.TEMP_DIR);
        // get the version from package.json
        const packageJsonPath = (0, path_1.join)(constants_1.ROOT_PATH, 'package.json');
        const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8'));
        const packageVersion = packageJson.version || '0.0.0';
        const version = {
            major: parseInt(packageVersion.split('.')[0], 10),
            minor: parseInt(packageVersion.split('.')[1], 10),
            patch: parseInt(packageVersion.split('.')[2], 10),
        };
        let browser = project.browserName;
        const channel = workerInfo.project.use.channel;
        if (project.browserName === "chromium" && channel) {
            browser = `chromium-${channel}`;
        }
        const options = {
            codePath: process.env.BUILD,
            workspacePath: WORKSPACE_PATH,
            userDataDir: (0, path_1.join)(TEST_DATA_PATH, 'd'),
            extensionsPath: EXTENSIONS_PATH,
            logger,
            logsPath,
            crashesPath: SPEC_CRASHES_PATH,
            verbose: !!process.env.VERBOSE,
            remote: !!process.env.REMOTE,
            web: !!browser,
            headless: project.headless,
            browser,
            tracing: true,
            snapshots,
            quality: 0 /* Quality.Dev */,
            version,
            // --- Start Positron ---
            ...(process.env.DEMO_RECORD_VIDEO ? {
                recordVideo: {
                    dir: (0, path_1.resolve)(constants_1.ROOT_PATH, 'demo-videos'),
                    size: { width: 1920, height: 1080 },
                },
            } : {}),
            // --- End Positron ---
            useExternalServer: project.useExternalServer,
            externalServerUrl: project.externalServerUrl
        };
        options.userDataDir = (0, infra_1.getRandomUserDataDir)(options);
        return options;
    };
}
function UserDataDirFixture() {
    return async (options) => {
        if (!options.userDataDir) {
            throw new Error('Cannot create user data dir from undefined userDataDir');
        }
        const userDir = options.web ? (0, path_1.join)(options.userDataDir, 'data', 'User') : (0, path_1.join)(options.userDataDir, 'User');
        process.env.PLAYWRIGHT_USER_DATA_DIR = userDir;
        // Copy keybindings and settings fixtures to the user data directory
        await (0, infra_1.copyFixtureFile)('keybindings.json', userDir, true);
        await (0, shared_utils_js_1.copyUserSettings)(userDir);
        // Pre-populate storage to dismiss prompts that would interfere with tests
        const storageFile = new infra_1.StorageFile(userDir);
        await storageFile.set('positron.notebook.promptDismissed', true, false /* enable to debug */);
        return userDir;
    };
}
//# sourceMappingURL=options.fixtures.js.map