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
exports.ExternalPositronServerApp = ExternalPositronServerApp;
const path_1 = require("path");
const promises_1 = require("fs/promises");
const os = __importStar(require("os"));
const infra_1 = require("../../infra");
const shared_utils_1 = require("./shared-utils");
/**
 * External Positron Server (port 8080)
 * Projects: e2e-server
 */
async function ExternalPositronServerApp(fixtureOptions) {
    const { options } = fixtureOptions;
    const app = (0, infra_1.createApp)(options);
    const start = async () => {
        const serverUserDataDir = (0, path_1.join)(os.homedir(), '.positron-e2e-test');
        const userDir = (0, path_1.join)(serverUserDataDir, 'User');
        await (0, promises_1.mkdir)(userDir, { recursive: true });
        // Copy custom keybindings and settings to the server user data dir
        await (0, infra_1.copyFixtureFile)('keybindings.json', userDir, true);
        await (0, shared_utils_1.copyUserSettings)(userDir);
        // Start the app and connect to the external server
        await app.connectToExternalServer();
        await app.workbench.sessions.expectNoStartUpMessaging();
        await app.workbench.hotKeys.closeAllEditors();
        await app.workbench.sessions.deleteAll();
    };
    const stop = async () => {
        await app.stopExternalServer();
    };
    return { app, start, stop };
}
//# sourceMappingURL=app-external.fixtures.js.map