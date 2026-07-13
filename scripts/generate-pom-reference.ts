/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * POM Reference Generator
 *
 * Parses Positron's e2e Page Object Model (POM) source with the TypeScript compiler API
 * (not regex) and generates one markdown file per `app.workbench.*` POM, with real method
 * signatures, leading JSDoc summaries, and whether each method already wraps its body in
 * `test.step(...)` -- the answer authors need before deciding whether to add an outer
 * `test.step` wrapper (see common-mistakes.md #16).
 *
 * Entry point: `test/e2e/infra/workbench.ts`'s `Workbench` class. Every `readonly propName:
 * TypeName` field is resolved to its source file via that file's own imports, then parsed the
 * same way. Getter accessors returning another local/imported class (e.g. `dataExplorer.grid`)
 * are treated as sub-objects and nested under the parent POM's file.
 *
 * Run via: npm run e2e-gen-pom-reference
 */

import * as ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';

const E2E_ROOT = resolve(__dirname, '../test/e2e');
const WORKBENCH_PATH = join(E2E_ROOT, 'infra/workbench.ts');
const OUTPUT_DIR = resolve(__dirname, '../.claude/skills/author-e2e-tests/references/generated');

const PRIMITIVE_RETURN_TYPES = new Set(['string', 'number', 'boolean', 'void', 'Locator', 'Page', 'Promise']);

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const sourceFileCache = new Map<string, ts.SourceFile>();

function parseFile(filePath: string): ts.SourceFile {
	const cached = sourceFileCache.get(filePath);
	if (cached) {
		return cached;
	}
	const text = readFileSync(filePath, 'utf-8');
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
	sourceFileCache.set(filePath, sourceFile);
	return sourceFile;
}

/** Resolve a relative import specifier (often ending in `.js` under NodeNext) to a real `.ts` file. */
function resolveImport(fromFile: string, specifier: string): string | null {
	if (!specifier.startsWith('.')) {
		return null;
	}
	let resolved = resolve(dirname(fromFile), specifier);
	if (resolved.endsWith('.js')) {
		resolved = resolved.slice(0, -3) + '.ts';
	} else if (!resolved.endsWith('.ts')) {
		resolved += '.ts';
	}
	return existsSync(resolved) ? resolved : null;
}

type ImportMap = Map<string, string>; // imported name -> resolved file path

function collectImports(sourceFile: ts.SourceFile): ImportMap {
	const map: ImportMap = new Map();
	for (const stmt of sourceFile.statements) {
		if (!ts.isImportDeclaration(stmt) || !stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) {
			continue;
		}
		const resolved = resolveImport(sourceFile.fileName, stmt.moduleSpecifier.text);
		if (!resolved) {
			continue;
		}
		const namedBindings = stmt.importClause?.namedBindings;
		if (namedBindings && ts.isNamedImports(namedBindings)) {
			for (const el of namedBindings.elements) {
				map.set(el.name.text, resolved);
			}
		}
	}
	return map;
}

function findClass(sourceFile: ts.SourceFile, className?: string): ts.ClassDeclaration | undefined {
	for (const stmt of sourceFile.statements) {
		if (ts.isClassDeclaration(stmt) && stmt.name && (!className || stmt.name.text === className)) {
			return stmt;
		}
	}
	return undefined;
}

function hasModifier(node: ts.HasModifiers, kind: ts.SyntaxKind): boolean {
	return ts.getModifiers(node)?.some(m => m.kind === kind) ?? false;
}

function isPrivateMember(member: ts.ClassElement): boolean {
	if (ts.canHaveModifiers(member) && (hasModifier(member, ts.SyntaxKind.PrivateKeyword) || hasModifier(member, ts.SyntaxKind.ProtectedKeyword))) {
		return true;
	}
	const name = member.name && ts.isIdentifier(member.name) ? member.name.text : '';
	return name.startsWith('_');
}

/** First non-tag line of the JSDoc comment immediately preceding `node`, if any. */
function getLeadingJsDocSummary(sourceFile: ts.SourceFile, node: ts.Node): string | null {
	const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart());
	if (!ranges) {
		return null;
	}
	const jsdocRange = [...ranges].reverse().find(r => sourceFile.text.slice(r.pos, r.pos + 3) === '/**');
	if (!jsdocRange) {
		return null;
	}
	const raw = sourceFile.text.slice(jsdocRange.pos, jsdocRange.end);
	for (const line of raw.split('\n')) {
		const cleaned = line.replace(/^\/\*\*/, '').replace(/\*\/$/, '').replace(/^\s*\*\s?/, '').trim();
		if (!cleaned || cleaned.startsWith('@')) {
			continue;
		}
		return cleaned.replace(/^(Action|Verify):\s*/i, '');
	}
	return null;
}

function bodyContainsTestStep(body: ts.Block | undefined, sourceFile: ts.SourceFile): boolean {
	if (!body) {
		return false;
	}
	const bodyText = sourceFile.text.slice(body.getStart(sourceFile), body.getEnd());
	return /\btest\s*\.\s*step\s*\(/.test(bodyText);
}

function buildSignature(method: ts.MethodDeclaration, sourceFile: ts.SourceFile): string {
	const name = method.name.getText(sourceFile);
	const typeParams = method.typeParameters?.length
		? `<${method.typeParameters.map(tp => tp.getText(sourceFile)).join(', ')}>`
		: '';
	const params = method.parameters.map(p => p.getText(sourceFile).replace(/\s+/g, ' ')).join(', ');
	const returnType = method.type ? `: ${method.type.getText(sourceFile).replace(/\s+/g, ' ')}` : '';
	const isAsync = hasModifier(method, ts.SyntaxKind.AsyncKeyword);
	return `${isAsync ? 'async ' : ''}${name}${typeParams}(${params})${returnType}`;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface MethodInfo {
	name: string;
	signature: string;
	summary: string | null;
	wrapsInTestStep: boolean;
}

interface SubObjectInfo {
	getterName: string;
	typeName: string;
	relPath: string;
	methods: MethodInfo[];
}

function extractMethods(classDecl: ts.ClassDeclaration, sourceFile: ts.SourceFile): MethodInfo[] {
	const methods: MethodInfo[] = [];
	for (const member of classDecl.members) {
		if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) {
			continue;
		}
		if (isPrivateMember(member)) {
			continue;
		}
		methods.push({
			name: member.name.text,
			signature: buildSignature(member, sourceFile),
			summary: getLeadingJsDocSummary(sourceFile, member),
			wrapsInTestStep: bodyContainsTestStep(member.body, sourceFile),
		});
	}
	return methods;
}

function extractSubObjects(classDecl: ts.ClassDeclaration, sourceFile: ts.SourceFile, importMap: ImportMap): SubObjectInfo[] {
	const subs: SubObjectInfo[] = [];
	for (const member of classDecl.members) {
		if (!ts.isGetAccessorDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) {
			continue;
		}
		if (isPrivateMember(member)) {
			continue;
		}
		if (!member.type || !ts.isTypeReferenceNode(member.type)) {
			continue;
		}
		const typeName = member.type.typeName.getText(sourceFile);
		if (PRIMITIVE_RETURN_TYPES.has(typeName)) {
			continue;
		}

		let targetSourceFile = sourceFile;
		let targetFile = sourceFile.fileName;
		let targetClass = findClass(sourceFile, typeName);
		if (!targetClass) {
			const resolved = importMap.get(typeName);
			if (!resolved) {
				continue;
			}
			targetFile = resolved;
			targetSourceFile = parseFile(resolved);
			targetClass = findClass(targetSourceFile, typeName);
			if (!targetClass) {
				continue;
			}
		}

		const methods = extractMethods(targetClass, targetSourceFile);
		if (methods.length === 0) {
			continue;
		}
		subs.push({ getterName: member.name.text, typeName, relPath: relative(E2E_ROOT, targetFile), methods });
	}
	return subs;
}

interface PomEntry {
	propName: string;
	typeName: string;
	relPath: string;
	methods: MethodInfo[];
	subObjects: SubObjectInfo[];
}

function discoverWorkbenchProps(): { propName: string; typeName: string }[] {
	const sourceFile = parseFile(WORKBENCH_PATH);
	const classDecl = findClass(sourceFile, 'Workbench');
	if (!classDecl) {
		throw new Error(`Could not find "export class Workbench" in ${WORKBENCH_PATH}`);
	}
	const props: { propName: string; typeName: string }[] = [];
	for (const member of classDecl.members) {
		if (!ts.isPropertyDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) {
			continue;
		}
		if (!hasModifier(member, ts.SyntaxKind.ReadonlyKeyword)) {
			continue;
		}
		if (!member.type || !ts.isTypeReferenceNode(member.type)) {
			continue;
		}
		props.push({ propName: member.name.text, typeName: member.type.typeName.getText(sourceFile) });
	}
	return props;
}

function buildPomEntries(): PomEntry[] {
	const workbenchSourceFile = parseFile(WORKBENCH_PATH);
	const workbenchImports = collectImports(workbenchSourceFile);
	const entries: PomEntry[] = [];

	for (const { propName, typeName } of discoverWorkbenchProps()) {
		const resolvedFile = workbenchImports.get(typeName);
		if (!resolvedFile) {
			console.warn(`  [skip] No import found for type ${typeName} (property: ${propName})`);
			continue;
		}
		const sourceFile = parseFile(resolvedFile);
		const classDecl = findClass(sourceFile, typeName);
		if (!classDecl) {
			console.warn(`  [skip] Could not find class ${typeName} in ${resolvedFile}`);
			continue;
		}
		const importMap = collectImports(sourceFile);
		entries.push({
			propName,
			typeName,
			relPath: relative(E2E_ROOT, resolvedFile),
			methods: extractMethods(classDecl, sourceFile),
			subObjects: extractSubObjects(classDecl, sourceFile, importMap),
		});
	}

	entries.sort((a, b) => a.propName.localeCompare(b.propName));
	return entries;
}

// ---------------------------------------------------------------------------
// Markdown output
// ---------------------------------------------------------------------------

function formatMethodLine(m: MethodInfo): string {
	const summary = m.summary ? ` -- ${m.summary}` : '';
	const wraps = m.wrapsInTestStep ? 'yes' : 'no';
	return `- \`${m.signature}\`${summary} (wraps in test.step: ${wraps})`;
}

