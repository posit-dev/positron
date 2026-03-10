"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.positronVersion = exports.platformVersion = exports.platformOs = exports.LOCAL_API_URL = exports.PROD_API_URL = exports.CONNECT_API_KEY = void 0;
const os_1 = __importDefault(require("os"));
const test_setup_js_1 = require("../../infra/test-runner/test-setup.js");
exports.CONNECT_API_KEY = process.env.CONNECT_API_KEY;
exports.PROD_API_URL = 'https://connect.posit.it/e2e-test-insights-api/metrics';
exports.LOCAL_API_URL = 'http://127.0.0.1:8000/metrics';
//-----------------------
// Platform Information
//-----------------------
exports.platformOs = (() => {
    const osMap = {
        darwin: 'macOS',
        win32: 'Windows',
        linux: 'Linux'
    };
    const platform = os_1.default.platform();
    return osMap[platform] || platform;
})();
exports.platformVersion = os_1.default.release();
exports.positronVersion = (0, test_setup_js_1.getPositronVersion)();
//# sourceMappingURL=metric-base.js.map