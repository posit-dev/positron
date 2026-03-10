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
const path_1 = require("path");
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const test_runner_1 = require("../infra/test-runner");
const ROOT_PATH = process.cwd();
const LOGS_ROOT_PATH = (0, path_1.join)(ROOT_PATH, 'test-logs');
const TEST_DATA_PATH = (0, path_1.join)(os.tmpdir(), 'vscsmoke');
const WORKSPACE_PATH = (0, path_1.join)(TEST_DATA_PATH, 'qa-example-content');
async function globalSetup() {
    fs.rmSync(LOGS_ROOT_PATH, { recursive: true, force: true });
    (0, test_runner_1.prepareTestEnv)(ROOT_PATH, LOGS_ROOT_PATH);
    if (process.env.SKIP_CLONE !== 'true') {
        (0, test_runner_1.cloneTestRepo)(WORKSPACE_PATH);
    }
}
exports.default = globalSetup;
//# sourceMappingURL=_global.setup.js.map