/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * POM Reference Generator
 *
 * Parses Positron's Page Object Model (POM) source files and generates a compact
 * markdown reference with full TypeScript type signatures. This reference is used
 * by the AI-driven QA system to know exact method names and parameter types when
 * generating test code.
 *
 * Usage:
 *   npx tsx scripts/generate-pom-reference.ts
 *
 * Output:
 *   test/e2e/tests/_generated/pom-reference.md      (single-file, kept for backward compat)
 *   test/e2e/tests/_generated/pom-ref/<name>.md      (per-POM files for targeted reads)
 */

import * as fs from 'fs';
import * as path from 'path';

const E2E_ROOT = path.resolve(__dirname, '../test/e2e');
const WORKBENCH_PATH = path.join(E2E_ROOT, 'infra/workbench.ts');
const OUTPUT_DIR = path.join(E2E_ROOT, 'tests/_generated');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'pom-reference.md');

// ---------------------------------------------------------------------------
// 1. Parse the Workbench class to build: propName -> TypeName -> import path
// ---------------------------------------------------------------------------

const workbenchSource = fs.readFileSync(WORKBENCH_PATH, 'utf-8');

// Extract `readonly propName: TypeName` from the Workbench class body
const workbenchProps = new Map<string, string>();
for (const match of workbenchSource.matchAll(/readonly\s+(\w+)\s*:\s*(\w+)/g)) {
	workbenchProps.set(match[1], match[2]); // e.g., 'sessions' -> 'Sessions'
}

// Extract import paths: `import { TypeName } from '../pages/path'`
const importMap = new Map<string, string>();
for (const match of workbenchSource.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
	const types = match[1].split(',').map(t => t.trim());
	const importPath = match[2];
	for (const type of types) {
		importMap.set(type, importPath);
	}
}

// ---------------------------------------------------------------------------
// 2. Resolve import path to actual .ts file path
// ---------------------------------------------------------------------------

function resolveImportPath(importPath: string, baseDir: string): string | null {
	let resolved = path.resolve(baseDir, importPath);
	if (!resolved.endsWith('.ts') && !resolved.endsWith('.js')) {
		resolved += '.ts';
	}
	// Some imports use .js extension but source is .ts
	if (resolved.endsWith('.js')) {
		resolved = resolved.replace(/\.js$/, '.ts');
	}
	if (fs.existsSync(resolved)) {
		return resolved;
	}
	return null;
}

// ---------------------------------------------------------------------------
// 3. Extract public method signatures from a POM source file
// ---------------------------------------------------------------------------

interface MethodSignature {
	name: string;
	signature: string;
	jsdoc: string | null;
}

interface SubObject {
	getterName: string;
	typeName: string;
	filePath: string;
	methods: MethodSignature[];
}

/**
 * Strip string literals and comments from a line to avoid counting braces
 * inside strings or comments.
 */
