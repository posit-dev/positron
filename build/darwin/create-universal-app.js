"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var path = require("path");
var fs = require("fs");
var minimatch = require("minimatch");
var vscode_universal_bundler_1 = require("vscode-universal-bundler");
var cross_spawn_promise_1 = require("@malept/cross-spawn-promise");
var root = path.dirname(path.dirname(__dirname));
// --- Start Positron ---
var os = require("os");
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
var stashPatterns = [
    // Exclusions from ZeroMQ node module
    '**/electron.napi.node',
    '**/node.napi.node',
    '**/node.napi.glibc.node',
    // Exclusions from remote-ssh
    '**/cpufeatures.node',
    '**/sshcrypto.node',
    // Case-sensitivity issues
    '**/HTML.icns',
    '**/html.icns',
    // Exclusions from Python language pack (positron-python)
    '**/pydevd/**',
    // Exclusions from R language pack (positron-r)
    '**/ark',
    // Exclusions from Quarto
    '**/quarto/bin/tools/**',
];
// Some generated files may end up being different in both distributions.
// `reconciliationFiles` contains relative paths of files that should be copied
// from the x64 bundle to the arm64 one so they don't cause a mismatch error.
var reconciliationFiles = [
    'Contents/Resources/app/product.json',
    // Definitions of localized strings
    'Contents/Resources/app/out/nls.messages.json',
    'Contents/Resources/app/out/nls.keys.json',
    // Consumers of localised strings, found by grepping for `nls_1.localize`
    'Contents/Resources/app/out/vs/platform/profiling/electron-sandbox/profileAnalysisWorker.js',
    'Contents/Resources/app/out/vs/platform/files/node/watcher/watcherMain.js',
    'Contents/Resources/app/out/vs/platform/terminal/node/ptyHostMain.js',
    'Contents/Resources/app/out/vs/code/node/cli.js',
    'Contents/Resources/app/out/vs/code/node/cliProcessMain.js',
    'Contents/Resources/app/out/vs/code/electron-sandbox/processExplorer/processExplorerMain.js',
    'Contents/Resources/app/out/vs/code/node/sharedProcess/sharedProcessMain.js',
    'Contents/Resources/app/out/vs/code/electron-main/main.js',
    'Contents/Resources/app/out/vs/workbench/contrib/notebook/common/services/notebookSimpleWorker.js',
    'Contents/Resources/app/out/vs/workbench/contrib/issue/electron-sandbox/issueReporterMain.js',
    'Contents/Resources/app/out/vs/base/worker/workerMain.js',
    'Contents/Resources/app/out/vs/workbench/api/worker/extensionHostWorker.js',
    'Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js',
    'Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js',
];
function readFiles(dir) {
    var files = [];
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
        var entry = entries_1[_i];
        var fullPath = path.join(dir, entry.name);
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
    var dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
function stashFiles(stash, x64Path, arm64Path) {
    var x64Stash = path.join(stash, 'x64');
    var arm64Stash = path.join(stash, 'arm64');
    fs.mkdirSync(x64Stash);
    fs.mkdirSync(arm64Stash);
    var matches = readFiles(x64Path).
        filter(function (file) { return stashPatterns.some(function (pat) { return minimatch(file, pat); }); });
    for (var _i = 0, matches_1 = matches; _i < matches_1.length; _i++) {
        var x64Source = matches_1[_i];
        var rel = path.relative(x64Path, x64Source);
        var arm64Source = path.join(arm64Path, rel);
        if (!fs.existsSync(arm64Source)) {
            throw new Error("Cannot find '".concat(rel, "' in arm64 source"));
        }
        var x64Dest = path.join(x64Stash, rel);
        var arm64Dest = path.join(arm64Stash, rel);
        ensureDir(x64Dest);
        ensureDir(arm64Dest);
        fs.renameSync(x64Source, x64Dest);
        fs.renameSync(arm64Source, arm64Dest);
    }
}
// Copy files to reconcile from the x64 build to the arm64 one
function reconcileFiles(x64Path, arm64Path) {
    for (var _i = 0, reconciliationFiles_1 = reconciliationFiles; _i < reconciliationFiles_1.length; _i++) {
        var file = reconciliationFiles_1[_i];
        var src = path.join(x64Path, file);
        var dest = path.join(arm64Path, file);
        fs.copyFileSync(src, dest);
    }
}
function restoreFromStash(stash, destRoot) {
    for (var _i = 0, _a = readFiles(stash); _i < _a.length; _i++) {
        var src = _a[_i];
        var rel = path.relative(stash, src);
        var dest = path.join(destRoot, rel);
        ensureDir(dest);
        fs.renameSync(src, dest);
    }
}
// --- End Positron ---
function main(buildDir) {
    return __awaiter(this, void 0, void 0, function () {
        var arch, product, appName, x64AppPath, arm64AppPath, asarRelativePath, outAppPath, productJsonPath, filesToSkip, stash;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    arch = process.env['VSCODE_ARCH'];
                    if (!buildDir) {
                        throw new Error('Build dir not provided');
                    }
                    product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
                    appName = product.nameLong + '.app';
                    x64AppPath = path.join(buildDir, 'VSCode-darwin-x64', appName);
                    arm64AppPath = path.join(buildDir, 'VSCode-darwin-arm64', appName);
                    asarRelativePath = path.join('Contents', 'Resources', 'app', 'node_modules.asar');
                    outAppPath = path.join(buildDir, "VSCode-darwin-".concat(arch), appName);
                    productJsonPath = path.resolve(outAppPath, 'Contents', 'Resources', 'app', 'product.json');
                    filesToSkip = [
                        '**/CodeResources',
                        '**/Credits.rtf',
                    ];
                    stash = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-create-universal'));
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, , 3, 4]);
                    reconcileFiles(x64AppPath, arm64AppPath);
                    stashFiles(stash, x64AppPath, arm64AppPath);
                    return [4 /*yield*/, origMain(x64AppPath, arm64AppPath, asarRelativePath, outAppPath, filesToSkip, productJsonPath)];
                case 2:
                    _a.sent();
                    restoreFromStash(path.join(stash, 'x64'), outAppPath);
                    return [3 /*break*/, 4];
                case 3:
                    fs.rmSync(stash, { recursive: true, force: true });
                    return [7 /*endfinally*/];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function origMain(x64AppPath, arm64AppPath, asarRelativePath, outAppPath, filesToSkip, productJsonPath) {
    return __awaiter(this, void 0, void 0, function () {
        var productJson, findOutput, lipoOutput;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: 
                // --- End Positron ---
                return [4 /*yield*/, (0, vscode_universal_bundler_1.makeUniversalApp)({
                        x64AppPath: x64AppPath,
                        arm64AppPath: arm64AppPath,
                        asarPath: asarRelativePath,
                        outAppPath: outAppPath,
                        force: true,
                        mergeASARs: true,
                        x64ArchFiles: '*/kerberos.node',
                        filesToSkipComparison: function (file) {
                            for (var _i = 0, filesToSkip_1 = filesToSkip; _i < filesToSkip_1.length; _i++) {
                                var expected = filesToSkip_1[_i];
                                if (minimatch(file, expected)) {
                                    return true;
                                }
                            }
                            return false;
                        }
                    })];
                case 1:
                    // --- End Positron ---
                    _a.sent();
                    productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
                    Object.assign(productJson, {
                        darwinUniversalAssetId: 'darwin-universal'
                    });
                    fs.writeFileSync(productJsonPath, JSON.stringify(productJson, null, '\t'));
                    return [4 /*yield*/, (0, cross_spawn_promise_1.spawn)('find', [outAppPath, '-name', 'kerberos.node'])];
                case 2:
                    findOutput = _a.sent();
                    return [4 /*yield*/, (0, cross_spawn_promise_1.spawn)('lipo', ['-archs', findOutput.replace(/\n$/, '')])];
                case 3:
                    lipoOutput = _a.sent();
                    if (lipoOutput.replace(/\n$/, '') !== 'x86_64 arm64') {
                        throw new Error("Invalid arch, got : ".concat(lipoOutput));
                    }
                    return [2 /*return*/];
            }
        });
    });
}
if (require.main === module) {
    main(process.argv[2]).catch(function (err) {
        console.error(err);
        process.exit(1);
    });
}
