/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Self-containment of the functions that leave Node. inPage sends a page
// function to playwright-cli as source text (fn.toString()), so it may use only
// its own parameters (page, args, lib) and globals; a module import or constant
// it names is a ReferenceError at run time, found only by running that command.
// Functions passed to page.evaluate() and friends go one step further, into the
// browser, so they may not use even the page function's variables.
//
// Rule 1: a function whose contextual type is PageFn, and makeLib, names nothing
//         declared in a script outside itself.
// Rule 2: a function literal passed to evaluate, evaluateAll, evaluateHandle or
//         waitForFunction names nothing declared outside itself.

import ts from 'typescript';

const browserCalls = new Set(['evaluate', 'evaluateAll', 'evaluateHandle', 'waitForFunction']);

/** One "file:line: ..." line per free identifier; extra is a planted file, for the self-test. */
export function pageFnProblems(files: string[], extra?: { name: string; text: string }): { problems: string[]; checked: number } {
	const host = ts.createCompilerHost({});
	if (extra) {
		const read = host.readFile;
		const getSource = host.getSourceFile;
		host.fileExists = f => f === extra.name || ts.sys.fileExists(f);
		host.readFile = f => f === extra.name ? extra.text : read(f);
		host.getSourceFile = (f, v, ...rest) => f === extra.name ? ts.createSourceFile(f, extra.text, v) : getSource(f, v, ...rest);
	}
	const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, allowImportingTsExtensions: true, noEmit: true, strict: true, skipLibCheck: true, types: ['node'], lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'] };
	const program = ts.createProgram(extra ? [...files, extra.name] : files, options, host);
	const checker = program.getTypeChecker();
	const ours = (sf: ts.SourceFile) => !sf.isDeclarationFile && !sf.fileName.includes('/node_modules/');
	const problems: string[] = [];
	let checked = 0;

	// Identifiers in value positions inside fn whose declaration is in one of our files but outside fn.
	const freeNames = (fn: ts.Node) => {
		const out: { id: ts.Identifier; decl: ts.Node }[] = [];
		const visit = (n: ts.Node): void => {
			if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) { return; }
			if (ts.isIdentifier(n) && isValueUse(n)) {
				const sym = ts.isShorthandPropertyAssignment(n.parent) ? checker.getShorthandAssignmentValueSymbol(n.parent) : checker.getSymbolAtLocation(n);
				const decl = sym?.declarations?.find(d => ours(d.getSourceFile()));
				if (decl && !(decl.getSourceFile() === fn.getSourceFile() && decl.pos >= fn.pos && decl.end <= fn.end)) { out.push({ id: n, decl }); }
			}
			ts.forEachChild(n, visit);
		};
		ts.forEachChild(fn, visit);
		return out;
	};
	const report = (fn: ts.Node, rule: string) => {
		checked++;
		for (const { id, decl } of freeNames(fn)) {
			const sf = id.getSourceFile();
			const at = (n: ts.Node) => n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1;
			const where = decl.getSourceFile() === sf ? `line ${at(decl)}` : `${short(decl.getSourceFile().fileName)}:${at(decl)}`;
			problems.push(`${short(sf.fileName)}:${at(id)}: ${rule} uses "${id.text}", declared outside it (${where})`);
		}
	};

	for (const sf of program.getSourceFiles().filter(ours)) {
		const visit = (n: ts.Node): void => {
			if (ts.isFunctionDeclaration(n) && n.name?.text === 'makeLib') { report(n, 'makeLib'); }
			if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
				if (checker.getContextualType(n)?.aliasSymbol?.name === 'PageFn') { report(n, 'a page function'); }
				const call = n.parent;
				if (ts.isCallExpression(call) && call.arguments[0] === n && ts.isPropertyAccessExpression(call.expression) && browserCalls.has(call.expression.name.text)) {
					report(n, `a function passed to ${call.expression.name.text}()`);
				}
			}
			ts.forEachChild(n, visit);
		};
		visit(sf);
	}
	return { problems, checked };
}

/** False for names that are not variable references: a.NAME, { NAME: x }, labels, declarations' own names. */
function isValueUse(id: ts.Identifier): boolean {
	const p = id.parent;
	if (ts.isPropertyAccessExpression(p) && p.name === id) { return false; }
	if (ts.isQualifiedName(p) && p.right === id) { return false; }
	if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === id) { return false; }
	if (ts.isBindingElement(p) && p.propertyName === id) { return false; }
	if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) { return false; }
	return true;
}

function short(file: string): string {
	return file.replace(/^.*\/drive-positron\//, '');
}
