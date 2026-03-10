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
exports.TestTeardown = void 0;
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
class TestTeardown {
    _workspacePathOrFolder;
    constructor(_workspacePathOrFolder) {
        this._workspacePathOrFolder = _workspacePathOrFolder;
    }
    async removeTestFiles(files) {
        for (const file of files) {
            try {
                const filePath = this._workspacePathOrFolder + '/' + file;
                if (fs.existsSync(filePath)) {
                    fs.rmSync(filePath, { recursive: true, force: true });
                }
            }
            catch (error) {
                // Don't let cleanup errors fail the test run
                console.warn(`Failed to remove test file "${file}":`, error);
            }
        }
    }
    async removeTestFolder(folder) {
        const folderPath = this._workspacePathOrFolder + '/' + folder;
        if (fs.existsSync(folderPath)) {
            fs.rmSync(folderPath, { recursive: true, force: true });
        }
    }
    async discardAllChanges() {
        try {
            // Get the root commit hash
            const rootCommitHash = (0, child_process_1.execSync)('git rev-list --max-parents=0 HEAD', { cwd: this._workspacePathOrFolder }).toString().trim();
            // Reset to the root commit
            (0, child_process_1.execSync)(`git reset --hard ${rootCommitHash}`, { cwd: this._workspacePathOrFolder });
            (0, child_process_1.execSync)('git clean -fd', { cwd: this._workspacePathOrFolder });
        }
        catch (error) {
            console.error('Failed to discard changes:', error);
        }
    }
}
exports.TestTeardown = TestTeardown;
//# sourceMappingURL=test-teardown.js.map