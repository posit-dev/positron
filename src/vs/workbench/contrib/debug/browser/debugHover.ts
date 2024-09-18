/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IMouseEvent } from 'vs/base/browser/mouseEvent';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { AsyncDataTree } from 'vs/base/browser/ui/tree/asyncDataTree';
import { ITreeContextMenuEvent } from 'vs/base/browser/ui/tree/tree';
import { coalesce } from 'vs/base/common/arrays';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { KeyCode } from 'vs/base/common/keyCodes';
import * as lifecycle from 'vs/base/common/lifecycle';
import { clamp } from 'vs/base/common/numbers';
import { isMacintosh } from 'vs/base/common/platform';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition } from 'vs/editor/browser/editorBrowser';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';
import { IDimension } from 'vs/editor/common/core/dimension';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import * as nls from 'vs/nls';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { WorkbenchAsyncDataTree } from 'vs/platform/list/browser/listService';
import { ILogService } from 'vs/platform/log/common/log';
import { asCssVariable, editorHoverBackground, editorHoverBorder, editorHoverForeground } from 'vs/platform/theme/common/colorRegistry';
import { AbstractExpressionDataSource, renderExpressionValue } from 'vs/workbench/contrib/debug/browser/baseDebugView';
import { LinkDetector } from 'vs/workbench/contrib/debug/browser/linkDetector';
import { VariablesRenderer, VisualizedVariableRenderer, openContextMenuForVariableTreeElement } from 'vs/workbench/contrib/debug/browser/variablesView';
import { IDebugService, IDebugSession, IExpression, IExpressionContainer, IStackFrame } from 'vs/workbench/contrib/debug/common/debug';
import { Expression, Variable, VisualizedExpression } from 'vs/workbench/contrib/debug/common/debugModel';
import { getEvaluatableExpressionAtPosition } from 'vs/workbench/contrib/debug/common/debugUtils';

const $ = dom.$;

export const enum ShowDebugHoverResult {
	NOT_CHANGED,
	NOT_AVAILABLE,
	CANCELLED,
}

async function doFindExpression(container: IExpressionContainer, namesToFind: string[]): Promise<IExpression | null> {
	if (!container) {
		return null;
	}

	const children = await container.getChildren();
	// look for our variable in the list. First find the parents of the hovered variable if there are any.
	const filtered = children.filter(v => namesToFind[0] === v.name);
	if (filtered.length !== 1) {
		return null;
	}

	if (namesToFind.length === 1) {
		return filtered[0];
	} else {
		return doFindExpression(filtered[0], namesToFind.slice(1));
	}
}

export async function findExpressionInStackFrame(stackFrame: IStackFrame, namesToFind: string[]): Promise<IExpression | undefined> {
	const scopes = await stackFrame.getScopes();
	const nonExpensive = scopes.filter(s => !s.expensive);
	const expressions = coalesce(await Promise.all(nonExpensive.map(scope => doFindExpression(scope, namesToFind))));

	// only show if all expressions found have the same value
	return expressions.length > 0 && expressions.every(e => e.value === expressions[0].value) ? expressions[0] : undefined;
}

export class DebugHoverWidget implements IContentWidget {

	static readonly ID = 'debug.hoverWidget';
	// editor.IContentWidget.allowEditorOverflow
	readonly allowEditorOverflow = true;

	private _isVisible: boolean;
	private safeTriangle?: dom.SafeTriangle;
	private showCancellationSource?: CancellationTokenSource;
	private domNode!: HTMLElement;
	private tree!: AsyncDataTree<IExpression, IExpression, any>;
	private showAtPosition: Position | null;
	private positionPreference: ContentWidgetPositionPreference[];
	private readonly highlightDecorations = this.editor.createDecorationsCollection();
	private complexValueContainer!: HTMLElement;
	private complexValueTitle!: HTMLElement;
	private valueContainer!: HTMLElement;
	private treeContainer!: HTMLElement;
	private toDispose: lifecycle.IDisposable[];
	private scrollbar!: DomScrollableElement;
	private debugHoverComputer: DebugHoverComputer;

	private expressionToRender: IExpression | undefined;
	private isUpdatingTree = false;

	public get isShowingComplexValue() {
		return this.complexValueContainer?.hidden === false;
	}

	constructor(
		private editor: ICodeEditor,
		@IDebugService private readonly debugService: IDebugService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		this.toDispose = [];

		this._isVisible = false;
		this.showAtPosition = null;
		this.positionPreference = [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW];
		this.debugHoverComputer = this.instantiationService.createInstance(DebugHoverComputer, this.editor);
	}