function stripStringsAndComments(line: string): string {
	// Remove single-line comments
	let result = line.replace(/\/\/.*$/, '');
	// Remove string literals (single, double, backtick - simplified)
	result = result.replace(/'(?:[^'\\]|\\.)*'/g, '""');
	result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');
	result = result.replace(/`(?:[^`\\]|\\.)*`/g, '""');
	return result;
}

/**
 * Count net brace depth change in a line (after stripping strings/comments).
 */
function braceBalance(line: string): number {
	const clean = stripStringsAndComments(line);
	return (clean.match(/\{/g) || []).length - (clean.match(/\}/g) || []).length;
}

/**
 * Extract public method signatures from a TypeScript class source.
 * Returns methods for the first (or specified) exported class in the file.
 *
 * Only considers lines at brace depth 1 (direct class members), which
 * prevents picking up control-flow statements inside method bodies.
 */
function extractMethods(source: string, targetClassName?: string): MethodSignature[] {
	const methods: MethodSignature[] = [];
	const lines = source.split('\n');

	// Find the target class and track brace depth through the whole class
	let inClass = false;
	let depth = 0; // depth 1 = class body level
	let pendingJsdoc: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (!inClass) {
			const classMatch = targetClassName
				? line.match(new RegExp(`^export\\s+class\\s+${targetClassName}\\b`))
				: line.match(/^export\s+class\s+\w+/);
			if (classMatch) {
				inClass = true;
				depth = braceBalance(line);
				continue;
			}
		} else {
			// Save depth BEFORE processing this line -- a method signature
			// like `async foo(): void {` starts at depth 1 even though the
			// trailing `{` pushes depth to 2 on the same line.
			const depthBeforeLine = depth;
			depth += braceBalance(line);

			// Class closed
			if (depth <= 0) {
				break;
			}

			// Only look at lines that START at depth 1 (direct class members)
			if (depthBeforeLine !== 1) {
				continue;
			}

			const trimmed = line.trim();

			// Skip empty lines, single-line comments, decorators
			if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@')) {
				continue;
			}

			// Capture JSDoc blocks
			if (trimmed.startsWith('/**')) {
				// Collect the full JSDoc block
				let jsdocBlock = trimmed;
				if (!trimmed.includes('*/')) {
					for (let j = i + 1; j < lines.length; j++) {
						const jsdocLine = lines[j].trim();
						jsdocBlock += '\n' + jsdocLine;
						if (jsdocLine.includes('*/')) {
							i = j; // advance outer loop past the JSDoc block
							break;
						}
					}
				}
				pendingJsdoc = jsdocBlock;
				continue;
			}

			// Skip lines that are mid-JSDoc (continuation lines starting with *)
			if (trimmed.startsWith('*')) {
				continue;
			}

			// Skip private/protected methods
			if (trimmed.startsWith('private ') || trimmed.startsWith('protected ')) {
				continue;
			}

			// Skip constructor
			if (/^constructor\s*\(/.test(trimmed)) {
				continue;
			}

			// Match method signatures:
			// - `async methodName(...): ReturnType {`
			// - `public async methodName(...): ReturnType {`
			// - `methodName(...): ReturnType {`
			// - `get propName(): Type {` (handled but filtered for sub-objects)
			const methodMatch = trimmed.match(
				/^(?:public\s+)?(?:async\s+)?(\w+)\s*(<[^>]*>)?\s*\(/
			);

			if (!methodMatch) {
				pendingJsdoc = null; // JSDoc was for a non-method member, discard
				continue;
			}

			const methodName = methodMatch[1];

			// Skip private-by-convention methods
			if (methodName.startsWith('_')) {
				continue;
			}

			// Skip constructors caught by other patterns
			if (methodName === 'constructor') {
				continue;
			}

			// Collect the full signature (may span multiple lines)
			let signature = trimmed;
			let j = i;

			// Keep reading lines until we find the opening `{` or `;` that ends the signature
			while (!signatureComplete(signature) && j < lines.length - 1) {
				j++;
				signature += ' ' + lines[j].trim();
			}

			// Extract just the signature portion (up to the opening brace or semicolon)
			const cleaned = cleanSignature(signature);
			if (cleaned) {
				methods.push({ name: methodName, signature: cleaned, jsdoc: pendingJsdoc });
				pendingJsdoc = null;
			}
		}
	}

	return methods;
}

/**
 * Check if a signature is complete. A signature is complete when:
 * - All parentheses, angle brackets, and curly braces within the parameter/type
 *   area are balanced, AND
 * - The string ends with `{` (method body start) or `;` (abstract/interface method)
 *
 * This prevents prematurely terminating on `{` inside inline object types like
 * `{ variableName: string; action: 'expand' | 'collapse' }`.
 */
function signatureComplete(sig: string): boolean {
	const trimmed = sig.trimEnd();
	if (!trimmed.endsWith('{') && !trimmed.endsWith(';')) {
		return false;
	}

	// Count balanced delimiters across the whole signature
	let parens = 0;   // ( )
	let angles = 0;   // < >
	let braces = 0;   // { }
	for (const ch of trimmed) {
		if (ch === '(') { parens++; }
		if (ch === ')') { parens--; }
		if (ch === '<') { angles++; }
		if (ch === '>') { angles--; }
		if (ch === '{') { braces++; }
		if (ch === '}') { braces--; }
	}

	// The trailing `{` of the method body is the one "extra" unbalanced brace.
	// If the signature ends with `{`, braces should be exactly 1 (the method body opener).
	// If it ends with `;`, braces should be 0.
	if (trimmed.endsWith('{')) {
		return parens === 0 && angles <= 0 && braces === 1;
	}
	// Ends with `;`
	return parens === 0 && angles <= 0 && braces === 0;
}

/**
 * Find the position of the method body's opening brace -- the unbalanced `{`
 * that is NOT part of an inline type annotation.
 */
function findMethodBodyBrace(sig: string): number {
	let parens = 0;
	let angles = 0;
	let braces = 0;
	for (let i = 0; i < sig.length; i++) {
		const ch = sig[i];
		if (ch === '(') { parens++; }
		if (ch === ')') { parens--; }
		if (ch === '<') { angles++; }
		if (ch === '>') { angles--; }
		if (ch === '{') {
			braces++;
			// If this brace pushes us to 1 and parens/angles are balanced,
			// this is the method body brace
			if (braces === 1 && parens === 0 && angles <= 0) {
				return i;
			}
		}
		if (ch === '}') { braces--; }
	}
	return -1;
}

/**
 * Clean a raw signature string into the final output format.
 * Removes `async`, `public`, and everything after the return type annotation.
 */
function cleanSignature(raw: string): string | null {
	let sig = raw;

	// Find the method body's opening brace and remove everything from it onward
	const bracePos = findMethodBodyBrace(sig);
	if (bracePos !== -1) {
		sig = sig.substring(0, bracePos).trim();
	}

	// Remove trailing semicolons
	sig = sig.replace(/;$/, '').trim();

	// Remove `async` keyword (it is implicit in Promise<> return types)
	sig = sig.replace(/^async\s+/, '');

	// Remove `public` access modifier
	sig = sig.replace(/^public\s+/, '');

	// Remove leading `async` after removing `public`
	sig = sig.replace(/^async\s+/, '');

	// Remove inline comments that may have been collected in multi-line signatures.
	// These appear as `// comment text` followed by the next line's content.
	// We match `//` followed by text that does NOT contain type-annotation chars
	// until we hit a known continuation pattern (identifier followed by `?:` or `:` or `}`).
	sig = sig.replace(/\/\/[^;{}()]*?(?=\s*\w+[\?:]|\s*[})])/g, '');

	// Collapse multiple spaces
	sig = sig.replace(/\s+/g, ' ');

	if (!sig) {
		return null;
	}

	return sig;
}

// ---------------------------------------------------------------------------
// 4. Detect getter sub-objects in a POM class
// ---------------------------------------------------------------------------

/**
 * Find getters that return sub-object types (other classes defined in the same
 * file or imported classes).
 */
function findGetterSubObjects(source: string, filePath: string, targetClassName?: string): SubObject[] {
	const subObjects: SubObject[] = [];
	const lines = source.split('\n');

	// Scan through the target class at depth 1 only, same approach as extractMethods
	let inClass = false;
	let depth = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!inClass) {
			const classMatch = targetClassName
				? line.match(new RegExp(`^export\\s+class\\s+${targetClassName}\\b`))
				: line.match(/^export\s+class\s+\w+/);
			if (classMatch) {
				inClass = true;
				depth = braceBalance(line);
				continue;
			}
		} else {
			const depthBeforeLine = depth;
			depth += braceBalance(line);
			if (depth <= 0) {
				break;
			}
			if (depthBeforeLine !== 1) {
				continue;
			}

			const trimmed = line.trim();

			// Skip private/protected getters
			if (trimmed.startsWith('private ') || trimmed.startsWith('protected ')) {
				continue;
			}

			const getterMatch = trimmed.match(/^(?:public\s+)?get\s+(\w+)\(\)\s*:\s*(\w+)\s*\{/);
			if (!getterMatch) {
				continue;
			}

			const getterName = getterMatch[1];
			const returnType = getterMatch[2];

			// Skip simple value getters (returning primitives or Locator)
			if (['string', 'number', 'boolean', 'Locator', 'Page', 'void'].includes(returnType)) {
				continue;
			}

			// Check if this type is a class defined in the same file
			const classDefRegex = new RegExp(`^(?:export\\s+)?class\\s+${returnType}\\b`);
			const isLocalClass = lines.some(l => classDefRegex.test(l.trim()));

			if (isLocalClass) {
				// Extract methods from the local class
				const localMethods = extractMethods(source, returnType);
				if (localMethods.length > 0) {
					subObjects.push({
						getterName,
						typeName: returnType,
						filePath,
						methods: localMethods,
					});
				}
			} else {
				// Check imports in this file for the type
				const localImports = new Map<string, string>();
				for (const match of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
					const types = match[1].split(',').map(t => t.trim());
					const importPath = match[2];
					for (const type of types) {
						localImports.set(type, importPath);
					}
				}

				const importPath = localImports.get(returnType);
				if (importPath) {
					const resolvedPath = resolveImportPath(importPath, path.dirname(filePath));
					if (resolvedPath) {
						const subSource = fs.readFileSync(resolvedPath, 'utf-8');
						const subMethods = extractMethods(subSource, returnType);
						if (subMethods.length > 0) {
							subObjects.push({
								getterName,
								typeName: returnType,
								filePath: resolvedPath,
								methods: subMethods,
							});
						}
					}
				}
			}
		}
	}

	return subObjects;
}

// ---------------------------------------------------------------------------
// 5. JSDoc helpers
// ---------------------------------------------------------------------------

/**
 * Extract a one-line description from a JSDoc block.
 * Takes the first meaningful line, stripping Action:/Verify: prefixes for the reference.
 */
function extractJsdocSummary(jsdoc: string): string | null {
	const lines = jsdoc.split('\n');
	for (const line of lines) {
		const cleaned = line
			.replace(/^\/\*\*\s*/, '')  // opening /**
			.replace(/\*\/\s*$/, '')     // closing */
			.replace(/^\*\s?/, '')       // continuation *
			.trim();

		// Skip empty lines, @param, @see, @example, @returns tags
		if (!cleaned || cleaned.startsWith('@')) {
			continue;
		}

		// Strip Action:/Verify: prefix for the reference
		return cleaned.replace(/^(?:Action|Verify):\s*/i, '');
	}
	return null;
}

/**
 * Extract @see references from a JSDoc block.
 */
function extractJsdocSeeAlso(jsdoc: string): string[] {
	const sees: string[] = [];
	for (const line of jsdoc.split('\n')) {
		const cleaned = line.replace(/^\s*\*?\s*/, '').trim();
		const seeMatch = cleaned.match(/^@see\s+(\S+.*)/);
		if (seeMatch) {
			sees.push(seeMatch[1]);
		}
	}
	return sees;
}

/**
 * Format a method entry for the markdown reference, including JSDoc summary and @see links.
 */
function formatMethodLine(method: MethodSignature): string {
	let line = `- ${method.signature}`;
	if (method.jsdoc) {
		const summary = extractJsdocSummary(method.jsdoc);
		const sees = extractJsdocSeeAlso(method.jsdoc);
		if (summary) {
			line += ` -- ${summary}`;
		}
		if (sees.length > 0) {
			line += ` (See also: ${sees.join(', ')})`;
		}
	}
	return line;
}

// ---------------------------------------------------------------------------
// 6. Generate the reference for all POMs
// ---------------------------------------------------------------------------

interface PomSection {
	propName: string;
	typeName: string;
	filePath: string;
	relativePath: string;
	methods: MethodSignature[];
	subObjects: SubObject[];
}

function generateReference(): void {
	const sections: PomSection[] = [];
	const infraDir = path.join(E2E_ROOT, 'infra');

	for (const [propName, typeName] of workbenchProps) {
		const importPath = importMap.get(typeName);
		if (!importPath) {
			console.warn(`  [skip] No import found for type: ${typeName} (property: ${propName})`);
			continue;
		}

		const resolvedPath = resolveImportPath(importPath, infraDir);
		if (!resolvedPath) {
			console.warn(`  [skip] Cannot resolve file for: ${typeName} (import: ${importPath})`);
			continue;
		}

		const source = fs.readFileSync(resolvedPath, 'utf-8');
		const methods = extractMethods(source, typeName);
		const subObjects = findGetterSubObjects(source, resolvedPath, typeName);
		const relativePath = path.relative(E2E_ROOT, resolvedPath);

		sections.push({
			propName,
			typeName,
			filePath: resolvedPath,
			relativePath,
			methods,
			subObjects,
		});
	}

	// Sort sections alphabetically by property name
	sections.sort((a, b) => a.propName.localeCompare(b.propName));

	// Count total POMs (main + sub-objects)
	let totalPoms = sections.length;
	for (const section of sections) {
		totalPoms += section.subObjects.length;
	}

	// Build the markdown
	const lines: string[] = [];
	const today = new Date().toISOString().split('T')[0];

	lines.push('# POM Reference');
	lines.push('');
	lines.push('Auto-generated from POM source files. Do not edit manually.');
	lines.push(`Generated: ${today}`);
	lines.push('');
	lines.push(`Total POMs: ${totalPoms}`);
	lines.push('');
	lines.push('---');

	for (const section of sections) {
		lines.push('');
		lines.push(`## ${section.propName} (${section.relativePath})`);

		if (section.methods.length === 0) {
			lines.push('- (no public methods found)');
		} else {
			for (const method of section.methods) {
				lines.push(formatMethodLine(method));
			}
		}

		// Sub-objects
		for (const sub of section.subObjects) {
			const subRelativePath = path.relative(E2E_ROOT, sub.filePath);
			lines.push('');
			lines.push(`### ${section.propName}.${sub.getterName} (${subRelativePath})`);

			if (sub.methods.length === 0) {
				lines.push('- (no public methods found)');
			} else {
				for (const method of sub.methods) {
					lines.push(formatMethodLine(method));
				}
			}
		}
	}

	lines.push('');

	// Write single-file output (backward compat)
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });
	fs.writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf-8');

	// Write per-POM files for targeted reads
	const pomRefDir = path.join(OUTPUT_DIR, 'pom-ref');
	fs.mkdirSync(pomRefDir, { recursive: true });

	// Clean old per-POM files
	for (const existing of fs.readdirSync(pomRefDir)) {
		if (existing.endsWith('.md')) {
			fs.unlinkSync(path.join(pomRefDir, existing));
		}
	}

	for (const section of sections) {
		const pomLines: string[] = [];
		pomLines.push(`## ${section.propName} (${section.relativePath})`);

		if (section.methods.length === 0) {
			pomLines.push('- (no public methods found)');
		} else {
			for (const method of section.methods) {
				pomLines.push(formatMethodLine(method));
			}
		}

		for (const sub of section.subObjects) {
			const subRelativePath = path.relative(E2E_ROOT, sub.filePath);
			pomLines.push('');
			pomLines.push(`### ${section.propName}.${sub.getterName} (${subRelativePath})`);
			if (sub.methods.length === 0) {
				pomLines.push('- (no public methods found)');
			} else {
				for (const method of sub.methods) {
					pomLines.push(formatMethodLine(method));
				}
			}
		}

		pomLines.push('');
		fs.writeFileSync(path.join(pomRefDir, `${section.propName}.md`), pomLines.join('\n'), 'utf-8');
	}

	// Report
	console.log(`\nPOM Reference Generator`);
	console.log(`-----------------------`);
	console.log(`POMs documented: ${sections.length}`);
	console.log(`Sub-objects found: ${sections.reduce((acc, s) => acc + s.subObjects.length, 0)}`);
	console.log(`Total POMs (including sub-objects): ${totalPoms}`);
	console.log(`Total methods: ${sections.reduce((acc, s) => acc + s.methods.length + s.subObjects.reduce((a, sub) => a + sub.methods.length, 0), 0)}`);
	console.log(`Output: ${OUTPUT_PATH}`);
	console.log(`Per-POM files: ${pomRefDir}/ (${sections.length} files)`);
}

generateReference();
