"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
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
exports.Assistant = void 0;
const test_1 = require("@playwright/test");
/**
 * Fills an input element's value using evaluate() instead of Playwright's
 * fill() to prevent the value from being recorded in Playwright trace files.
 * Use this for sensitive values like API keys and passwords.
 */
async function fillSecretValue(locator, value) {
    await locator.evaluate((el, val) => {
        // Use the native HTMLInputElement prototype setter to bypass React's
        // internal value tracking. Setting el.value directly uses React's
        // overridden setter which doesn't trigger change detection.
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
            nativeSetter.call(el, val);
        }
        else {
            el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
}
// Positron modal dialog selectors (used by Posit AI)
const POSITRON_MODAL_DIALOG = '.positron-modal-dialog-box';
const CHAT_BUTTON = '.action-label.codicon-positron-assistant[aria-label^="Chat"]';
const CONFIGURE_PROVIDERS_LINK = 'a[data-href="command:positron-assistant.configureProviders"]';
const CONFIGURE_PROVIDERS_BUTTON = 'div.action-widget a[aria-label="Add and Configure Language Model Providers"]';
const APIKEY_INPUT = '#api-key-input input.text-input[type="password"]';
const CLOSE_BUTTON = 'button.positron-button.action-bar-button.default:has-text("Close")';
const SIGN_IN_BUTTON = 'button.positron-button.language-model.button.sign-in:has-text("Sign in")';
const SIGN_OUT_BUTTON = 'button.positron-button.language-model.button.sign-in:has-text("Sign out")';
const ANTHROPIC_BUTTON = 'button.positron-button.language-model.button:has(#anthropic-api-provider-button)';
const AWS_BEDROCK_BUTTON = 'button.positron-button.language-model.button:has(#amazon-bedrock-provider-button)';
const ECHO_MODEL_BUTTON = 'button.positron-button.language-model.button:has(div.codicon-info)';
const ERROR_MODEL_BUTTON = 'button.positron-button.language-model.button:has(div.codicon-error)';
const COPILOT_BUTTON = 'button.positron-button.language-model.button:has(#copilot-auth-provider-button)';
const OPENAI_BUTTON = 'button.positron-button.language-model.button:has(#openai-api-provider-button)';
const POSIT_AI_BUTTON = 'button.positron-button.language-model.button:has(#posit-ai-provider-button)';
// Posit OAuth login page selectors
const POSIT_EMAIL_FIELD = 'input[name="email"]';
const POSIT_PASSWORD_FIELD = 'input[name="password"]';
const POSIT_CONTINUE_BUTTON = 'button[type="submit"]:has-text("Continue")';
const POSIT_LOGIN_BUTTON = 'button[type="submit"]:has-text("Log in")';
const CHAT_PANEL = '#workbench\\.panel\\.chat';
const RUN_BUTTON = 'a.action-label.codicon.codicon-play[role="button"][aria-label="Run in Console"]';
const APPLY_IN_EDITOR_BUTTON = 'a.action-label.codicon.codicon-git-pull-request-go-to-changes[role="button"][aria-label="Apply in Editor"]';
const INSERT_AT_CURSOR_BUTTON = 'a.action-label.codicon.codicon-insert[role="button"][aria-label^="Insert At Cursor"]';
const COPY_BUTTON = 'a.action-label.codicon.codicon-copy[role="button"][aria-label="Copy"]';
const INSERT_NEW_FILE_BUTTON = 'a.action-label.codicon.codicon-new-file[role="button"][aria-label="Insert into New File"]';
const KEEP_BUTTON = 'a.action-label[role="button"][aria-label^="Keep Chat Edits"]';
const OAUTH_RADIO = '.language-model-authentication-method-container input#oauth[type="radio"]';
const APIKEY_RADIO = '.language-model-authentication-method-container input#apiKey[type="radio"]';
const CHAT_INPUT = '.chat-editor-container .interactive-input-editor .native-edit-context';
const SEND_MESSAGE_BUTTON = '.actions-container .action-label.codicon-send[aria-label^="Send"]';
const NEW_CHAT_BUTTON = '.composite.title .actions-container[aria-label="Chat actions"] .action-item .action-label.codicon-plus[aria-label^="New Chat"]';
const INLINE_CHAT_TOOLBAR = '.interactive-input-part.compact .chat-input-toolbars';
const MODE_DROPDOWN = '.chat-input-toolbars a.action-label[aria-label^="Set Agent"]';
const MODE_DROPDOWN_ITEM = '.monaco-list-row[role="menuitemcheckbox"]';
// const MODEL_PICKER_DROPDOWN = '.action-item.chat-input-picker-item a.action-label[aria-label^="Pick Model"] .codicon.codicon-chevron-down';
const MODEL_DROPDOWN_ITEM = '.monaco-list-row[role="menuitemcheckbox"]';
const MANAGE_MODELS_ITEM = '.action-widget a.action-label[aria-label="Manage Language Models"]';
/**
 * Returns the authentication type for a given model provider.
 */
function getProviderAuthType(provider) {
    switch (provider.toLowerCase()) {
        case 'echo':
        case 'error':
            return 'none';
        case 'anthropic-api':
        case 'openai-api':
            return 'apiKey';
        case 'amazon-bedrock':
            return 'aws';
        case 'posit-ai':
            return 'oauth';
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}
/**
 * Returns the OAuth device code configuration for a given model provider.
 */
function getOAuthConfig(provider) {
    switch (provider.toLowerCase()) {
        case 'posit-ai':
            return {
                provider: 'posit',
                // Verification URL is constructed from POSIT_AUTH_HOST env var + device code
                verificationUrl: '',
                authHostEnvVar: 'POSIT_AUTH_HOST',
                envVars: {
                    username: 'POSIT_EMAIL',
                    password: 'POSIT_PASSWORD'
                }
            };
        default:
            throw new Error(`No OAuth configuration for provider: ${provider}`);
    }
}
/**
 * Returns the environment variable name for a provider's API key.
 */
function getProviderEnvVarName(provider) {
    switch (provider.toLowerCase()) {
        case 'anthropic-api':
            return 'ANTHROPIC_KEY';
        case 'openai-api':
            return 'OPENAI_KEY';
        default:
            return `${provider.toUpperCase().replace(/-/g, '_')}_KEY`;
    }
}
/**
 * Returns the API key from environment variables for a given provider.
 */
function getProviderEnvKey(provider) {
    const envVarName = getProviderEnvVarName(provider);
    return process.env[envVarName];
}
/**
 * Returns the environment variable name that triggers auto-sign-in for a provider.
 * When these env vars are set, Positron automatically signs into the provider on startup.
 */
function getProviderAutoSignInEnvVarName(provider) {
    switch (provider.toLowerCase()) {
        case 'anthropic-api':
            return 'ANTHROPIC_API_KEY';
        case 'openai-api':
            return 'OPENAI_API_KEY';
        default:
            return undefined;
    }
}
/**
 * Returns true if the provider is auto-signed-in via environment variable.
 * When certain env vars are set (e.g., ANTHROPIC_API_KEY), Positron automatically
 * signs into the provider on startup, so no manual sign-in is required.
 */
function isProviderAutoSignedIn(provider) {
    const envVarName = getProviderAutoSignInEnvVarName(provider);
    return envVarName ? !!process.env[envVarName] : false;
}
/*
 *  Reuseable Positron Assistant functionality for tests to leverage.
 */
class Assistant {
    code;
    quickaccess;
    toasts;
    modals;
    constructor(code, quickaccess, toasts, modals) {
        this.code = code;
        this.quickaccess = quickaccess;
        this.toasts = toasts;
        this.modals = modals;
    }
    async verifyChatButtonVisible() {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(CHAT_BUTTON)).toBeVisible();
    }
    async openPositronAssistantChat() {
        await test_1.test.step('Verify Assistant is enabled and Open it.', async () => {
            await this.verifyChatButtonVisible();
            const addModelLinkIsVisible = await this.code.driver.currentPage.locator(CHAT_PANEL).isVisible();
            if (!addModelLinkIsVisible) {
                await this.code.driver.currentPage.locator(CHAT_BUTTON).click();
            }
        });
    }
    async closeInlineChat() {
        await test_1.test.step('Close Inline Chat', async () => {
            this.code.driver.currentPage.getByRole('button', { name: 'Close (Escape)' }).click();
        });
    }
    async openModelPickerDropdown() {
        const chatInput = this.code.driver.currentPage.locator(CHAT_INPUT);
        await chatInput.waitFor({ state: 'visible' });
        await chatInput.click({ force: true });
        const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
        await this.code.driver.currentPage.keyboard.press(`${modifier}+Alt+Period`);
    }
    async runConfigureProviders() {
        await this.quickaccess.runCommand('positron-assistant.configureProviders');
    }
    async clickConfigureProvidersLink() {
        await this.code.driver.currentPage.locator(CONFIGURE_PROVIDERS_LINK).click();
    }
    async clickConfigureProvidersButton() {
        // Ensure chat panel is open first
        const chatPanelIsVisible = await this.code.driver.currentPage.locator(CHAT_PANEL).isVisible();
        if (!chatPanelIsVisible) {
            await this.openPositronAssistantChat();
        }
        const configureProvidersButtonIsVisible = await this.code.driver.currentPage.locator(CONFIGURE_PROVIDERS_BUTTON).isVisible();
        if (!configureProvidersButtonIsVisible) {
            await this.openModelPickerDropdown();
        }
        await this.code.driver.currentPage.locator(CONFIGURE_PROVIDERS_BUTTON).click({ force: true });
    }
    async verifyConfigureProvidersButtonVisible() {
        await this.openModelPickerDropdown();
        await (0, test_1.expect)(this.code.driver.currentPage.locator(CONFIGURE_PROVIDERS_BUTTON)).toBeVisible();
    }
    async verifyInlineChatInputsVisible() {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(INLINE_CHAT_TOOLBAR)).toBeVisible();
        await (0, test_1.expect)(this.code.driver.currentPage.locator(INLINE_CHAT_TOOLBAR)).toBeInViewport({ ratio: 1 });
    }
    async verifyCodeBlockActions() {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(RUN_BUTTON)).toHaveCount(1);
        // PR #10784: "Apply in Editor" button may be disabled depending on model chosen and user settings
        await (0, test_1.expect)(await this.code.driver.currentPage.locator(APPLY_IN_EDITOR_BUTTON).count()).toBeLessThanOrEqual(1);
        await (0, test_1.expect)(this.code.driver.currentPage.locator(INSERT_AT_CURSOR_BUTTON)).toHaveCount(1);
        await (0, test_1.expect)(this.code.driver.currentPage.locator(COPY_BUTTON)).toHaveCount(1);
        await (0, test_1.expect)(this.code.driver.currentPage.locator(INSERT_NEW_FILE_BUTTON)).toHaveCount(1);
    }
    async pickModel() {
        await this.openModelPickerDropdown();
    }
    async expectManageModelsVisible() {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(MANAGE_MODELS_ITEM)).toBeVisible({ timeout: 3000 });
    }
    async selectModelProvider(provider) {
        switch (provider.toLowerCase()) {
            case 'anthropic-api':
                await this.code.driver.currentPage.locator(ANTHROPIC_BUTTON).click();
                break;
            case 'amazon-bedrock':
                await this.code.driver.currentPage.locator(AWS_BEDROCK_BUTTON).click();
                break;
            case 'copilot':
                await this.code.driver.currentPage.locator(COPILOT_BUTTON).click();
                break;
            case 'echo':
                await this.code.driver.currentPage.locator(ECHO_MODEL_BUTTON).click();
                break;
            case 'error':
                await this.code.driver.currentPage.locator(ERROR_MODEL_BUTTON).click();
                break;
            case 'openai-api':
                await this.code.driver.currentPage.locator(OPENAI_BUTTON).click();
                break;
            case 'posit-ai':
                await this.code.driver.currentPage.locator(POSIT_AI_BUTTON).click();
                break;
            default:
                throw new Error(`Unsupported model provider: ${provider}`);
        }
    }
    /**
     * Signs in to a model provider with the appropriate authentication method.
     * This method handles opening the configuration dialog, selecting the provider,
     * performing authentication, and closing the dialog.
     *
     * If the provider is auto-signed-in via environment variable (e.g., ANTHROPIC_API_KEY),
     * the sign-in steps are skipped.
     *
     * @param provider - The model provider to sign in to
     * @param options - Optional configuration for the login process
     * @param options.apiKey - API key for providers that support API key authentication.
     *                         If not provided, uses environment variables (ANTHROPIC_KEY, OPENAI_KEY, etc.)
     * @param options.timeout - Timeout for verifying sign-in success (default: 15000ms)
     *
     * @example
     * // Sign in to Echo provider (no credentials needed)
     * await assistant.loginModelProvider('echo');
     *
     * @example
     * // Sign in to Anthropic with environment variable
     * await assistant.loginModelProvider('anthropic-api');
     *
     * @example
     * // Sign in to OpenAI with explicit API key
     * await assistant.loginModelProvider('openai-api', { apiKey: 'sk-...' });
     */
    async loginModelProvider(provider, options = {}) {
        const { timeout = 15000 } = options;
        // Check if provider is auto-signed-in via environment variable
        if (isProviderAutoSignedIn(provider)) {
            // Provider is already signed in via env var, no action needed
            return;
        }
        await test_1.test.step(`Sign in to ${provider} model provider`, async () => {
            // Open the model configuration dialog via command (more reliable than clicking UI)
            await this.quickaccess.runCommand('positron-assistant.configureProviders');
            // Select the provider
            await this.selectModelProvider(provider);
            // Check if already signed in (Sign Out button visible)
            const alreadySignedIn = await this.code.driver.currentPage.locator(SIGN_OUT_BUTTON).isVisible();
            if (alreadySignedIn) {
                // Already signed in, just close the dialog
                await this.clickCloseButton();
                return;
            }
            // Handle authentication based on provider type
            const authType = getProviderAuthType(provider);
            switch (authType) {
                case 'none':
                    // Providers like echo/error just need sign-in click
                    await this.clickSignInButton();
                    break;
                case 'apiKey': {
                    // Get API key from options or environment variable
                    const apiKey = options.apiKey ?? getProviderEnvKey(provider);
                    if (!apiKey) {
                        throw new Error(`No API key provided for ${provider}. ` +
                            `Set the ${getProviderEnvVarName(provider)} environment variable or pass apiKey in options.`);
                    }
                    await this.enterApiKey(apiKey);
                    await this.clickSignInButton();
                    break;
                }
                case 'aws':
                    // AWS Bedrock - additional steps TBD
                    // Will be gated by conditional statements later
                    await this.clickSignInButton();
                    break;
                case 'oauth': {
                    // OAuth device code flow (e.g., GitHub Copilot)
                    const oauthConfig = getOAuthConfig(provider);
                    await this.completeOAuthDeviceCodeFlow(oauthConfig, options);
                    break;
                }
                default:
                    throw new Error(`Unknown authentication type for provider: ${provider}`);
            }
            // Verify sign-in was successful
            await this.verifySignOutButtonVisible(timeout);
            // Close the configuration dialog
            await this.clickCloseButton();
        });
    }
    /**
     * Signs out from a model provider.
     * This method handles opening the configuration dialog, selecting the provider,
     * signing out, and closing the dialog.
     *
     * If the provider is auto-signed-in via environment variable (e.g., ANTHROPIC_API_KEY),
     * the sign-out steps are skipped since we didn't manually sign in.
     *
     * @param provider - The model provider to sign out from
     * @param options - Optional configuration for the logout process
     * @param options.timeout - Timeout for verifying sign-out success (default: 15000ms)
     */
    async logoutModelProvider(provider, options = {}) {
        const { timeout = 15000 } = options;
        // Check if provider is auto-signed-in via environment variable
        // If so, we didn't manually sign in, so no need to sign out
        if (isProviderAutoSignedIn(provider)) {
            return;
        }
        await test_1.test.step(`Sign out from ${provider} model provider`, async () => {
            await this.runConfigureProviders();
            await this.selectModelProvider(provider);
            await this.clickSignOutButton();
            await this.verifySignInButtonVisible(timeout);
            await this.clickCloseButton();
        });
    }
    async enterApiKey(apiKey) {
        await this.code.driver.currentPage.locator(APIKEY_RADIO).check();
        const apiKeyInput = this.code.driver.currentPage.locator(APIKEY_INPUT);
        await fillSecretValue(apiKeyInput, apiKey);
    }
    async clickSignInButton() {
        await this.code.driver.currentPage.locator(SIGN_IN_BUTTON).click();
    }
    async clickCloseButton({ abandonChanges = true } = {}) {
        await this.code.driver.currentPage.locator(CLOSE_BUTTON).click();
        const abandonModalisVisible = await this.modals.modalTitle.filter({ hasText: 'Authentication Incomplete' }).isVisible();
        if (abandonModalisVisible) {
            abandonChanges
                ? await this.modals.getButton('Yes').click()
                : await this.modals.getButton('No').click();
        }
        await this.modals.expectToBeVisible(undefined, { visible: false });
    }
    async clickSignOutButton() {
        await this.code.driver.currentPage.locator(SIGN_OUT_BUTTON).click();
    }
    async verifySignOutButtonVisible(timeout = 15000) {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(SIGN_OUT_BUTTON)).toBeVisible({ timeout });
        await (0, test_1.expect)(this.code.driver.currentPage.locator(SIGN_OUT_BUTTON)).toHaveText('Sign out', { timeout });
    }
    async verifySignInButtonVisible(timeout = 15000) {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(SIGN_IN_BUTTON)).toBeVisible({ timeout });
        await (0, test_1.expect)(this.code.driver.currentPage.locator(SIGN_IN_BUTTON)).toHaveText('Sign in', { timeout });
    }
    async verifyAuthMethod(type) {
        switch (type) {
            case 'oauth':
                await (0, test_1.expect)(this.code.driver.currentPage.locator(OAUTH_RADIO)).toBeChecked();
                await (0, test_1.expect)(this.code.driver.currentPage.locator(APIKEY_RADIO)).toBeDisabled();
                break;
            case 'apiKey':
                await (0, test_1.expect)(this.code.driver.currentPage.locator(APIKEY_RADIO)).toBeChecked();
                await (0, test_1.expect)(this.code.driver.currentPage.locator(OAUTH_RADIO)).toBeDisabled();
                break;
            default:
                throw new Error(`Unsupported auth method: ${type}`);
        }
    }
    /**
     * Completes an OAuth device code flow by launching a separate browser,
     * signing in to the OAuth provider, and entering the verification code.
     *
     * This method:
     * 1. Clicks the sign-in button in the Electron app
     * 2. Waits for the device code modal to appear and captures the verification code
     * 3. Launches a separate Playwright browser
     * 4. Navigates to the OAuth provider's verification URL
     * 5. Signs in with credentials from environment variables
     * 6. Enters the verification code and authorizes the app
     * 7. Closes the OAuth browser
     *
     * @param config - The OAuth device code configuration
     * @param options - Login options including headless mode setting
     */
    async completeOAuthDeviceCodeFlow(config, options = {}) {
        const { headless = false } = options;
        await test_1.test.step(`Complete OAuth device code flow for ${config.provider}`, async () => {
            // Click sign-in to trigger the OAuth flow
            await this.clickSignInButton();
            // Wait for the device code modal to appear and extract the verification code
            const { verificationCode } = await this.extractDeviceCodeFromModal(config);
            // Construct or get the verification URL
            let finalVerificationUrl = config.verificationUrl;
            if (!finalVerificationUrl && config.authHostEnvVar) {
                // For Posit AI, construct URL from POSIT_AUTH_HOST env var
                const authHost = process.env[config.authHostEnvVar];
                if (!authHost) {
                    throw new Error(`OAuth auth host not configured. Please set ${config.authHostEnvVar} environment variable.`);
                }
                // Posit uses verification_uri_complete which redirects through login
                // URL format: {authHost}/login?redirect=/oauth/device?user_code={code}
                const redirectPath = encodeURIComponent(`/oauth/device?user_code=${verificationCode}`);
                finalVerificationUrl = `${authHost}/login?redirect=${redirectPath}`;
            }
            if (!finalVerificationUrl) {
                throw new Error('No verification URL available for OAuth flow');
            }
            // Launch a separate browser for OAuth authentication
            let browser;
            let context;
            let page;
            try {
                browser = await test_1.chromium.launch({ headless });
                context = await browser.newContext();
                page = await context.newPage();
                // Complete the OAuth flow in the browser
                await this.completePositLogin(page, config, verificationCode, finalVerificationUrl);
            }
            finally {
                // Ensure browser is closed even if an error occurs
                if (context) {
                    await context.close();
                }
                if (browser) {
                    await browser.close();
                }
            }
        });
    }
    /**
     * Extracts the device verification code from the Positron modal dialog.
     * Used by Posit AI OAuth flow. The code is displayed in a <code> HTML element.
     *
     * The device code modal shows: "You will need this code to sign in: <code>XXXX-XXXX</code>"
     *
     * @param config - The OAuth configuration (unused, kept for future extensibility)
     * @returns Object containing the verification code
     */
    async extractDeviceCodeFromModal(config) {
        // Wait for the device code modal to appear (not the configuration modal)
        // The device code modal contains "You will need this code to sign in" text
        const deviceCodeModalLocator = this.code.driver.currentPage.locator(`${POSITRON_MODAL_DIALOG}:has-text("You will need this code to sign in")`);
        await (0, test_1.expect)(deviceCodeModalLocator).toBeVisible({ timeout: 30000 });
        // Get the modal HTML content - Posit AI uses <code> element for the verification code
        const modalHtml = await deviceCodeModalLocator.innerHTML();
        if (!modalHtml) {
            throw new Error('Could not read Positron device code modal content');
        }
        // Extract the verification code from the <code> element
        // Pattern: <code>XXXX-XXXX</code> or similar
        const codeMatch = modalHtml.match(/<code>([A-Z0-9-]+)<\/code>/i);
        if (!codeMatch) {
            throw new Error(`Could not extract verification code from Positron modal: "${modalHtml}"`);
        }
        const verificationCode = codeMatch[1];
        // Click OK button to dismiss the device code modal
        // The browser will be opened automatically by the extension
        const okButton = deviceCodeModalLocator.locator('button:has-text("OK"), button:has-text("Ok")');
        await okButton.click();
        // Note: For Posit AI, the verification URL is opened automatically by the extension
        // via vscode.env.openExternal(), so we don't need to extract it here.
        // The test will navigate to the URL that was opened.
        return { verificationCode };
    }
    /**
     * Completes the Posit OAuth device code flow.
     *
     * The Posit login flow is:
     * 1. Enter email and click Continue
     * 2. Enter password and click Login
     * 3. Authorization completes automatically (device code is in URL)
     *
     * @param page - The Playwright page for the OAuth browser
     * @param config - The OAuth configuration with Posit-specific settings
     * @param verificationCode - The device verification code (already in URL)
     * @param verificationUrl - The URL to navigate to (includes the device code)
     */
    async completePositLogin(page, config, verificationCode, verificationUrl) {
        // Get credentials from environment variables
        const email = process.env[config.envVars.username];
        const password = process.env[config.envVars.password];
        if (!email || !password) {
            throw new Error(`Posit OAuth credentials not found. Please set ${config.envVars.username} and ${config.envVars.password} environment variables.`);
        }
        // Navigate to Posit verification page (URL includes the device code)
        await page.goto(verificationUrl);
        // Step 1: Enter email and click Continue
        await (0, test_1.expect)(page.locator(POSIT_EMAIL_FIELD)).toBeVisible({ timeout: 15000 });
        await page.locator(POSIT_EMAIL_FIELD).fill(email);
        await page.locator(POSIT_CONTINUE_BUTTON).click();
        // Step 2: Enter password and click Log in
        await (0, test_1.expect)(page.locator(POSIT_PASSWORD_FIELD)).toBeVisible({ timeout: 15000 });
        await fillSecretValue(page.locator(POSIT_PASSWORD_FIELD), password);
        await page.locator(POSIT_LOGIN_BUTTON).click();
        // Step 3: Click Continue button
        const continueButton = page.locator('button[type="submit"]:has-text("Continue")');
        await (0, test_1.expect)(continueButton).toBeVisible({ timeout: 15000 });
        await continueButton.click();
        // Step 4: Click Authorize button
        const authorizeButton = page.locator('button[type="submit"]:has-text("Authorize")');
        await (0, test_1.expect)(authorizeButton).toBeVisible({ timeout: 15000 });
        await authorizeButton.click();
        // Wait for authorization to complete (success page)
        // Need to wait for success before closing browser so Positron can complete the login
        await (0, test_1.expect)(page.locator('body')).toContainText(/success|authorized|complete|congratulations/i, { timeout: 30000 });
        // Close the page explicitly to signal completion to Positron
        await page.close();
    }
    /**
     * Gets the provider display names in their display order from the Configure Providers modal.
     * The modal must already be open before calling this method.
     * @returns Array of provider display names in display order (e.g., "Posit AI", "Anthropic")
     */
    async getProviderButtonNames() {
        const providerButtons = this.code.driver.currentPage.locator('div[id$="-provider-button"]');
        await providerButtons.first().waitFor({ state: 'visible' });
        const texts = await providerButtons.allTextContents();
        return texts.map(t => t.trim()).filter(Boolean);
    }
    /**
     * Enters a chat message and optionally waits for the response to complete.
     * This is a simple method that does NOT handle Keep/Allow buttons.
     * Use sendChatMessageAndWait() for scenarios that may require button interaction.
     *
     * @param message The message to send
     */
    async enterChatMessage(message) {
        const chatInput = this.code.driver.currentPage.locator(CHAT_INPUT);
        await chatInput.waitFor({ state: 'visible' });
        await chatInput.pressSequentially(message);
        await this.code.driver.currentPage.locator(SEND_MESSAGE_BUTTON).click();
        // It can take a moment for the loading locator to become visible.
        await this.code.driver.currentPage.locator('.chat-most-recent-response.chat-response-loading').waitFor({ state: 'visible' });
    }
    /**
     * Sends a chat message and waits for the response to complete, automatically
     * handling any Keep/Allow buttons that appear. Returns timing information
     * that excludes button interaction time for accurate LLM response measurement.
     *
     * Use this for eval tests or scenarios where Keep/Allow buttons may appear.
     *
     * @param message The message to send
     * @param options Optional configuration (timeout, etc.)
     * @returns Result containing timing information
     */
    async sendChatMessageAndWait(message, options = {}) {
        const { timeout = 60000 } = options;
        const page = this.code.driver.currentPage;
        // Locators for completion states
        const loadingResponse = page.locator('.chat-most-recent-response.chat-response-loading');
        const keepButton = page.locator(KEEP_BUTTON);
        const allowButton = page.getByRole('button', { name: 'Allow' });
        // Send the message
        const chatInput = page.locator(CHAT_INPUT);
        await chatInput.waitFor({ state: 'visible' });
        await chatInput.pressSequentially(message);
        const sendTime = Date.now();
        await page.locator(SEND_MESSAGE_BUTTON).click();
        // Wait for loading to start
        await loadingResponse.waitFor({ state: 'visible' });
        // Button configs for Keep/Allow handling
        const buttons = [
            { locator: keepButton, name: 'keep' },
            { locator: allowButton, name: 'allow' },
        ];
        const clicks = { keep: 0, allow: 0 };
        let buttonInteractionMs = 0;
        const deadline = Date.now() + timeout;
        // Loop until response is complete, handling buttons as they appear
        while (await loadingResponse.isVisible()) {
            if (Date.now() > deadline) {
                throw new Error(`Response did not complete within ${timeout}ms`);
            }
            // Check each button - click if visible and enabled
            let buttonClicked = false;
            for (const btn of buttons) {
                const isClickable = await btn.locator.isVisible().catch(() => false) &&
                    await btn.locator.isEnabled().catch(() => false);
                if (isClickable) {
                    const buttonStart = Date.now();
                    await btn.locator.click();
                    await page.waitForTimeout(100);
                    buttonInteractionMs += Date.now() - buttonStart;
                    clicks[btn.name]++;
                    buttonClicked = true;
                    break;
                }
            }
            if (buttonClicked) {
                continue;
            }
            // No clickable buttons, wait a short interval before checking again
            await page.waitForTimeout(200);
        }
        const totalMs = Date.now() - sendTime;
        return {
            llmResponseMs: totalMs - buttonInteractionMs,
            totalMs,
            keepClicks: clicks.keep,
            allowClicks: clicks.allow,
        };
    }
    /**
     * Waits for the chat response to complete by waiting for the loading state to disappear.
     * This can be called independently when a message has already been sent and we need to
     * wait for the response to finish.
     * @param timeout The maximum time to wait for the response to complete (default: 60000ms)
     */
    async waitForResponseComplete(timeout = 60000) {
        await this.code.driver.currentPage.locator('.chat-most-recent-response.chat-response-loading').waitFor({ state: 'visible' });
        await this.code.driver.currentPage.locator('.chat-most-recent-response.chat-response-loading').waitFor({ state: 'hidden', timeout });
    }
    /**
     * Asserts that the chat response is complete (not loading).
     * Unlike waitForResponseComplete, this does not wait for loading to become visible first,
     * making it suitable for asserting state when the response may already be complete.
     * @param timeout The maximum time to wait for the assertion (default: 10000ms)
     */
    async expectResponseComplete(timeout = 10000) {
        await (0, test_1.expect)(this.code.driver.currentPage.locator('.chat-most-recent-response.chat-response-loading')).not.toBeVisible({ timeout });
    }
    /**
     * Verifies the chat panel is visible.
     * @param timeout The maximum time to wait for visibility (default: 10000ms)
     */
    async expectChatPanelVisible(timeout = 10000) {
        await test_1.test.step('Verify chat panel is visible', async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator(CHAT_PANEL)).toBeVisible({ timeout });
        });
    }
    /**
     * Verifies a chat response is visible.
     * @param timeout The maximum time to wait for visibility (default: 10000ms)
     */
    async expectChatResponseVisible(timeout = 10000) {
        await test_1.test.step('Verify chat response is visible', async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator('.interactive-response')).toBeVisible({ timeout });
        });
    }
    async clickChatCodeRunButton(codeblock) {
        await this.code.driver.currentPage.locator(`span`).filter({ hasText: codeblock }).locator('span').first().dblclick();
        await this.code.driver.currentPage.locator(RUN_BUTTON).click();
    }
    async clickKeepButton(timeout = 10000) {
        await this.code.driver.currentPage.locator(KEEP_BUTTON).click({ timeout });
    }
    /**
     * Clicks the "Allow" button that appears when the assistant requests permission to use a tool.
     * @param timeout Maximum time to wait for the button to appear (default: 30000ms)
     * @returns true if the button was clicked, false if it wasn't found within the timeout
     */
    async clickAllowButton(timeout = 10000) {
        try {
            const allowButton = this.code.driver.currentPage.getByRole('button', { name: 'Allow' });
            await allowButton.waitFor({ state: 'visible', timeout });
            await allowButton.click();
            return true;
        }
        catch {
            return false;
        }
    }
    async clickNewChatButton() {
        await this.code.driver.currentPage.locator(NEW_CHAT_BUTTON).click();
        await (0, test_1.expect)(this.code.driver.currentPage.locator(CHAT_INPUT)).toBeVisible();
    }
    async verifyTokenUsageVisible() {
        await (0, test_1.expect)(this.code.driver.currentPage.locator('.token-usage')).toBeVisible();
        await (0, test_1.expect)(this.code.driver.currentPage.locator('.token-usage')).toHaveText(/Tokens: ↑\d+ ↓\d+/);
    }
    async verifyTokenUsageNotVisible() {
        await (0, test_1.expect)(this.code.driver.currentPage.locator('.token-usage')).not.toBeVisible();
    }
    async verifyTotalTokenUsageVisible() {
        await (0, test_1.expect)(this.code.driver.currentPage.locator('.token-usage-total')).toBeVisible();
        await (0, test_1.expect)(this.code.driver.currentPage.locator('.token-usage-total')).toHaveText(/Total tokens: ↑\d+ ↓\d+/);
    }
    async verifyNumberOfVisibleResponses(expectedCount, checkTokenUsage = false) {
        const responses = this.code.driver.currentPage.locator('.interactive-response');
        await (0, test_1.expect)(responses).toHaveCount(expectedCount);
        if (checkTokenUsage) {
            this.code.driver.currentPage.locator('.token-usage').nth(expectedCount - 1).waitFor({ state: 'visible' });
        }
    }
    async getTokenUsage() {
        const tokenUsageElement = this.code.driver.currentPage.locator('.token-usage');
        await (0, test_1.expect)(tokenUsageElement).toBeVisible();
        const text = await tokenUsageElement.textContent();
        (0, test_1.expect)(text).not.toBeNull();
        const inputMatch = text ? text.match(/↑(\d+)/) : null;
        const outputMatch = text ? text.match(/↓(\d+)/) : null;
        return {
            inputTokens: inputMatch ? parseInt(inputMatch[1], 10) : 0,
            outputTokens: outputMatch ? parseInt(outputMatch[1], 10) : 0
        };
    }
    async getTotalTokenUsage() {
        const totalTokenUsageElement = this.code.driver.currentPage.locator('.token-usage-total');
        await (0, test_1.expect)(totalTokenUsageElement).toBeVisible();
        const text = await totalTokenUsageElement.textContent();
        console.log('Total Token Usage Text:', text);
        (0, test_1.expect)(text).not.toBeNull();
        const totalMatch = text ? text.match(/Total tokens: ↑(\d+) ↓(\d+)/) : null;
        return {
            inputTokens: totalMatch ? parseInt(totalMatch[1], 10) : 0,
            outputTokens: totalMatch ? parseInt(totalMatch[2], 10) : 0
        };
    }
    async waitForReadyToSend(timeout = 25000) {
        await this.code.driver.currentPage.waitForSelector('.chat-input-toolbars .codicon-send', { timeout });
        await this.code.driver.currentPage.waitForSelector('.detail-container .detail:has-text("Working")', { state: 'hidden', timeout });
    }
    async waitForSendButtonVisible() {
        await this.code.driver.currentPage.locator(SEND_MESSAGE_BUTTON).waitFor({ state: 'visible' });
    }
    async selectChatMode(mode) {
        // Use retry logic to handle flaky dropdown opening
        await (0, test_1.expect)(async () => {
            // Click the mode dropdown to open it
            const dropdown = this.code.driver.currentPage.locator(MODE_DROPDOWN);
            await dropdown.waitFor({ state: 'visible', timeout: 5000 });
            await dropdown.click();
            // Wait for the dropdown menu to appear
            await this.code.driver.currentPage.locator(MODE_DROPDOWN_ITEM).first().waitFor({ state: 'visible', timeout: 5000 });
        }).toPass({ timeout: 30000 });
        // Find and click the item with the matching text
        const items = this.code.driver.currentPage.locator(MODE_DROPDOWN_ITEM);
        const count = await items.count();
        for (let i = 0; i < count; i++) {
            const item = items.nth(i);
            const titleSpan = item.locator('span.title');
            const text = await titleSpan.textContent();
            if (text?.trim() === mode) {
                // Use force: true to bypass the pointer block
                await item.click({ force: true });
                return;
            }
        }
        throw new Error(`Mode "${mode}" not found in dropdown`);
    }
    async selectChatModel(model) {
        // Open the model picker dropdown
        await this.openModelPickerDropdown();
        // Wait for the dropdown menu to appear
        await this.code.driver.currentPage.locator(MODEL_DROPDOWN_ITEM).first().waitFor({ state: 'visible' });
        // Find and click the item with the matching text
        const items = this.code.driver.currentPage.locator(MODEL_DROPDOWN_ITEM);
        const count = await items.count();
        for (let i = 0; i < count; i++) {
            const item = items.nth(i);
            const titleSpan = item.locator('span.title');
            const text = await titleSpan.textContent();
            if (text?.trim() === model) {
                // Use force: true to bypass the pointer block
                await item.click({ force: true });
                return;
            }
        }
        throw new Error(`Model "${model}" not found in dropdown`);
    }
    /**
     * Asserts that a model item with the given text exists in the picker dropdown.
     * The dropdown must already be open before calling this method.
     * @param text The text to match (string for contains, RegExp for exact matching)
     */
    async expectModelInPicker(text) {
        await test_1.test.step(`Expect model in picker: ${text}`, async () => {
            const locator = this.code.driver.currentPage.locator('.monaco-list-row.action span.title', { hasText: text });
            await (0, test_1.expect)(locator).toHaveCount(1);
        });
    }
    /**
     * Asserts that a vendor separator with the given name exists in the picker dropdown.
     * The dropdown must already be open before calling this method.
     * @param vendor The vendor name to match
     */
    async expectVendorSeparator(vendor) {
        await test_1.test.step(`Expect vendor separator: ${vendor}`, async () => {
            const locator = this.code.driver.currentPage.locator('.monaco-list-row.separator span.separator-label', { hasText: vendor });
            await (0, test_1.expect)(locator).toHaveCount(1);
        });
    }
    /**
     * Gets all model items from the model picker dropdown.
     * Returns an array of objects containing the model label and whether it's marked as default.
     * The dropdown must already be open before calling this method.
     */
    async getModelPickerItems() {
        // Select only action items (models), excluding separators (vendor headers)
        const modelRows = this.code.driver.currentPage.locator('.monaco-list-row.action');
        const titles = await modelRows.locator('span.title').allTextContents();
        return titles
            .map(text => text.trim())
            .filter(text => text.length > 0)
            .map(label => ({
            label,
            isDefault: label.includes('(default)')
        }));
    }
    /**
     * Gets model items for a specific vendor from the model picker dropdown.
     * Returns models in their displayed order.
     * The dropdown must already be open before calling this method.
     * @param vendor The vendor name to filter by (e.g., 'Echo', 'Anthropic')
     */
    async getModelPickerItemsForVendor(vendor) {
        const allRows = this.code.driver.currentPage.locator('.action-widget .monaco-list-row');
        const count = await allRows.count();
        const vendorModels = [];
        let inVendorSection = false;
        for (let i = 0; i < count; i++) {
            const item = allRows.nth(i);
            const classAttr = await item.getAttribute('class') || '';
            // Check if this is a separator (vendor header)
            if (classAttr.includes('separator')) {
                const labelText = await item.locator('span.separator-label').textContent();
                inVendorSection = labelText?.trim().toLowerCase() === vendor.toLowerCase();
                continue;
            }
            // If we're in the vendor section and this is an action item, collect the model
            if (inVendorSection && classAttr.includes('action')) {
                const titleText = await item.locator('span.title').textContent();
                if (titleText) {
                    const label = titleText.trim();
                    vendorModels.push({
                        label,
                        isDefault: label.includes('(default)')
                    });
                }
            }
        }
        return vendorModels;
    }
    /**
     * Verifies that a specific model shows the "(default)" indicator in the model picker.
     * @param modelName The base model name (without the "(default)" suffix)
     */
    async verifyModelHasDefaultIndicator(modelName) {
        await test_1.test.step(`Verify model "${modelName}" has default indicator`, async () => {
            const models = await this.getModelPickerItems();
            const modelWithDefault = models.find(m => m.label === `${modelName} (default)`);
            (0, test_1.expect)(modelWithDefault, `Expected to find model "${modelName}" with "(default)" indicator`).toBeDefined();
            (0, test_1.expect)(modelWithDefault?.isDefault).toBe(true);
        });
    }
    /**
     * Verifies that a model does NOT have the "(default)" indicator.
     * @param modelName The base model name
     */
    async verifyModelDoesNotHaveDefaultIndicator(modelName) {
        await test_1.test.step(`Verify model "${modelName}" does not have default indicator`, async () => {
            const models = await this.getModelPickerItems();
            const modelWithDefault = models.find(m => m.label === `${modelName} (default)`);
            (0, test_1.expect)(modelWithDefault, `Expected model "${modelName}" to NOT have "(default)" indicator`).toBeUndefined();
        });
    }
    /**
     * Closes the model picker dropdown by pressing Escape if it is open.
     */
    async closeModelPickerDropdown() {
        const dropdownItem = this.code.driver.currentPage.locator(MODEL_DROPDOWN_ITEM).first();
        if (await dropdownItem.isVisible()) {
            await this.code.driver.currentPage.keyboard.press('Escape');
            await (0, test_1.expect)(dropdownItem).not.toBeVisible();
        }
    }
    async getChatResponseText(exportFolder) {
        // Export and find the chat file with retry (export may silently fail or file may not be ready)
        let chatExportFile = null;
        await (0, test_1.expect)(async () => {
            await this.quickaccess.runCommand(`positron-assistant.exportChatToFileInWorkspace`);
            await this.toasts.waitForAppear('Chat log exported to:');
            await this.toasts.closeWithHeader('Chat log exported to:');
            chatExportFile = await this.findChatExportFile(exportFolder);
            (0, test_1.expect)(chatExportFile).not.toBeNull();
        }).toPass({ timeout: 15000 });
        const responseText = await this.parseChatResponseFromFile(chatExportFile);
        // Rename the file to prevent it from being found again
        await this.renameChatExportFile(chatExportFile);
        return responseText;
    }
    /**
     * Finds the most recent chat export JSON file matching the pattern 'positron-chat-export-*'
     * @param exportFolder Optional folder path to search in. If not provided, searches in current working directory
     * @returns The file path of the found chat export file, or null if not found
     */
    async findChatExportFile(exportFolder) {
        const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        // Use provided folder or current working directory
        const searchPath = exportFolder || process.cwd();
        try {
            const files = await fs.readdir(searchPath);
            const chatExportFiles = files
                .filter((file) => file.match(/^positron-chat-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/))
                .map((file) => ({
                name: file,
                path: path.join(searchPath, file),
                // Extract timestamp from filename for sorting
                timestamp: file.match(/positron-chat-export-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/)?.[1]
            }))
                .filter((file) => file.timestamp)
                .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // Sort by timestamp descending (newest first)
            if (chatExportFiles.length > 0) {
                return chatExportFiles[0].path;
            }
        }
        catch (error) {
            // Directory might not exist or not accessible
            console.log(`Could not search in ${searchPath}:`, error);
        }
        return null;
    }
    /**
     * Parses the chat response text from a chat export JSON file
     * @param filePath Path to the chat export JSON file
     * @returns The concatenated response text from all chat responses
     */
    async parseChatResponseFromFile(filePath) {
        const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        try {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            const chatData = JSON.parse(fileContent);
            const responses = [];
            const toolCalls = [];
            // Extract response text from all requests
            if (chatData.requests && Array.isArray(chatData.requests)) {
                for (const request of chatData.requests) {
                    if (request.response && Array.isArray(request.response)) {
                        for (const responseItem of request.response) {
                            if (responseItem.value && typeof responseItem.value === 'string') {
                                responses.push(responseItem.value);
                            }
                            // Check for tool calls
                            if (responseItem.toolId && typeof responseItem.toolId === 'string') {
                                toolCalls.push(responseItem.toolId);
                            }
                        }
                    }
                }
            }
            let result = responses.join('\n');
            // Add tool calls information if any were found
            if (toolCalls.length > 0) {
                result += '\n\nTools called: ' + toolCalls.join(', ');
            }
            return result;
        }
        catch (error) {
            throw new Error(`Failed to parse chat export file ${filePath}: ${error}`);
        }
    }
    /**
     * Parses the available tools from a chat export JSON file
     * @param filePath Path to the chat export JSON file
     * @returns Array of available tool names from the most recent request
     */
    async parseAvailableToolsFromFile(filePath) {
        const fs = require('fs').promises;
        try {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            const chatData = JSON.parse(fileContent);
            // Get the available tools from the most recent request
            if (chatData.requests && Array.isArray(chatData.requests) && chatData.requests.length > 0) {
                const lastRequest = chatData.requests[chatData.requests.length - 1];
                if (lastRequest.result?.metadata?.availableTools) {
                    return lastRequest.result.metadata.availableTools;
                }
            }
            return [];
        }
        catch (error) {
            throw new Error(`Failed to parse available tools from chat export file ${filePath}: ${error}`);
        }
    }
    /**
     * Gets the available tools from the most recent chat response.
     * Exports the chat to a file and parses the availableTools array from the metadata.
     * @param exportFolder Optional folder path to export the chat to
     * @returns Array of available tool names
     */
    async getAvailableTools(exportFolder) {
        // Export the chat to a file first
        await this.quickaccess.runCommand(`positron-assistant.exportChatToFileInWorkspace`);
        await this.toasts.waitForAppear('Chat log exported to:');
        await this.toasts.closeAll();
        // Find and parse the chat export file
        const chatExportFile = await this.findChatExportFile(exportFolder);
        if (!chatExportFile) {
            throw new Error('No chat export file found');
        }
        const availableTools = await this.parseAvailableToolsFromFile(chatExportFile);
        // Rename the file to prevent it from being found again
        await this.renameChatExportFile(chatExportFile);
        return availableTools;
    }
    /**
     * Renames a chat export file to mark it as processed
     * @param filePath Path to the chat export JSON file to rename
     */
    async renameChatExportFile(filePath) {
        const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        try {
            const dir = path.dirname(filePath);
            const filename = path.basename(filePath);
            // Add ".processed" before the file extension
            const newFilename = filename.replace('.json', '.processed.json');
            const newFilePath = path.join(dir, newFilename);
            await fs.rename(filePath, newFilePath);
        }
        catch (error) {
            console.log(`Could not rename chat export file ${filePath}:`, error);
            // Don't throw error here to avoid breaking the main flow
        }
    }
}
exports.Assistant = Assistant;
//# sourceMappingURL=positronAssistant.js.map