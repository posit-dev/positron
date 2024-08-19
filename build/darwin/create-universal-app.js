"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fs = require("fs");
const minimatch = require("minimatch");
const vscode_universal_bundler_1 = require("vscode-universal-bundler");
const cross_spawn_promise_1 = require("@malept/cross-spawn-promise");
const root = path.dirname(path.dirname(__dirname));
async function main(buildDir) {
    const arch = process.env['VSCODE_ARCH'];
    if (!buildDir) {
        throw new Error('Build dir not provided');
    }
    const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
    const appName = product.nameLong + '.app';
    const x64AppPath = path.join(buildDir, 'VSCode-darwin-x64', appName);
    const arm64AppPath = path.join(buildDir, 'VSCode-darwin-arm64', appName);
    const asarRelativePath = path.join('Contents', 'Resources', 'app', 'node_modules.asar');
    const outAppPath = path.join(buildDir, `VSCode-darwin-${arch}`, appName);
    const productJsonPath = path.resolve(outAppPath, 'Contents', 'Resources', 'app', 'product.json');
    const filesToSkip = [
        '**/CodeResources',
        '**/Credits.rtf',
        // --- Start Positron ---
        // Exclusions from ZeroMQ node module
        'electron.napi.node', // ZeroMQ Electron architecture-specific pre-built binary
        'node.napi.node', // ZeroMQ Electron architecture-specific pre-built binary
        'node.napi.glibc.node', // ZeroMQ Electron architecture-specific pre-built binary
        // Exclusions from remote-ssh
        'cpufeatures.node',
        'sshcrypto.node',
        // Case-sensitivity issues
        'HTML.icns',
        'html.icns',
        // Exclusions from Python language pack (positron-python)
        'pydevd', // Cython pre-built binaries for Python debugging
        // Exclusions from R language pack (positron-r)
        'ark', // Compiled R kernel and LSP
        // Exclusions from Quarto
        'dart',
        'deno',
        'esbuild',
        'pandoc',
        'sass',
        'typst',
        // --- End Positron ---
    ];
    await (0, vscode_universal_bundler_1.makeUniversalApp)({
        x64AppPath,
        arm64AppPath,
        asarPath: asarRelativePath,
        outAppPath,
        force: true,
        mergeASARs: true,
        x64ArchFiles: '*/kerberos.node',
        filesToSkipComparison: (file) => {
            for (const expected of filesToSkip) {
                if (minimatch(file, expected)) {
                    return true;
                }
            }
            return false;
        }
    });
    const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
    Object.assign(productJson, {
        darwinUniversalAssetId: 'darwin-universal'
    });
    fs.writeFileSync(productJsonPath, JSON.stringify(productJson, null, '\t'));
    // Verify if native module architecture is correct
    const findOutput = await (0, cross_spawn_promise_1.spawn)('find', [outAppPath, '-name', 'kerberos.node']);
    const lipoOutput = await (0, cross_spawn_promise_1.spawn)('lipo', ['-archs', findOutput.replace(/\n$/, '')]);
    if (lipoOutput.replace(/\n$/, '') !== 'x86_64 arm64') {
        throw new Error(`Invalid arch, got : ${lipoOutput}`);
    }
}
if (require.main === module) {
    main(process.argv[2]).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=create-universal-app.js.map