/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Standalone script to generate the EVAL_CATALOG.md file.
 * Run via: npm run generate-eval-catalog
 *
 * This script scans all test case files and generates the catalog
 * without requiring tests to be run first.
 */

import { join, dirname } from 'path';
import { readdirSync, statSync, writeFileSync, readFileSync, existsSync } from 'fs';

// Types for test cases
interface EvaluationCriteria {
	required: string[];
	optional?: string[];
	failIf?: string[];
}

interface TestCase {
	id: string;
	description: string;
	prompt: string;
	mode: 'Ask' | 'Edit' | 'Agent';
	evaluationCriteria: EvaluationCriteria;
}

const EVAL_DIR = dirname(__dirname);
const CATALOG_PATH = join(EVAL_DIR, 'EVAL_CATALOG.md');

/**
 * Discovers test case directories (excluding _helpers, _logs, etc.)
 */
function getCategories(): string[] {
	return readdirSync(EVAL_DIR).filter(entry => {
		const fullPath = join(EVAL_DIR, entry);
		return (
			statSync(fullPath).isDirectory() &&
			!entry.startsWith('_') &&
			!entry.startsWith('.')
		);
	});
}

/**
 * Loads test cases from a category directory.
 */
async function loadTestCases(category: string): Promise<TestCase[]> {
	const categoryDir = join(EVAL_DIR, category);
	const files = readdirSync(categoryDir).filter(f =>
		f.endsWith('.ts') && !f.includes('.test.')
	);

	const testCases: TestCase[] = [];

	for (const file of files) {
		const filePath = join(categoryDir, file);
		try {
			// Dynamic import works with ts-node/tsx
			const module = await import(filePath);
			for (const value of Object.values(module)) {
				if (isTestCase(value)) {
					testCases.push(value);
				}
			}
		} catch (error) {
			console.warn(`Failed to load ${filePath}:`, (error as Error).message);
		}
	}

	return testCases.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Type guard for test cases.
 */
function isTestCase(value: unknown): value is TestCase {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.id === 'string' &&
		typeof obj.description === 'string' &&
		typeof obj.prompt === 'string' &&
		typeof obj.mode === 'string' &&
		typeof obj.evaluationCriteria === 'object'
	);
}

/**
 * Generates the markdown catalog.
 */
function generateMarkdown(categories: Map<string, TestCase[]>): string {
	const timestamp = new Date().toISOString();
	const lines: string[] = [];

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
async function main(): Promise<void> {
	console.log('Generating EVAL_CATALOG.md...\n');

	const categories = getCategories();
	console.log(`Found categories: ${categories.join(', ')}`);

	const allTestCases = new Map<string, TestCase[]>();

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
	const stripTimestamp = (content: string) =>
		content.replace(/Auto-generated on \d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'Auto-generated on [TIMESTAMP]');

	if (existsSync(CATALOG_PATH)) {
		const existing = readFileSync(CATALOG_PATH, 'utf-8');
		if (stripTimestamp(existing) === stripTimestamp(markdown)) {
			console.log('\n✓ Catalog unchanged');
			return;
		}
	}

	writeFileSync(CATALOG_PATH, markdown);
	console.log(`\n✓ Catalog written to ${CATALOG_PATH}`);
}

main().catch(err => {
	console.error('Error:', err);
	process.exit(1);
});