	private create(): void {
		this.domNode = $('.debug-hover-widget');
		this.complexValueContainer = dom.append(this.domNode, $('.complex-value'));
		this.complexValueTitle = dom.append(this.complexValueContainer, $('.title'));
		this.treeContainer = dom.append(this.complexValueContainer, $('.debug-hover-tree'));
		this.treeContainer.setAttribute('role', 'tree');
		const tip = dom.append(this.complexValueContainer, $('.tip'));
		tip.textContent = nls.localize({ key: 'quickTip', comment: ['"switch to editor language hover" means to show the programming language hover widget instead of the debug hover'] }, 'Hold {0} key to switch to editor language hover', isMacintosh ? 'Option' : 'Alt');
		const dataSource = this.instantiationService.createInstance(DebugHoverDataSource);
		const linkeDetector = this.instantiationService.createInstance(LinkDetector);
		this.tree = <WorkbenchAsyncDataTree<IExpression, IExpression, any>>this.instantiationService.createInstance(WorkbenchAsyncDataTree, 'DebugHover', this.treeContainer, new DebugHoverDelegate(), [
			this.instantiationService.createInstance(VariablesRenderer, linkeDetector),
			this.instantiationService.createInstance(VisualizedVariableRenderer, linkeDetector),
		],
			dataSource, {
			accessibilityProvider: new DebugHoverAccessibilityProvider(),
			mouseSupport: false,
			horizontalScrolling: true,
			useShadows: false,
			keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: (e: IExpression) => e.name },
			overrideStyles: {
				listBackground: editorHoverBackground
			}
		});

		this.toDispose.push(VisualizedVariableRenderer.rendererOnVisualizationRange(this.debugService.getViewModel(), this.tree));

		this.valueContainer = $('.value');
		this.valueContainer.tabIndex = 0;
		this.valueContainer.setAttribute('role', 'tooltip');
		this.scrollbar = new DomScrollableElement(this.valueContainer, { horizontal: ScrollbarVisibility.Hidden });
		this.domNode.appendChild(this.scrollbar.getDomNode());
		this.toDispose.push(this.scrollbar);

		this.editor.applyFontInfo(this.domNode);
		this.domNode.style.backgroundColor = asCssVariable(editorHoverBackground);
		this.domNode.style.border = `1px solid ${asCssVariable(editorHoverBorder)}`;
		this.domNode.style.color = asCssVariable(editorHoverForeground);

		this.toDispose.push(this.tree.onContextMenu(async e => await this.onContextMenu(e)));

		this.toDispose.push(this.tree.onDidChangeContentHeight(() => {
			if (!this.isUpdatingTree) {
				// Don't do a layout in the middle of the async setInput
				this.layoutTreeAndContainer();
			}
		}));
		this.toDispose.push(this.tree.onDidChangeContentWidth(() => {
			if (!this.isUpdatingTree) {
				// Don't do a layout in the middle of the async setInput
				this.layoutTreeAndContainer();
			}
		}));

