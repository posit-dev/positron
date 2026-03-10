"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deletePositronHistoryFiles = void 0;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const deletePositronHistoryFiles = async () => {
    const buildSet = !!process.env.BUILD;
    const homeDir = process.env.HOME || '';
    let vscodePath;
    let positronPath;
    if (buildSet) {
        vscodePath = path_1.default.join(homeDir, '.vscode');
        if (process.platform === 'darwin') { // for local debug
            positronPath = path_1.default.join(homeDir, 'Library/Application\ Support/Positron');
        }
        else { // linux, test not planned for Windows yet
            positronPath = path_1.default.join(homeDir, '.config/Positron');
        }
        console.log(`Release, vscodePath: ${vscodePath}, positronPath: ${positronPath}`);
    }
    else {
        vscodePath = path_1.default.join(homeDir, '.vscode-oss-dev');
        positronPath = path_1.default.join(homeDir, '.positron-dev');
        console.log(`Dev, vscodePath: ${vscodePath}, positronPath: ${positronPath}`);
    }
    (0, child_process_1.execSync)(`rm -rf ${vscodePath} ${positronPath}`);
};
exports.deletePositronHistoryFiles = deletePositronHistoryFiles;
//# sourceMappingURL=default-interpreters.js.map