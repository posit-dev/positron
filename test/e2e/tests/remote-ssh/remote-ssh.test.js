"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const workbench_1 = require("../../infra/workbench");
const plots_constants_js_1 = require("../shared/plots.constants.js");
const settingsPath = require('node:path').resolve(__dirname, '../../fixtures/settingsDocker.json');
_test_setup_1.test.use({
    suiteId: __filename
});
function sshKeyscan(host, port, knownHostsPath) {
    // Run ssh-keyscan and capture stdout (the host keys)
    const out = (0, node_child_process_1.execFileSync)('ssh-keyscan', ['-p', String(port), host], {
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    // Ensure the file exists, then append
    node_fs_1.default.mkdirSync(require('node:path').dirname(knownHostsPath), { recursive: true });
    node_fs_1.default.appendFileSync(knownHostsPath, out);
}
async function waitForAnyNewWindow(app, trigger, opts = {}) {
    const { timeout = 30_000, loadState = 'domcontentloaded' } = opts;
    // Snapshot existing windows so we can detect a new one even if the event is missed.
    const before = new Set(app.windows());
    // Start waiting for a new 'window' event *before* we trigger anything.
    const eventWait = app.waitForEvent('window', { timeout }).catch(() => null);
    // Optionally run whatever opens the window (recommended).
    if (trigger) {
        await trigger();
    }
    // If we caught the event, great.
    let win = await eventWait;
    // Fallback: CI flake where window opened before listener—scan for any new page.
    if (!win) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const current = app.windows();
            for (const p of current) {
                if (!before.has(p)) {
                    win = p;
                    break;
                }
            }
            if (win) {
                break;
            }
            await new Promise(r => setTimeout(r, 100));
        }
    }
    if (!win) {
        throw new Error('No new window appeared within timeout');
    }
    // Ensure it’s at least minimally ready and on top
    await win.waitForLoadState(loadState).catch(() => { });
    await win.bringToFront().catch(() => { });
    return win;
}
_test_setup_1.test.describe('Remote SSH', {
    tag: [_test_setup_1.tags.REMOTE_SSH]
}, () => {
    _test_setup_1.test.beforeAll(async ({ settings }) => {
        try {
            sshKeyscan('127.0.0.1', 3456, '/tmp/known_hosts');
        }
        catch (err) {
            throw new Error(`ssh-keyscan failed: ${err.message}`);
        }
        await settings.set(JSON.parse(node_fs_1.default.readFileSync(settingsPath, 'utf8')));
    });
    (0, _test_setup_1.test)('Verify SSH connection into docker image', async function ({ app, python, runDockerCommand }) {
        const sshWin = await _test_setup_1.test.step(`Connect to docker image`, async () => {
            // Start waiting for *any* new window before we trigger the UI that opens it
            const sshWinPromise = waitForAnyNewWindow(app.code.electronApp, async () => {
                await app.workbench.quickInput.waitForQuickInputOpened();
                await app.workbench.quickInput.selectQuickInputElementContaining('Connect to Host...');
                await app.workbench.quickInput.selectQuickInputElementContaining('remote');
            }, { timeout: 60_000 });
            // Kick off the action that reveals the quick input (if needed)
            await app.code.driver.currentPage.locator('.codicon-remote').click();
            // Grab the new window (no URL/title/selector filtering)
            const sshWin = await sshWinPromise;
            // Continue as before
            await (0, test_1.expect)(sshWin.getByText('Enter password')).toBeVisible({ timeout: 60_000 });
            await sshWin.keyboard.type('root');
            await sshWin.keyboard.press('Enter');
            const alertLocator = sshWin.locator('span', { hasText: 'Setting up SSH Host remote' });
            await (0, test_1.expect)(alertLocator).toBeVisible({ timeout: 10_000 });
            await (0, test_1.expect)(alertLocator).not.toBeVisible({ timeout: 60_000 });
            return sshWin;
        });
        const sshWorkbench = await _test_setup_1.test.step(`Create a workbench instance from the remote page`, async () => {
            const sshWorkbench = (0, workbench_1.createWorkbenchFromPage)(app.code, sshWin);
            process.env.POSITRON_PY_VER_SEL = process.env.POSITRON_PY_REMOTE_VER_SEL;
            process.env.POSITRON_R_VER_SEL = process.env.POSITRON_R_REMOTE_VER_SEL;
            return sshWorkbench;
        });
        const pythonSession = await _test_setup_1.test.step(`Check that correct Python is being used`, async () => {
            const pythonSession = await sshWorkbench.sessions.start('python');
            await sshWorkbench.console.pasteCodeToConsole('import sys; print(sys.executable)', true);
            await sshWorkbench.console.waitForConsoleContents('/root/.venv/bin/python');
            return pythonSession;
        });
        await _test_setup_1.test.step(`Check that correct R is being used`, async () => {
            await sshWorkbench.sessions.start('r');
            await sshWorkbench.console.pasteCodeToConsole('Sys.getenv("R_HOME")', true);
            await sshWorkbench.console.waitForConsoleContents('/opt/R/4.4.0/lib/R');
        });
        await _test_setup_1.test.step(`Check that plots work`, async () => {
            await sshWorkbench.sessions.select(pythonSession.id);
            await sshWorkbench.console.pasteCodeToConsole(plots_constants_js_1.pythonDynamicPlot, true);
            await sshWorkbench.plots.waitForCurrentPlot();
        });
        await _test_setup_1.test.step(`Check that apps work`, async () => {
            const viewer = sshWorkbench.viewer;
            const fileName = 'Untitled-1';
            await sshWorkbench.layouts.enterLayout('stacked');
            await sshWorkbench.editors.newUntitledFile();
            await sshWorkbench.editor.selectTabAndType(fileName, flaskAppCode);
            await sshWin.keyboard.press('Enter');
            await sshWorkbench.topActionBar.saveButton.click();
            await sshWorkbench.quickInput.waitForQuickInputOpened();
            await sshWin.keyboard.press('Backspace'); // clear any pre-filled text
            await sshWorkbench.quickInput.type('test.py');
            await (0, test_1.expect)(async () => {
                await sshWorkbench.quickInput.clickOkButton();
                await sshWorkbench.quickInput.waitForQuickInputClosed();
            }).toPass({ timeout: 60000 });
            await sshWin.waitForTimeout(3000); // wait for file to be saved
            await sshWorkbench.editor.pressPlay();
            const viewerFrame = viewer.getViewerFrame();
            const loginLocator = app.web
                ? viewerFrame.frameLocator('iframe').getByText('Hello, World!')
                : viewerFrame.getByText('Hello, World!');
            await (0, test_1.expect)(loginLocator).toBeVisible({ timeout: 60000 });
        });
        await _test_setup_1.test.step(`Clennup`, async () => {
            await runDockerCommand('docker exec test rm /test.py', 'Remove test.py from container');
        });
    });
});
const flaskAppCode = `from flask import Flask

app = Flask(__name__)

@app.route('/')
def hello():
    return 'Hello, World!'

if __name__ == '__main__':
    app.run(debug=True)
`;
//# sourceMappingURL=remote-ssh.test.js.map