		this.registerListeners();
		this.editor.addContentWidget(this);
	}

	private async onContextMenu(e: ITreeContextMenuEvent<IExpression>): Promise<void> {
		const variable = e.element;
		if (!(variable instanceof Variable) || !variable.value) {
			return;
		}

		return openContextMenuForVariableTreeElement(this.contextKeyService, this.menuService, this.contextMenuService, MenuId.DebugHoverContext, e);
	}

	private registerListeners(): void {
		this.toDispose.push(dom.addStandardDisposableListener(this.domNode, 'keydown', (e: IKeyboardEvent) => {
			if (e.equals(KeyCode.Escape)) {
				this.hide();
			}
		}));
		this.toDispose.push(this.editor.onDidChangeConfiguration((e: ConfigurationChangedEvent) => {
			if (e.hasChanged(EditorOption.fontInfo)) {
				this.editor.applyFontInfo(this.domNode);
			}
		}));

		this.toDispose.push(this.debugService.getViewModel().onDidEvaluateLazyExpression(async e => {
			if (e instanceof Variable && this.tree.hasNode(e)) {
				await this.tree.updateChildren(e, false, true);
				await this.tree.expand(e);
			}
		}));
	}

	isHovered(): boolean {
		return !!this.domNode?.matches(':hover');
	}

	isVisible(): boolean {
		return this._isVisible;
	}

	willBeVisible(): boolean {
		return !!this.showCancellationSource;
	}

	getId(): string {
		return DebugHoverWidget.ID;
	}

	getDomNode(): HTMLElement {
		return this.domNode;
	}

	/**
	 * Gets whether the given coordinates are in the safe triangle formed from
	 * the position at which the hover was initiated.
	 */
	isInSafeTriangle(x: number, y: number) {
		return this._isVisible && !!this.safeTriangle?.contains(x, y);
	}

	async showAt(position: Position, focus: boolean, mouseEvent?: IMouseEvent): Promise<void | ShowDebugHoverResult> {
		this.showCancellationSource?.cancel();
		const cancellationSource = this.showCancellationSource = new CancellationTokenSource();
		const session = this.debugService.getViewModel().focusedSession;

		if (!session || !this.editor.hasModel()) {
			this.hide();
			return ShowDebugHoverResult.NOT_AVAILABLE;
		}

		const result = await this.debugHoverComputer.compute(position, cancellationSource.token);
		if (cancellationSource.token.isCancellationRequested) {
			this.hide();
			return ShowDebugHoverResult.CANCELLED;
		}

		if (!result.range) {
			this.hide();
			return ShowDebugHoverResult.NOT_AVAILABLE;
		}

		if (this.isVisible() && !result.rangeChanged) {
			return ShowDebugHoverResult.NOT_CHANGED;
		}

		const expression = await this.debugHoverComputer.evaluate(session);
		if (cancellationSource.token.isCancellationRequested) {
			this.hide();
			return ShowDebugHoverResult.CANCELLED;
		}

		if (!expression || (expression instanceof Expression && !expression.available)) {
			this.hide();
			return ShowDebugHoverResult.NOT_AVAILABLE;
		}

		this.highlightDecorations.set([{
			range: result.range,
			options: DebugHoverWidget._HOVER_HIGHLIGHT_DECORATION_OPTIONS
		}]);

		return this.doShow(result.range.getStartPosition(), expression, focus, mouseEvent);
	}

	private static readonly _HOVER_HIGHLIGHT_DECORATION_OPTIONS = ModelDecorationOptions.register({
		description: 'bdebug-hover-highlight',
		className: 'hoverHighlight'
	});

	private async doShow(position: Position, expression: IExpression, focus: boolean, mouseEvent: IMouseEvent | undefined): Promise<void> {
		if (!this.domNode) {
			this.create();
		}

		this.showAtPosition = position;
		this._isVisible = true;

		if (!expression.hasChildren) {
			this.complexValueContainer.hidden = true;
			this.valueContainer.hidden = false;
			renderExpressionValue(expression, this.valueContainer, {
				showChanged: false,
				colorize: true
			}, this.hoverService);
			this.valueContainer.title = '';
			this.editor.layoutContentWidget(this);
			this.scrollbar.scanDomNode();
			if (focus) {
				this.editor.render();
				this.valueContainer.focus();
			}

			return undefined;
		}

		this.valueContainer.hidden = true;

		this.expressionToRender = expression;
		this.complexValueTitle.textContent = expression.value;
		this.complexValueTitle.title = expression.value;
		this.editor.layoutContentWidget(this);
		this.tree.scrollTop = 0;
		this.tree.scrollLeft = 0;
		this.complexValueContainer.hidden = false;
		this.safeTriangle = mouseEvent && new dom.SafeTriangle(mouseEvent.posx, mouseEvent.posy, this.domNode);

		if (focus) {
			this.editor.render();
			this.tree.domFocus();
		}
	}

	private layoutTreeAndContainer(): void {
		this.layoutTree();
		this.editor.layoutContentWidget(this);
	}

	private layoutTree(): void {
		const scrollBarHeight = 10;
		let maxHeightToAvoidCursorOverlay = Infinity;
		if (this.showAtPosition) {
			const editorTop = this.editor.getDomNode()?.offsetTop || 0;
			const containerTop = this.treeContainer.offsetTop + editorTop;
			const hoveredCharTop = this.editor.getTopForLineNumber(this.showAtPosition.lineNumber, true) - this.editor.getScrollTop();
			if (containerTop < hoveredCharTop) {
				maxHeightToAvoidCursorOverlay = hoveredCharTop + editorTop - 22; // 22 is monaco top padding https://github.com/microsoft/vscode/blob/a1df2d7319382d42f66ad7f411af01e4cc49c80a/src/vs/editor/browser/viewParts/contentWidgets/contentWidgets.ts#L364
			}
		}
		const treeHeight = Math.min(Math.max(266, this.editor.getLayoutInfo().height * 0.55), this.tree.contentHeight + scrollBarHeight, maxHeightToAvoidCursorOverlay);

		const realTreeWidth = this.tree.contentWidth;
		const treeWidth = clamp(realTreeWidth, 400, 550);
		this.tree.layout(treeHeight, treeWidth);
		this.treeContainer.style.height = `${treeHeight}px`;
		this.scrollbar.scanDomNode();
	}

	beforeRender(): IDimension | null {
		// beforeRender will be called each time the hover size changes, and the content widget is layed out again.
		if (this.expressionToRender) {
			const expression = this.expressionToRender;
			this.expressionToRender = undefined;

			// Do this in beforeRender once the content widget is no longer display=none so that its elements' sizes will be measured correctly.
			this.isUpdatingTree = true;
			this.tree.setInput(expression).finally(() => {
				this.isUpdatingTree = false;
			});
		}

		return null;
	}

	afterRender(positionPreference: ContentWidgetPositionPreference | null) {
		if (positionPreference) {
			// Remember where the editor placed you to keep position stable #109226
			this.positionPreference = [positionPreference];
		}
	}


	hide(): void {
		if (this.showCancellationSource) {
			this.showCancellationSource.cancel();
			this.showCancellationSource = undefined;
		}

		if (!this._isVisible) {
			return;
		}

		if (dom.isAncestorOfActiveElement(this.domNode)) {
			this.editor.focus();
		}
		this._isVisible = false;
		this.highlightDecorations.clear();
		this.editor.layoutContentWidget(this);
		this.positionPreference = [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW];
	}

	getPosition(): IContentWidgetPosition | null {
		return this._isVisible ? {
			position: this.showAtPosition,
			preference: this.positionPreference
		} : null;
	}

	dispose(): void {
		this.toDispose = lifecycle.dispose(this.toDispose);
	}
}

