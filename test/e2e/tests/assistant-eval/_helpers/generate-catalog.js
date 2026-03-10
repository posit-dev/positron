"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
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
/**
 * Standalone script to generate the README.md file.
 * Run via: npm run generate-eval-catalog
 *
 * This script scans all test case files and generates the catalog
 * without requiring tests to be run first.
 */
const path_1 = require("path");
const fs_1 = require("fs");
const EVAL_DIR = (0, path_1.dirname)(__dirname);
const CATALOG_PATH = (0, path_1.join)(EVAL_DIR, 'README.md');
/**
 * Discovers test case directories (excluding _helpers, _logs, etc.)
 */
function getCategories() {
    return (0, fs_1.readdirSync)(EVAL_DIR).filter(entry => {
        const fullPath = (0, path_1.join)(EVAL_DIR, entry);
        return ((0, fs_1.statSync)(fullPath).isDirectory() &&
            !entry.startsWith('_') &&
            !entry.startsWith('.'));
    });
}
/**
 * Loads test cases from a category directory.
 */
async function loadTestCases(category) {
    const categoryDir = (0, path_1.join)(EVAL_DIR, category);
    const files = (0, fs_1.readdirSync)(categoryDir).filter(f => f.endsWith('.ts') && !f.includes('.test.'));
    const testCases = [];
    for (const file of files) {
        const filePath = (0, path_1.join)(categoryDir, file);
        try {
            // Dynamic import works with ts-node/tsx
            const module = await Promise.resolve(`${filePath}`).then(s => __importStar(require(s)));
            for (const value of Object.values(module)) {
                if (isTestCase(value)) {
                    testCases.push(value);
                }
            }
        }
        catch (error) {
            console.warn(`Failed to load ${filePath}:`, error.message);
        }
    }
    return testCases.sort((a, b) => a.id.localeCompare(b.id));
}
/**
 * Type guard for test cases.
 */
function isTestCase(value) {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const obj = value;
    return (typeof obj.id === 'string' &&
        typeof obj.description === 'string' &&
        typeof obj.prompt === 'string' &&
        typeof obj.mode === 'string' &&
        typeof obj.evaluationCriteria === 'object');
}
/**
 * Generates the markdown catalog.
 */
function generateMarkdown(categories) {
    const timestamp = new Date().toISOString();
    const lines = [];
    let totalCount = 0;
    for (const testCases of categories.values()) {
        totalCount += testCases.length;
    }
    lines.push('# Positron: LLM Eval Test Catalog');
    lines.push('');
    lines.push(`> ${totalCount} test cases · Auto-generated on ${timestamp}`);
    lines.push('');
    const sortedCategories = [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [category, testCases] of sortedCategories) {
        const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1);
        lines.push(`## ${categoryTitle}`);
        lines.push('');
        for (const tc of testCases) {
            const hint = tc.description.length > 50 ? tc.description.slice(0, 47) + '...' : tc.description;
            lines.push(`<details>`);
            lines.push(`<summary><strong>${tc.id}</strong> · ${tc.mode} · ${hint}</summary>`);
            lines.push('');
            lines.push(`### Intent`);
            lines.push('');
            lines.push(tc.description);
            lines.push('');
            lines.push(`### User prompt`);
            lines.push('');
            lines.push('```text');
            lines.push(tc.prompt);
            lines.push('```');
            lines.push('');
            lines.push('### Criteria');
            lines.push('');
            lines.push('#### Required');
            lines.push('');
            for (const c of tc.evaluationCriteria.required) {
                lines.push(`- ${c}`);
            }
            lines.push('');
            if (tc.evaluationCriteria.optional?.length) {
                lines.push('#### Nice to have');
                lines.push('');
                for (const c of tc.evaluationCriteria.optional) {
                    lines.push(`- ${c}`);
                }
                lines.push('');
            }
            if (tc.evaluationCriteria.failIf?.length) {
                lines.push('#### Fail if');
                lines.push('');
                for (const c of tc.evaluationCriteria.failIf) {
                    lines.push(`- ${c}`);
                }
                lines.push('');
            }
            lines.push('</details>');
            lines.push('');
        }
    }
    return lines.join('\n');
}
/**
 * Main entry point.
 */
async function main() {
    console.log('Generating README.md...\n');
    const categories = getCategories();
    console.log(`Found categories: ${categories.join(', ')}`);
    const allTestCases = new Map();
    for (const category of categories) {
        const testCases = await loadTestCases(category);
        if (testCases.length > 0) {
            allTestCases.set(category, testCases);
            console.log(`  ${category}: ${testCases.length} test cases`);
        }
    }
    if (allTestCases.size === 0) {
        console.error('No test cases found!');
        process.exit(1);
    }
    const markdown = generateMarkdown(allTestCases);
    // Check if content changed
    const stripTimestamp = (content) => content.replace(/Auto-generated on \d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'Auto-generated on [TIMESTAMP]');
    if ((0, fs_1.existsSync)(CATALOG_PATH)) {
        const existing = (0, fs_1.readFileSync)(CATALOG_PATH, 'utf-8');
        if (stripTimestamp(existing) === stripTimestamp(markdown)) {
            console.log('\n✓ Catalog unchanged');
            return;
        }
    }
    (0, fs_1.writeFileSync)(CATALOG_PATH, markdown);
    console.log(`\n✓ Catalog written to ${CATALOG_PATH}`);
}
main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
//# sourceMappingURL=generate-catalog.js.map