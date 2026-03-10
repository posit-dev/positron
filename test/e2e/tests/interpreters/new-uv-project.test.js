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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const _test_setup_1 = require("../_test.setup");
const test_1 = require("@playwright/test");
const fs = __importStar(require("fs/promises"));
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('New uv Environment', {
    tag: [_test_setup_1.tags.INTERPRETER]
}, () => {
    _test_setup_1.test.beforeAll(async function ({ settings }) {
        await settings.set({ 'interpreters.startupBehavior': 'auto' }, { reload: 'web' });
    });
    _test_setup_1.test.afterAll(async () => {
        const projPath = '/tmp/vscsmoke/qa-example-content/proj';
        try {
            await fs.rm(projPath, { recursive: true, force: true });
            console.log(`Cleaned up test project: ${projPath}`);
        }
        catch (err) {
            console.warn(`Failed to delete ${projPath}:`, err);
        }
    });
    // This is skipped for windows because we can't get the text from the Terminal
    (0, _test_setup_1.test)('Python - Add new uv environment', async function ({ app, openFolder }) {
        _test_setup_1.test.skip(process.env.IS_OPENSUSE === 'true', 'Skip on openSuse');
        await app.workbench.terminal.clickTerminalTab();
        await app.workbench.terminal.runCommandInTerminal('uv init proj');
        await app.workbench.terminal.waitForTerminalText('Initialized project');
        await app.workbench.terminal.runCommandInTerminal('cd proj');
        await app.workbench.terminal.runCommandInTerminal('uv sync');
        await app.workbench.terminal.waitForTerminalText('Creating virtual environment');
        await openFolder(path_1.default.join('qa-example-content/proj'));
        await app.workbench.console.waitForReady('>>>', 30000);
        await app.workbench.sessions.expectAllSessionsToBeReady();
        const metadata = await app.workbench.sessions.getMetadata();
        (0, test_1.expect)(metadata.source).toBe('uv');
        (0, test_1.expect)(metadata.path).toContain('qa-example-content/proj/.venv/bin/python');
    });
});
//# sourceMappingURL=new-uv-project.test.js.map