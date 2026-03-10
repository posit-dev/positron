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
exports.loadEnvironmentVars = loadEnvironmentVars;
exports.validateEnvironmentVars = validateEnvironmentVars;
const fs = __importStar(require("fs"));
const path_1 = require("path");
/**
 * Parse a single line from an env file into key-value pair
 */
function parseEnvLine(line) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        return null;
    }
    const [key, ...valueParts] = trimmed.split('=');
    if (!key || valueParts.length === 0) {
        return null;
    }
    let value = valueParts.join('=');
    // Strip surrounding quotes (single or double)
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    }
    return [key, value];
}
/**
 * Load environment variables from a single .env file
 */
function loadEnvFile(envFilePath) {
    const fullPath = (0, path_1.join)(process.cwd(), envFilePath);
    if (!fs.existsSync(fullPath)) {
        return {};
    }
    try {
        const envContent = fs.readFileSync(fullPath, 'utf8');
        const vars = {};
        for (const line of envContent.split('\n')) {
            const parsed = parseEnvLine(line);
            if (parsed) {
                const [key, value] = parsed;
                vars[key] = value;
            }
        }
        return vars;
    }
    catch (error) {
        console.warn(`⚠️ Failed to load ${envFilePath}:`, error);
        return {};
    }
}
/**
 * Environment file mappings per project type
 */
const PROJECT_ENV_FILES = {
    'e2e-workbench': ['.env.e2e-workbench'],
    default: ['.env.e2e']
};
/**
 * Apply environment variables to process.env, with logging
 */
function applyEnvironmentVars(vars, sourceFile) {
    Object.entries(vars).forEach(([key, value]) => {
        if (!value.trim()) {
            console.warn(`⚠️ ${sourceFile}: ${key} is empty, keeping existing value`);
            return;
        }
        const previousValue = process.env[key];
        process.env[key] = value;
        // Optional: log changes for debugging
        if (process.env.DEBUG_ENV_LOADING) {
            console.log(`[${sourceFile}] ${key}: ${previousValue || '(unset)'} → ${value}`);
        }
    });
}
/**
 * Load and apply environment variables for a specific project
 */
function loadEnvironmentVars(projectName) {
    const envFiles = PROJECT_ENV_FILES[projectName] || PROJECT_ENV_FILES['default'];
    if (!envFiles) {
        // No specific env files for this project - that's fine
        return;
    }
    let totalVarsLoaded = 0;
    for (const envFile of envFiles) {
        const vars = loadEnvFile(envFile);
        const varCount = Object.keys(vars).length;
        if (varCount > 0) {
            applyEnvironmentVars(vars, envFile);
            totalVarsLoaded += varCount;
        }
    }
    if (totalVarsLoaded > 0 && process.env.DEBUG_ENV_LOADING) {
        console.log(`✅ Loaded ${totalVarsLoaded} environment variables for ${projectName}`);
    }
}
/**
 * Check that required environment variables are set and have non-empty values
 *
 * @param requiredVars - Array of environment variable names that must be set
 * @param options - Validation options
 * @returns Validation result with details about missing or empty variables
 */
function validateEnvironmentVars(requiredVars, options = {}) {
    const { allowEmpty = false } = options;
    const missing = [];
    const empty = [];
    for (const varName of requiredVars) {
        const value = process.env[varName];
        if (value === undefined) {
            missing.push(varName);
        }
        else if (!allowEmpty && value.trim() === '') {
            empty.push(varName);
        }
    }
    const isValid = missing.length === 0 && (allowEmpty || empty.length === 0);
    // Log issues for visibility
    if (missing.length > 0) {
        console.error(`❌ Missing env var(s): ${missing.join(', ')}`);
    }
    if (!allowEmpty && empty.length > 0) {
        console.error(`❌ Empty env var(s): ${empty.join(', ')}`);
    }
    return { isValid, missing, empty };
}
//# sourceMappingURL=load-environment-vars.js.map