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
export declare function previewUrl(url: string): Promise<void>;
