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
exports.resolveElectronConfiguration = resolveElectronConfiguration;
exports.getDevElectronPath = getDevElectronPath;
exports.getBuildElectronPath = getBuildElectronPath;
exports.getBuildVersion = getBuildVersion;
exports.copyExtension = copyExtension;
const path_1 = require("path");
const fs = __importStar(require("fs"));
const vscode_uri_1 = require("vscode-uri");
const logger_1 = require("./logger");
const path = require("path");
const util_1 = require("util");
const ncp_1 = require("ncp");
const root = (0, path_1.join)(__dirname, '..', '..', '..');
async function resolveElectronConfiguration(options) {
    const { codePath, workspacePath, extensionsPath, userDataDir, remote, logger, logsPath, crashesPath, extraArgs } = options;
    const env = { ...process.env };
    const args = [
        '--skip-release-notes',
        '--skip-welcome',
        '--disable-telemetry',
        '--disable-experiments',
        '--no-cached-data',
        '--disable-updates',
        `--crash-reporter-directory=${crashesPath}`,
        '--disable-workspace-trust',
        `--logsPath=${logsPath}`,
        `--log=trace`,
    ];
    // Only add workspace path if provided
    if (workspacePath) {
        args.unshift(workspacePath);
    }
    if (options.useInMemorySecretStorage) {
        args.push('--use-inmemory-secretstorage');
    }
    if (userDataDir) {
        args.push(`--user-data-dir=${userDataDir}`);
    }
    if (extensionsPath) {
        args.push(`--extensions-dir=${extensionsPath}`);
    }
    if (options.verbose) {
        args.push('--verbose');
    }
    if (options.extensionDevelopmentPath) {
        args.push(`--extensionDevelopmentPath=${options.extensionDevelopmentPath}`);
    }
    if (remote) {
        if (!workspacePath) {
            throw new Error('Workspace path is required when running remote');
        }
        // Replace workspace path with URI
        args[0] = `--${workspacePath.endsWith('.code-workspace') ? 'file' : 'folder'}-uri=vscode-remote://test+test/${vscode_uri_1.URI.file(workspacePath).path}`;
        if (codePath) {
            if (!extensionsPath) {
                throw new Error('Extensions path is required when running against a build at the moment.');
            }
            // running against a build: copy the test resolver extension
            await (0, logger_1.measureAndLog)(() => copyExtension(root, extensionsPath, 'vscode-test-resolver'), 'copyExtension(vscode-test-resolver)', logger);
        }
        args.push('--enable-proposed-api=vscode.vscode-test-resolver');
        if (userDataDir) {
            const remoteDataDir = `${userDataDir}-server`;
            fs.mkdirSync(remoteDataDir, { recursive: true });
            env['TESTRESOLVER_DATA_FOLDER'] = remoteDataDir;
        }
        env['TESTRESOLVER_LOGS_FOLDER'] = (0, path_1.join)(logsPath, 'server');
        if (options.verbose) {
            env['TESTRESOLVER_LOG_LEVEL'] = 'trace';
        }
    }
    if (!codePath) {
        args.unshift(root);
    }
    if (extraArgs) {
        args.push(...extraArgs);
    }
    const electronPath = codePath ? getBuildElectronPath(codePath) : getDevElectronPath();
    return {
        env,
        args,
        electronPath
    };
}
function findFilePath(root, path) {
    // First check if the path exists directly in the root
    const directPath = (0, path_1.join)(root, path);
    if (fs.existsSync(directPath)) {
        return directPath;
    }
    // If not found directly, search through subdirectories
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const found = (0, path_1.join)(root, entry.name, path);
            if (fs.existsSync(found)) {
                return found;
            }
        }
    }
    throw new Error(`Could not find ${path} in any subdirectory`);
}
function parseVersion(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    if (!match) {
        throw new Error(`Invalid version string: ${version}`);
    }
    const [, major, minor, patch] = match;
    return { major: parseInt(major), minor: parseInt(minor), patch: parseInt(patch) };
}
function getDevElectronPath() {
    const buildPath = (0, path_1.join)(root, '.build');
    const product = require((0, path_1.join)(root, 'product.json'));
    switch (process.platform) {
        case 'darwin':
            return (0, path_1.join)(buildPath, 'electron', `${product.nameLong}.app`, 'Contents', 'MacOS', `${product.nameShort}`);
        case 'linux':
            return (0, path_1.join)(buildPath, 'electron', `${product.applicationName}`);
        case 'win32':
            return (0, path_1.join)(buildPath, 'electron', `${product.nameShort}.exe`);
        default:
            throw new Error('Unsupported platform.');
    }
}
function getBuildElectronPath(root) {
    switch (process.platform) {
        case 'darwin': {
            const packageJson = require((0, path_1.join)(root, 'Contents', 'Resources', 'app', 'package.json'));
            const product = require((0, path_1.join)(root, 'Contents', 'Resources', 'app', 'product.json'));
            const { major, minor } = parseVersion(packageJson.version);
            // For macOS builds using the legacy Electron binary name, versions up to and including
            // 1.109.x ship the executable as "Electron". From later versions onward, the executable
            // is renamed to match product.nameShort. This check preserves compatibility with older
            // builds; update the cutoff here only if the binary naming scheme changes again.
            if (major === 1 && minor <= 109) {
                return (0, path_1.join)(root, 'Contents', 'MacOS', 'Electron');
            }
            else {
                return (0, path_1.join)(root, 'Contents', 'MacOS', product.nameShort);
            }
        }
        case 'linux': {
            const product = require((0, path_1.join)(root, 'resources', 'app', 'product.json'));
            return (0, path_1.join)(root, product.applicationName);
        }
        case 'win32': {
            const productPath = findFilePath(root, (0, path_1.join)('resources', 'app', 'product.json'));
            const product = require(productPath);
            return (0, path_1.join)(root, `${product.nameShort}.exe`);
        }
        default:
            throw new Error('Unsupported platform.');
    }
}
function getBuildVersion(root) {
    switch (process.platform) {
        case 'darwin':
            return require((0, path_1.join)(root, 'Contents', 'Resources', 'app', 'package.json')).version;
        case 'win32': {
            const packagePath = findFilePath(root, (0, path_1.join)('resources', 'app', 'package.json'));
            return require(packagePath).version;
        }
        default:
            return require((0, path_1.join)(root, 'resources', 'app', 'package.json')).version;
    }
}
async function copyExtension(repoPath, extensionsPath, extId) {
    const dest = path.join(extensionsPath, extId);
    if (!fs.existsSync(dest)) {
        const orig = path.join(repoPath, 'extensions', extId);
        return (0, util_1.promisify)(ncp_1.ncp)(orig, dest);
    }
}
//# sourceMappingURL=electron.js.map