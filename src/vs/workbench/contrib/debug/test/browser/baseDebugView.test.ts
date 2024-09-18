/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as dom from 'vs/base/browser/dom';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { isWindows } from 'vs/base/common/platform';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { NullCommandService } from 'vs/platform/commands/test/common/nullCommandService';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { NullHoverService } from 'vs/platform/hover/test/browser/nullHoverService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { renderExpressionValue, renderVariable, renderViewTree } from 'vs/workbench/contrib/debug/browser/baseDebugView';
import { LinkDetector } from 'vs/workbench/contrib/debug/browser/linkDetector';
import { isStatusbarInDebugMode } from 'vs/workbench/contrib/debug/browser/statusbarColorProvider';
import { State } from 'vs/workbench/contrib/debug/common/debug';
import { Expression, Scope, StackFrame, Thread, Variable } from 'vs/workbench/contrib/debug/common/debugModel';
import { createTestSession } from 'vs/workbench/contrib/debug/test/browser/callStack.test';
import { createMockDebugModel } from 'vs/workbench/contrib/debug/test/browser/mockDebugModel';
import { MockSession } from 'vs/workbench/contrib/debug/test/common/mockDebug';
import { workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
const $ = dom.$;

function assertVariable(session: MockSession, scope: Scope, disposables: Pick<DisposableStore, "add">, linkDetector: LinkDetector, displayType: boolean) {
	let variable = new Variable(session, 1, scope, 2, 'foo', 'bar.foo', undefined, 0, 0, undefined, {}, 'string');
	let expression = $('.');
	let name = $('.');
	let type = $('.');
	let value = $('.');
	const label = new HighlightedLabel(name);
	const lazyButton = $('.');
	const store = disposables.add(new DisposableStore());
	renderVariable(store, NullCommandService, NullHoverService, variable, { expression, name, type, value, label, lazyButton }, false, [], undefined, displayType);

	assert.strictEqual(label.element.textContent, 'foo');
	assert.strictEqual(value.textContent, '');

	variable.value = 'hey';
	expression = $('.');
	name = $('.');
	type = $('.');
	value = $('.');
	renderVariable(store, NullCommandService, NullHoverService, variable, { expression, name, type, value, label, lazyButton }, false, [], linkDetector, displayType);
	assert.strictEqual(value.textContent, 'hey');
	assert.strictEqual(label.element.textContent, displayType ? 'foo: ' : 'foo =');
	assert.strictEqual(type.textContent, displayType ? 'string =' : '');

	variable.value = isWindows ? 'C:\\foo.js:5' : '/foo.js:5';
	expression = $('.');
	name = $('.');
	type = $('.');
	value = $('.');
	renderVariable(store, NullCommandService, NullHoverService, variable, { expression, name, type, value, label, lazyButton }, false, [], linkDetector, displayType);
	assert.ok(value.querySelector('a'));
	assert.strictEqual(value.querySelector('a')!.textContent, variable.value);

	variable = new Variable(session, 1, scope, 2, 'console', 'console', '5', 0, 0, undefined, { kind: 'virtual' });
	expression = $('.');
	name = $('.');
	type = $('.');
	value = $('.');
	renderVariable(store, NullCommandService, NullHoverService, variable, { expression, name, type, value, label, lazyButton }, false, [], linkDetector, displayType);
	assert.strictEqual(name.className, 'virtual');
	assert.strictEqual(label.element.textContent, 'console =');
	assert.strictEqual(value.className, 'value number');

	variable = new Variable(session, 1, scope, 2, 'xpto', 'xpto.xpto', undefined, 0, 0, undefined, {}, 'custom-type');
	renderVariable(store, NullCommandService, NullHoverService, variable, { expression, name, type, value, label, lazyButton }, false, [], linkDetector, displayType);
	assert.strictEqual(label.element.textContent, 'xpto');
	assert.strictEqual(value.textContent, '');
	variable.value = '2';
	expression = $('.');
	name = $('.');
	type = $('.');
	value = $('.');
	renderVariable(store, NullCommandService, NullHoverService, variable, { expression, name, type, value, label, lazyButton }, false, [], linkDetector, displayType);
	assert.strictEqual(value.textContent, '2');
	assert.strictEqual(label.element.textContent, displayType ? 'xpto: ' : 'xpto =');
	assert.strictEqual(type.textContent, displayType ? 'custom-type =' : '');

	label.dispose();
}

suite('Debug - Base Debug View', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let linkDetector: LinkDetector;

	/**
	 * Instantiate services for use by the functions being tested.
	 */
	setup(() => {
		const instantiationService: TestInstantiationService = workbenchInstantiationService(undefined, disposables);
		linkDetector = instantiationService.createInstance(LinkDetector);
		instantiationService.stub(IHoverService, NullHoverService);
	});

	test('render view tree', () => {
		const container = $('.container');
		const treeContainer = renderViewTree(container);

		assert.strictEqual(treeContainer.className, 'debug-view-content');
		assert.strictEqual(container.childElementCount, 1);
		assert.strictEqual(container.firstChild, treeContainer);
		assert.strictEqual(dom.isHTMLDivElement(treeContainer), true);
	});

	test('render expression value', () => {
		let container = $('.container');
		renderExpressionValue('render \n me', container, {}, NullHoverService);
		assert.strictEqual(container.className, 'value');
		assert.strictEqual(container.textContent, 'render \n me');

		const expression = new Expression('console');
		expression.value = 'Object';
		container = $('.container');
		renderExpressionValue(expression, container, { colorize: true }, NullHoverService);
		assert.strictEqual(container.className, 'value unavailable error');

		expression.available = true;
		expression.value = '"string value"';
		container = $('.container');
		renderExpressionValue(expression, container, { colorize: true, linkDetector }, NullHoverService);
		assert.strictEqual(container.className, 'value string');
		assert.strictEqual(container.textContent, '"string value"');

		expression.type = 'boolean';
		container = $('.container');
		renderExpressionValue(expression, container, { colorize: true }, NullHoverService);
		assert.strictEqual(container.className, 'value boolean');
		assert.strictEqual(container.textContent, expression.value);

		expression.value = 'this is a long string';
		container = $('.container');
		renderExpressionValue(expression, container, { colorize: true, maxValueLength: 4, linkDetector }, NullHoverService);
		assert.strictEqual(container.textContent, 'this...');

		expression.value = isWindows ? 'C:\\foo.js:5' : '/foo.js:5';
		container = $('.container');
		renderExpressionValue(expression, container, { colorize: true, linkDetector }, NullHoverService);
		assert.ok(container.querySelector('a'));
		assert.strictEqual(container.querySelector('a')!.textContent, expression.value);
	});

	test('render variable', () => {
		const session = new MockSession();
		const thread = new Thread(session, 'mockthread', 1);
		const range = {
			startLineNumber: 1,
			startColumn: 1,
			endLineNumber: undefined!,
			endColumn: undefined!
		};
		const stackFrame = new StackFrame(thread, 1, null!, 'app.js', 'normal', range, 0, true);
		const scope = new Scope(stackFrame, 1, 'local', 1, false, 10, 10);

		assertVariable(session, scope, disposables, linkDetector, false);

	});

	test('render variable with display type setting', () => {
		const session = new MockSession();
		const thread = new Thread(session, 'mockthread', 1);
		const range = {
			startLineNumber: 1,
			startColumn: 1,
			endLineNumber: undefined!,
			endColumn: undefined!
		};
		const stackFrame = new StackFrame(thread, 1, null!, 'app.js', 'normal', range, 0, true);
		const scope = new Scope(stackFrame, 1, 'local', 1, false, 10, 10);

		assertVariable(session, scope, disposables, linkDetector, true);
	});

	test('statusbar in debug mode', () => {
		const model = createMockDebugModel(disposables);
		const session = disposables.add(createTestSession(model));
		const session2 = disposables.add(createTestSession(model, undefined, { suppressDebugStatusbar: true }));
		assert.strictEqual(isStatusbarInDebugMode(State.Inactive, []), false);
		assert.strictEqual(isStatusbarInDebugMode(State.Initializing, [session]), false);
		assert.strictEqual(isStatusbarInDebugMode(State.Running, [session]), true);
		assert.strictEqual(isStatusbarInDebugMode(State.Stopped, [session]), true);

		assert.strictEqual(isStatusbarInDebugMode(State.Running, [session2]), false);
		assert.strictEqual(isStatusbarInDebugMode(State.Running, [session, session2]), true);

		session.configuration.noDebug = true;
		assert.strictEqual(isStatusbarInDebugMode(State.Running, [session]), false);
		assert.strictEqual(isStatusbarInDebugMode(State.Running, [session, session2]), false);
	});
});
