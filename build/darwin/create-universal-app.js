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
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const minimatch_1 = __importDefault(require("minimatch"));
const vscode_universal_bundler_1 = require("vscode-universal-bundler");
const root = path_1.default.dirname(path_1.default.dirname(__dirname));
// --- Start Positron ---
const os = __importStar(require("os"));
// The merging procedure will fail if:
//
// (a) It finds x64 files that don't have an arm64 equivalent. For instance the
//     pydevd folder contains precompiled single arch libraries.
//
// (b) It finds binaries that are already univeral, for instance ark.
//     (Note that in more recent versions of vscode-universal-bundler (>= 0.1.2), it
//     won't be necessary to worry about universal binaries as those will be
//     ignored by the bundler.)
//
// `makeUniversalApp()` has arguments to handle some of these cases but these
// are not flexible enough for our purposes. For instance, x64-only files need
// to be specified in `x64ArchFiles` which only accepts a single glob pattern.
// `filesToSkipComparison` is not consulted in this case. So we stash away all
// problematic files and restore them once the merging procedure has completed.
//
// The files to stash away are determined with minimatch patterns. Folders are
// excluded from matches, so to match a whole folder use `myfolder/**`.
//
const stashPatterns = [
    // Exclusions from ZeroMQ node module
    '**/electron.napi.node', // ZeroMQ Electron architecture-specific pre-built binary
    '**/node.napi.node', // ZeroMQ Electron architecture-specific pre-built binary
    '**/node.napi.glibc.node', // ZeroMQ Electron architecture-specific pre-built binary
    // Exclusions from remote-ssh
    '**/cpufeatures.node',
    '**/sshcrypto.node',
    // Case-sensitivity issues
    '**/HTML.icns',
    '**/html.icns',
    // Exclusions from Python language pack (positron-python)
    '**/pydevd/**', // Cython pre-built binaries for Python debugging
    '**/lib/ipykernel/**', // Bundled IPyKernel dependencies
    '**/lib/ipykernel/**/.dylibs/**', // Bundled IPyKernel dependency dylibs
    // Exclusions from R language pack (positron-r)
    '**/ark', // Compiled R kernel and LSP
    // Exclusions from Kallichore Jupyter supervisor
    '**/kcserver', // Compiled Jupyter supervisor
    // Exclusions for Python Environment Tools
    '**/python-env-tools/pet',
    // Exclusions from Quarto
    '**/quarto/bin/tools/**',
    // Exclusions from Node Addon API
    '**/@vscode/node-addon-api/**',
    '**/@parcel/node-addon-api/**',
    '**/@parcel/**/watcher.node',
    // Exclusions from positron-assistant
    '**/resources/copilot/**', // Copilot language server binary
];
// Some generated files may end up being different in both distributions.
// `reconciliationFiles` contains relative paths of files that should be copied
// from the x64 bundle to the arm64 one so they don't cause a mismatch error.
const reconciliationFiles = [
    'Contents/Resources/app/product.json',
    // Definitions of localized strings
    'Contents/Resources/app/out/nls.messages.json',
    'Contents/Resources/app/out/nls.keys.json',
    // Consumers of localised strings, found by grepping for `nls_1.localize`
    'Contents/Resources/app/out/vs/platform/profiling/electron-browser/profileAnalysisWorkerMain.js',
    'Contents/Resources/app/out/vs/platform/files/node/watcher/watcherMain.js',
    'Contents/Resources/app/out/vs/platform/terminal/node/ptyHostMain.js',
    'Contents/Resources/app/out/cli.js',
    'Contents/Resources/app/out/vs/code/node/cliProcessMain.js',
    'Contents/Resources/app/out/vs/code/electron-utility/sharedProcess/sharedProcessMain.js',
    'Contents/Resources/app/out/vs/workbench/api/worker/extensionHostWorkerMain.js',
    'Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js',
    'Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js',
];
function readFiles(dir) {
    let files = [];
    const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path_1.default.join(dir, entry.name);
        // Recurse into directories and only return files
        if (entry.isDirectory()) {
            files = files.concat(readFiles(fullPath));
        }
        else if (entry.isFile()) {
            files.push(fullPath);
        }
    }
    return files;
}
function ensureDir(file) {
    const dir = path_1.default.dirname(file);
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
function stashFiles(stash, x64Path, arm64Path) {
    const x64Stash = path_1.default.join(stash, 'x64');
    const arm64Stash = path_1.default.join(stash, 'arm64');
    fs_1.default.mkdirSync(x64Stash);
    fs_1.default.mkdirSync(arm64Stash);
    const matches = readFiles(x64Path).
        filter((file) => stashPatterns.some(pat => (0, minimatch_1.default)(file, pat)));
    for (const x64Source of matches) {
        const rel = path_1.default.relative(x64Path, x64Source);
        const arm64Source = path_1.default.join(arm64Path, rel);
        if (!fs_1.default.existsSync(arm64Source)) {
            throw new Error(`Cannot find '${rel}' in arm64 source`);
        }
        const x64Dest = path_1.default.join(x64Stash, rel);
        const arm64Dest = path_1.default.join(arm64Stash, rel);
        ensureDir(x64Dest);
        ensureDir(arm64Dest);
        fs_1.default.renameSync(x64Source, x64Dest);
        fs_1.default.renameSync(arm64Source, arm64Dest);
    }
}
// Copy files to reconcile from the x64 build to the arm64 one
function reconcileFiles(x64Path, arm64Path) {
    for (const file of reconciliationFiles) {
        const src = path_1.default.join(x64Path, file);
        const dest = path_1.default.join(arm64Path, file);
        fs_1.default.copyFileSync(src, dest);
    }
}
function restoreFromStash(stash, destRoot) {
    for (const src of readFiles(stash)) {
        const rel = path_1.default.relative(stash, src);
        const dest = path_1.default.join(destRoot, rel);
        ensureDir(dest);
        fs_1.default.renameSync(src, dest);
    }
}
// --- End Positron ---
async function main(buildDir) {
    const arch = process.env['VSCODE_ARCH'];
    if (!buildDir) {
        throw new Error('Build dir not provided');
    }
    const product = JSON.parse(fs_1.default.readFileSync(path_1.default.join(root, 'product.json'), 'utf8'));
    const appName = product.nameLong + '.app';
    const x64AppPath = path_1.default.join(buildDir, 'VSCode-darwin-x64', appName);
    const arm64AppPath = path_1.default.join(buildDir, 'VSCode-darwin-arm64', appName);
    const asarRelativePath = path_1.default.join('Contents', 'Resources', 'app', 'node_modules.asar');
    const outAppPath = path_1.default.join(buildDir, `VSCode-darwin-${arch}`, appName);
    const productJsonPath = path_1.default.resolve(outAppPath, 'Contents', 'Resources', 'app', 'product.json');
    const filesToSkip = [
        '**/CodeResources',
        '**/Credits.rtf',
        '**/policies/{*.mobileconfig,**/*.plist}',
        // TODO: Should we consider expanding this to other files in this area?
        '**/node_modules/@parcel/node-addon-api/nothing.target.mk',
    ];
    // --- Start Positron ---
    // We split the original main function in two parts so that we can call the
    // second part in a try block without causing the formatter to increase the
    // indentation, which would increase the chance of merge conflicts
    const stash = fs_1.default.mkdtempSync(path_1.default.join(os.tmpdir(), 'positron-create-universal'));
    try {
        reconcileFiles(x64AppPath, arm64AppPath);
        stashFiles(stash, x64AppPath, arm64AppPath);
        await origMain(x64AppPath, arm64AppPath, asarRelativePath, outAppPath, filesToSkip, productJsonPath);
        restoreFromStash(path_1.default.join(stash, 'x64'), outAppPath);
    }
    finally {
        fs_1.default.rmSync(stash, { recursive: true, force: true });
    }
}
async function origMain(x64AppPath, arm64AppPath, asarRelativePath, outAppPath, filesToSkip, productJsonPath) {
    // --- End Positron ---
    await (0, vscode_universal_bundler_1.makeUniversalApp)({
        x64AppPath,
        arm64AppPath,
        asarPath: asarRelativePath,
        outAppPath,
        force: true,
        mergeASARs: true,
        x64ArchFiles: '{*/kerberos.node,**/extensions/microsoft-authentication/dist/libmsalruntime.dylib,**/extensions/microsoft-authentication/dist/msal-node-runtime.node}',
        filesToSkipComparison: (file) => {
            for (const expected of filesToSkip) {
                if ((0, minimatch_1.default)(file, expected)) {
                    return true;
                }
            }
            return false;
        }
    });
    const productJson = JSON.parse(fs_1.default.readFileSync(productJsonPath, 'utf8'));
    Object.assign(productJson, {
        darwinUniversalAssetId: 'darwin-universal'
    });
    fs_1.default.writeFileSync(productJsonPath, JSON.stringify(productJson, null, '\t'));
}
if (require.main === module) {
    main(process.argv[2]).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=create-universal-app.js.map