/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadExplorerAppx = downloadExplorerAppx;
const fs_1 = __importDefault(require("fs"));
const debug_1 = __importDefault(require("debug"));
const extract_zip_1 = __importDefault(require("extract-zip"));
const path_1 = __importDefault(require("path"));
const get_1 = require("@electron/get");
const root = path_1.default.dirname(path_1.default.dirname(__dirname));
const d = (0, debug_1.default)('explorer-appx-fetcher');
async function downloadExplorerAppx(outDir, quality = 'stable', targetArch = 'x64') {
    const fileNamePrefix = quality === 'insider' ? 'code_insiders' : 'code';
    const fileName = `${fileNamePrefix}_explorer_${targetArch}.zip`;
    if (await fs_1.default.existsSync(path_1.default.resolve(outDir, 'resources.pri'))) {
        return;
    }
    if (!await fs_1.default.existsSync(outDir)) {
        await fs_1.default.mkdirSync(outDir, { recursive: true });
    }
    d(`downloading ${fileName}`);
    const artifact = await (0, get_1.downloadArtifact)({
        isGeneric: true,
        version: '3.0.4',
        artifactName: fileName,
        unsafelyDisableChecksums: true,
        mirrorOptions: {
            mirror: 'https://github.com/microsoft/vscode-explorer-command/releases/download/',
            customDir: '3.0.4',
            customFilename: fileName
        }
    });
    d(`unpacking from ${fileName}`);
    await (0, extract_zip_1.default)(artifact, { dir: fs_1.default.realpathSync(outDir) });
}
async function main(outputDir) {
    const arch = process.env['VSCODE_ARCH'];
    if (!outputDir) {
        throw new Error('Required build env not set');
    }
    const product = JSON.parse(fs_1.default.readFileSync(path_1.default.join(root, 'product.json'), 'utf8'));
    await downloadExplorerAppx(outputDir, product.quality, arch);
}
if (require.main === module) {
    main(process.argv[2]).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=explorer-appx-fetcher.js.map