"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEMO_SCREENCAST_SETTINGS = void 0;
exports.setupDemoLayout = setupDemoLayout;
exports.showOverlay = showOverlay;
exports.narrate = narrate;
exports.pause = pause;
exports.humanType = humanType;
exports.humanClick = humanClick;
exports.humanHover = humanHover;
exports.zoomTo = zoomTo;
exports.zoomReset = zoomReset;
const OVERLAY_ID = 'demo-overlay';
/**
 * Screencast mode settings tuned for demo recordings.
 * Spread into `settingsFile.append()` in the test's `beforeApp` fixture.
 */
exports.DEMO_SCREENCAST_SETTINGS = {
    'screencastMode.verticalOffset': 10,
    'screencastMode.mouseIndicatorSize': 30,
    'screencastMode.keyboardOverlayTimeout': 1000,
    'screencastMode.keyboardOptions': {
        showKeys: true,
        showKeybindings: true,
        showCommands: false,
        showCommandGroups: false,
        showSingleEditorCursorMoves: false,
    },
};
/**
 * Collapse sidebars and panels to maximize the editor area for recording,
 * then enable screencast mode to show mouse clicks and keystrokes.
 * Call at the start of a demo before any narration.
 */
async function setupDemoLayout(app, page) {
    const runCommand = async (id) => {
        await app.workbench.quickaccess.runCommand(id);
    };
    // Close left sidebar, bottom panel, and right auxiliary bar
    await runCommand('workbench.action.closeSidebar');
    await runCommand('workbench.action.closePanel');
    await runCommand('workbench.action.closeAuxiliaryBar');
    // Enable screencast mode to show clicks and keystrokes in the recording
    await runCommand('workbench.action.toggleScreencastMode');
    // Brief settle time for layout to reflow
    await page.waitForTimeout(500);
}
/**
 * Show a text overlay on the screen describing what is happening.
 * The overlay appears at the bottom of the viewport with a semi-transparent
 * background. Call with empty text to hide it.
 */
async function showOverlay(page, text, options) {
    const { position = 'bottom', fadeInMs = 200 } = options ?? {};
    await page.evaluate(({ id, text, position, fadeInMs }) => {
        let el = document.getElementById(id);
        if (!text) {
            if (el) {
                el.style.opacity = '0';
                setTimeout(() => el?.remove(), 300);
            }
            return;
        }
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            Object.assign(el.style, {
                position: 'fixed',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: '999999',
                padding: '14px 32px',
                borderRadius: '8px',
                background: 'rgba(0, 0, 0, 0.78)',
                color: '#fff',
                fontSize: '22px',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                fontWeight: '500',
                letterSpacing: '0.2px',
                textAlign: 'center',
                pointerEvents: 'none',
                opacity: '0',
                transition: `opacity ${fadeInMs}ms ease-in-out`,
                maxWidth: '80%',
            });
            document.body.appendChild(el);
        }
        el.style[position === 'top' ? 'top' : 'bottom'] = '24px';
        el.style[position === 'top' ? 'bottom' : 'top'] = 'auto';
        el.textContent = text;
        // Force reflow then fade in
        void el.offsetHeight;
        el.style.opacity = '1';
    }, { id: OVERLAY_ID, text, position, fadeInMs });
}
/**
 * Show overlay text, pause for the viewer to read it, then optionally hide it.
 * Convenience wrapper combining showOverlay + pause.
 */
async function narrate(page, text, holdMs = 2000, options) {
    const { position = 'bottom', hideAfter = false } = options ?? {};
    await showOverlay(page, text, { position });
    await page.waitForTimeout(holdMs);
    if (hideAfter) {
        await showOverlay(page, '');
        await page.waitForTimeout(300); // wait for fade out
    }
}
/**
 * Pause to let the viewer absorb what just happened.
 * Use between demo steps for a natural, watchable pace.
 */
async function pause(page, ms = 1000) {
    await page.waitForTimeout(ms);
}
/**
 * Type text with human-like keystroke speed.
 * Default delay of 80ms per character looks natural on video.
 */
async function humanType(page, locator, text, delay = 80) {
    await locator.pressSequentially(text, { delay });
}
/**
 * Click with a visible mouse-down hold so the screencast mode indicator
 * appears on screen long enough to be captured in the video.
 */
async function humanClick(page, locator, options) {
    const { beforeMs = 300, holdMs = 250, afterMs = 500 } = options ?? {};
    await page.waitForTimeout(beforeMs);
    const box = await locator.boundingBox();
    if (box) {
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.waitForTimeout(holdMs);
        await page.mouse.up();
    }
    else {
        await locator.click();
    }
    await page.waitForTimeout(afterMs);
}
/**
 * Hover over an element with pauses, useful for showing tooltips
 * or hover states in the demo.
 */
async function humanHover(page, locator, options) {
    const { beforeMs = 300, holdMs = 800 } = options ?? {};
    await page.waitForTimeout(beforeMs);
    await locator.hover();
    await page.waitForTimeout(holdMs);
}
/**
 * Smoothly zoom into an area of interest. The zoom is a CSS transform on the
 * workbench container, so text stays sharp and the video recorder captures it
 * natively. Call `zoomReset()` to animate back out.
 */
async function zoomTo(page, target, options) {
    const { scale = 2, durationMs = 600 } = options ?? {};
    const box = await target.boundingBox();
    if (!box) {
        return;
    }
    // Center the zoom on the target element
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.evaluate(({ centerX, centerY, scale, durationMs }) => {
        const wb = document.querySelector('.monaco-workbench');
        if (!wb) {
            return;
        }
        const W = wb.clientWidth;
        const H = wb.clientHeight;
        // Compute the transform-origin that places the target at viewport center
        // after scaling, clamped so we don't show blank space beyond edges.
        const ox = Math.max(0, Math.min(W, (centerX * scale - W / 2) / (scale - 1)));
        const oy = Math.max(0, Math.min(H, (centerY * scale - H / 2) / (scale - 1)));
        wb.style.transition = `transform ${durationMs}ms ease-in-out`;
        wb.style.transformOrigin = `${ox}px ${oy}px`;
        wb.style.transform = `scale(${scale})`;
    }, { centerX, centerY, scale, durationMs });
    // Wait for the animation to finish
    await page.waitForTimeout(durationMs + 50);
}
/**
 * Reset zoom back to normal with a smooth animation.
 */
async function zoomReset(page, options) {
    const { durationMs = 600 } = options ?? {};
    await page.evaluate(({ durationMs }) => {
        const wb = document.querySelector('.monaco-workbench');
        if (!wb) {
            return;
        }
        wb.style.transition = `transform ${durationMs}ms ease-in-out`;
        wb.style.transform = 'scale(1)';
    }, { durationMs });
    await page.waitForTimeout(durationMs + 50);
}
//# sourceMappingURL=demo-utils.js.map