class DebugHoverAccessibilityProvider implements IListAccessibilityProvider<IExpression> {

	getWidgetAriaLabel(): string {
		return nls.localize('treeAriaLabel', "Debug Hover");
	}

	getAriaLabel(element: IExpression): string {
		return nls.localize({ key: 'variableAriaLabel', comment: ['Do not translate placeholders. Placeholders are name and value of a variable.'] }, "{0}, value {1}, variables, debug", element.name, element.value);
	}
}

class DebugHoverDataSource extends AbstractExpressionDataSource<IExpression, IExpression> {

	public override hasChildren(element: IExpression): boolean {
		return element.hasChildren;
	}

	protected override doGetChildren(element: IExpression): Promise<IExpression[]> {
		return element.getChildren();
	}
}

class DebugHoverDelegate implements IListVirtualDelegate<IExpression> {
	getHeight(element: IExpression): number {
		return 18;
	}

	getTemplateId(element: IExpression): string {
		if (element instanceof VisualizedExpression) {
			return VisualizedVariableRenderer.ID;
		}
		return VariablesRenderer.ID;
	}
}

interface IDebugHoverComputeResult {
	rangeChanged: boolean;
	range?: Range;
}

class DebugHoverComputer {
	private _current?: {
		range: Range;
		expression: string;
	};

	constructor(
		private editor: ICodeEditor,
		@IDebugService private readonly debugService: IDebugService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@ILogService private readonly logService: ILogService,
	) { }

	public async compute(position: Position, token: CancellationToken): Promise<IDebugHoverComputeResult> {
		const session = this.debugService.getViewModel().focusedSession;
		if (!session || !this.editor.hasModel()) {
			return { rangeChanged: false };
		}

		const model = this.editor.getModel();
		const result = await getEvaluatableExpressionAtPosition(this.languageFeaturesService, model, position, token);
		if (!result) {
			return { rangeChanged: false };
		}

		const { range, matchingExpression } = result;
		const rangeChanged = !this._current?.range.equalsRange(range);
		this._current = { expression: matchingExpression, range: Range.lift(range) };
		return { rangeChanged, range: this._current.range };
	}

	async evaluate(session: IDebugSession): Promise<IExpression | undefined> {
		if (!this._current) {
			this.logService.error('No expression to evaluate');
			return;
		}

		const textModel = this.editor.getModel();
		const debugSource = textModel && session.getSourceForUri(textModel?.uri);

		if (session.capabilities.supportsEvaluateForHovers) {
			const expression = new Expression(this._current.expression);
			await expression.evaluate(session, this.debugService.getViewModel().focusedStackFrame, 'hover', undefined, debugSource ? {
				line: this._current.range.startLineNumber,
				column: this._current.range.startColumn,
				source: debugSource.raw,
			} : undefined);
			return expression;
		} else {
			const focusedStackFrame = this.debugService.getViewModel().focusedStackFrame;
			if (focusedStackFrame) {
				return await findExpressionInStackFrame(
					focusedStackFrame,
					coalesce(this._current.expression.split('.').map(word => word.trim()))
				);
			}
		}

		return undefined;
	}
}
