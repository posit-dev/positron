"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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
exports.FolderTemplate = exports.FlowButton = exports.NewFolderFlow = void 0;
const test_1 = __importStar(require("@playwright/test"));
class NewFolderFlow {
    code;
    quickaccess;
    get backButton() { return this.code.driver.currentPage.getByRole('button', { name: 'Back', exact: true }); }
    get cancelButton() { return this.code.driver.currentPage.getByRole('button', { name: 'Cancel' }); }
    get nextButton() { return this.code.driver.currentPage.getByRole('button', { name: 'Next', exact: true }); }
    get createButton() { return this.code.driver.currentPage.getByRole('button', { name: 'Create', exact: true }); }
    folderTemplateButton = (label) => this.code.driver.currentPage.locator('label').filter({ hasText: label });
    get folderNameInput() { return this.code.driver.currentPage.getByLabel(/Enter the name of your new/); }
    get existingEnvRadioButton() { return this.code.driver.currentPage.getByText(/Use an existing/); }
    get envProviderDropdown() { return this.code.driver.currentPage.locator('#flow-sub-step-environment-creation').locator('button'); }
    get envProviderDropdownTitle() { return this.envProviderDropdown.locator('.dropdown-entry-title'); }
    get dropDropdownOptions() { return this.code.driver.currentPage.locator('.positron-modal-popup-children').getByRole('button'); }
    get interpreterDropdown() { return this.code.driver.currentPage.locator('#flow-sub-step-pythonenvironment-interpreterorversion').locator('button'); }
    get interpreterDropdownSubtitle() { return this.interpreterDropdown.locator('.dropdown-entry-subtitle'); }
    constructor(code, quickaccess) {
        this.code = code;
        this.quickaccess = quickaccess;
    }
    /**
     * NEW FOLDER FLOW:
     * Step through the New Folder Flow in order to create a new folder.
     * @param options The options to configure the new folder.
     */
    async createNewFolder(options) {
        await test_1.default.step(`Create a new folder: ${options.folderName}`, async () => {
            await this.quickaccess.runCommand('positron.workbench.action.newFolderFromTemplate', { keepOpen: false });
            await this.setFolderTemplate(options.folderTemplate);
            await this.setFolderNameLocation(options);
            if (options.folderTemplate !== FolderTemplate.EMPTY_PROJECT) {
                await this.setConfiguration(options);
            }
            await this.code.driver.currentPage.getByRole('button', { name: 'Current Window' }).click();
            await (0, test_1.expect)(this.code.driver.currentPage.locator('.simple-title-bar').filter({ hasText: 'New Folder From Template' })).not.toBeVisible();
        });
    }
    /**
     * Step 1. Select the folder template in the New Folder Flow.
     * @param folderTemplate The folder template to select.
     */
    async setFolderTemplate(folderTemplate) {
        await this.code.driver.currentPage.locator('label').filter({ hasText: folderTemplate }).click({ force: true });
        await this.clickFlowButton(FlowButton.NEXT);
    }
    /**
     * Step 2. Set the folder name and location in the New Folder Flow.
     * @param folderName The folder name.
     * @param initGitRepo Whether to initialize a Git repository.
     **/
    async setFolderNameLocation(options) {
        const { folderName, initGitRepo, createPyprojectToml, folderTemplate: type } = options;
        await this.folderNameInput.fill(folderName);
        if (initGitRepo) {
            await this.code.driver.currentPage.getByText('Initialize Git repository').check();
        }
        if (type === FolderTemplate.PYTHON_PROJECT) {
            const checkboxLabel = this.code.driver.currentPage.getByText('Create pyproject.toml file');
            const shouldBeChecked = createPyprojectToml ?? false;
            if (!shouldBeChecked) {
                // It's checked by default, so click to uncheck
                await checkboxLabel.click();
            }
        }
        else {
            await (0, test_1.expect)(this.code.driver.currentPage.getByText('Create pyproject.toml file')).not.toBeVisible();
        }
        const button = options.folderTemplate === FolderTemplate.EMPTY_PROJECT ? FlowButton.CREATE : FlowButton.NEXT;
        await this.clickFlowButton(button);
    }
    /**
     * Step 3. Set the configuration in the New Folder Flow.
     * @param options The options to configure the folder.
     */
    async setConfiguration(options) {
        const { folderTemplate: type, rEnvCheckbox, pythonEnv, ipykernelFeedback, interpreterPath, status } = options;
        // configure R Project
        if (type === FolderTemplate.R_PROJECT && rEnvCheckbox) {
            await this.code.driver.currentPage.getByText('Use `renv` to create a').click();
        }
        // configure Python Project
        if (type === FolderTemplate.PYTHON_PROJECT) {
            if (status === 'existing') {
                await this.existingEnvRadioButton.click();
            }
            if (pythonEnv) {
                await this.selectEnvProvider(pythonEnv);
            }
            if (interpreterPath) {
                await this.selectInterpreterByPath(interpreterPath);
            }
            if (ipykernelFeedback) {
                const ipykernelMessage = this.code.driver.currentPage.getByText('ipykernel will be installed');
                ipykernelFeedback === 'show'
                    ? await (0, test_1.expect)(ipykernelMessage).toBeVisible()
                    : await (0, test_1.expect)(ipykernelMessage).not.toBeVisible();
            }
        }
        await this.clickFlowButton(FlowButton.CREATE);
    }
    /**
     * Helper: Retrieves a map of FolderTemplate to their locators in the New Folder Flow.
     * This expects that the current page is the folder template step in the New Folder Flow modal dialog.
     * @returns A map where each FolderTemplate is mapped to its locator.
     */
    getFolderTemplateLocatorMap() {
        const folderTemplateLabelLocator = this.code.driver.currentPage.locator('label');
        const folderTemplateLocators = new Map(Object.values(FolderTemplate).map((template) => [
            template,
            folderTemplateLabelLocator.filter({ hasText: template }),
        ]));
        return folderTemplateLocators;
    }
    /**
     * Helper: Clicks the specified navigation button in the new folder flow.
     * @param action The navigation action to take in the new folder flow.
     */
    async clickFlowButton(action) {
        const button = {
            [FlowButton.BACK]: this.backButton,
            [FlowButton.NEXT]: this.nextButton,
            [FlowButton.CANCEL]: this.cancelButton,
            [FlowButton.CREATE]: this.createButton,
        }[action];
        if (!button) {
            throw new Error(`Invalid flow button action: ${action}`);
        }
        await button.click();
    }
    /**
     * Helper: Selects the specified environment provider in the new folder flow environment provider dropdown.
     * @param providerToSelect The environment provider to select.
     */
    async selectEnvProvider(providerToSelect) {
        // Wait for loading to finish
        await (0, test_1.expect)(this.code.driver.currentPage.getByText(/Loading/)).toHaveCount(0, { timeout: 30000 });
        // Skip if the desired provider is already selected
        if (await this.envProviderDropdownTitle.innerText() === providerToSelect) {
            return;
        }
        // Select the desired provider from the dropdown
        await this.envProviderDropdown.click();
        await this.dropDropdownOptions.filter({ hasText: providerToSelect }).click();
    }
    /**
     * Helper: Selects the interpreter corresponding to the given path in the new folder flow interpreter dropdown.
     * @param interpreterPath The path of the interpreter to select in the dropdown.
     */
    async selectInterpreterByPath(interpreterPath) {
        // Wait for loading to complete
        await (0, test_1.expect)(this.code.driver.currentPage.getByText(/Loading/)).toHaveCount(0, { timeout: 30000 });
        // Skip if the desired interpreter is already selected
        if (await this.interpreterDropdownSubtitle.innerText() === interpreterPath) {
            return;
        }
        // Open the dropdown and select the interpreter by path
        await (0, test_1.expect)(async () => {
            try {
                await this.interpreterDropdown.click();
                await this.dropDropdownOptions
                    .locator('div.dropdown-entry-subtitle')
                    .getByText(interpreterPath)
                    .first()
                    .click({ timeout: 5000 });
            }
            catch (error) {
                await this.code.driver.currentPage.keyboard.press('Escape');
                throw error;
            }
        }).toPass({ intervals: [1_000, 5_000, 10_000], timeout: 15000 });
    }
    async expectFolderTemplatesToBeVisible(visibleTemplates = {}, closeModal = true) {
        const defaultVisibility = {
            [FolderTemplate.R_PROJECT]: false,
            [FolderTemplate.PYTHON_PROJECT]: false,
            [FolderTemplate.JUPYTER_NOTEBOOK]: false,
            [FolderTemplate.EMPTY_PROJECT]: false,
        };
        const mergedVisibility = { ...defaultVisibility, ...visibleTemplates };
        await test_1.default.step(`Verify folder flow template dialog`, async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator('.simple-title-bar-title').getByText('New Folder From Template')).toBeVisible();
            for (const template of Object.values(FolderTemplate)) {
                const isVisible = mergedVisibility[template];
                if (isVisible) {
                    await test_1.default.step(`Verify "${template}" is visible`, async () => {
                        await (0, test_1.expect)(this.folderTemplateButton(template)).toBeVisible();
                    });
                }
                else {
                    await test_1.default.step(`Verify "${template}" is not visible`, async () => {
                        await (0, test_1.expect)(this.folderTemplateButton(template)).not.toBeVisible();
                    });
                }
            }
        });
        if (closeModal) {
            await this.clickFlowButton(FlowButton.CANCEL);
        }
    }
    async verifyFolderCreation(folderName) {
        await test_1.default.step(`Verify folder created`, async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator('#top-action-bar-current-working-folder')).toHaveText(folderName, { timeout: 60000 }); // this is really slow on windows CI for some reason
        });
    }
}
exports.NewFolderFlow = NewFolderFlow;
/**
 * Enum representing the possible navigation actions that can be taken in new folder flow.
 */
var FlowButton;
(function (FlowButton) {
    FlowButton[FlowButton["BACK"] = 0] = "BACK";
    FlowButton[FlowButton["NEXT"] = 1] = "NEXT";
    FlowButton[FlowButton["CANCEL"] = 2] = "CANCEL";
    FlowButton[FlowButton["CREATE"] = 3] = "CREATE";
})(FlowButton || (exports.FlowButton = FlowButton = {}));
/**
 * Enum representing the possible folder template that can be selected in the folder flow.
 */
var FolderTemplate;
(function (FolderTemplate) {
    FolderTemplate["PYTHON_PROJECT"] = "Python Project";
    FolderTemplate["R_PROJECT"] = "R Project";
    FolderTemplate["JUPYTER_NOTEBOOK"] = "Jupyter Notebook";
    FolderTemplate["EMPTY_PROJECT"] = "Empty Project";
})(FolderTemplate || (exports.FolderTemplate = FolderTemplate = {}));
//# sourceMappingURL=newFolderFlow.js.map