function renderPomFile(entry: PomEntry): string {
	const lines: string[] = [];
	lines.push(`# app.workbench.${entry.propName}`);
	lines.push('');
	lines.push(`Auto-generated by \`scripts/generate-pom-reference.ts\` from \`test/e2e/${entry.relPath}\`. Do not hand-edit -- run \`npm run e2e-gen-pom-reference\` to refresh.`);
	lines.push('');

	if (entry.methods.length === 0) {
		lines.push('(no public methods found)');
	} else {
		for (const method of entry.methods) {
			lines.push(formatMethodLine(method));
		}
	}

	for (const sub of entry.subObjects) {
		lines.push('');
		lines.push(`## ${entry.propName}.${sub.getterName} (\`test/e2e/${sub.relPath}\`)`);
		lines.push('');
		for (const method of sub.methods) {
			lines.push(formatMethodLine(method));
		}
	}

	lines.push('');
	return lines.join('\n');
}

function renderIndex(entries: PomEntry[]): string {
	const lines: string[] = [];
	lines.push('# POM Reference Index');
	lines.push('');
	lines.push(`Auto-generated by \`scripts/generate-pom-reference.ts\`. Do not hand-edit -- run \`npm run e2e-gen-pom-reference\` to refresh.`);
	lines.push('');
	lines.push('Staleness check: if any file under `test/e2e/pages/` is newer than these files, regenerate first:');
	lines.push('');
	lines.push('```bash');
	lines.push('npm run e2e-gen-pom-reference');
	lines.push('```');
	lines.push('');
	lines.push('One file per `app.workbench.*` property. Read only the ones you need.');
	lines.push('');
	for (const entry of entries) {
		const subCount = entry.subObjects.length ? ` (+ ${entry.subObjects.map(s => entry.propName + '.' + s.getterName).join(', ')})` : '';
		lines.push(`- [\`${entry.propName}\`](./${entry.propName}.md)${subCount}`);
	}
	lines.push('');
	return lines.join('\n');
}

function main(): void {
	console.log('Generating POM reference...\n');

	const entries = buildPomEntries();

	mkdirSync(OUTPUT_DIR, { recursive: true });
	for (const existing of readdirSync(OUTPUT_DIR)) {
		if (existing.endsWith('.md')) {
			unlinkSync(join(OUTPUT_DIR, existing));
		}
	}

	for (const entry of entries) {
		writeFileSync(join(OUTPUT_DIR, `${entry.propName}.md`), renderPomFile(entry), 'utf-8');
	}
	writeFileSync(join(OUTPUT_DIR, 'index.md'), renderIndex(entries), 'utf-8');

	const totalMethods = entries.reduce((acc, e) => acc + e.methods.length + e.subObjects.reduce((a, s) => a + s.methods.length, 0), 0);
	const totalSubObjects = entries.reduce((acc, e) => acc + e.subObjects.length, 0);
	console.log(`POMs documented: ${entries.length}`);
	console.log(`Sub-objects found: ${totalSubObjects}`);
	console.log(`Total methods: ${totalMethods}`);
	console.log(`Output: ${OUTPUT_DIR}`);
}

main();
