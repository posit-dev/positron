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
exports.previewUrl = previewUrl;
/*---------------------------------------------------------------------------------------------
 *  Positron URL Preview Functions
 *
 *  This file provides cross-platform URL preview functionality that works in both
 *  Positron and VS Code environments.
 *--------------------------------------------------------------------------------------------*/
const runtime_1 = require("./runtime");
/**
 * Opens a URL for preview in either Positron's preview pane or VS Code's external browser.
 *
 * This function automatically detects the runtime environment and uses the appropriate
 * method to display URLs:
 * - In Positron: Uses the built-in preview pane via `positron.window.previewUrl`
 * - In VS Code: Opens the URL in the default external browser via `vscode.env.openExternal`
 *
 * @param url - The URL to open/preview
 * @returns Promise that resolves when the URL has been opened
 *
 * @example
 * ```typescript
 * import { previewUrl } from '@posit-dev/positron/preview';
 *
 * // This will work in both Positron and VS Code
 * await previewUrl('https://example.com');
 * await previewUrl('http://localhost:3000');
 * ```
 */
async function previewUrl(url) {
    const positronApi = (0, runtime_1.tryAcquirePositronApi)();
    const vscode = await Promise.resolve().then(() => __importStar(require('vscode')));
    const uri = vscode.Uri.parse(url);
    if (positronApi) {
        // We're in Positron - use the preview pane
        positronApi.window.previewUrl(uri);
    }
    else {
        // We're in VS Code - open in external browser
        await vscode.env.openExternal(uri);
    }
}
