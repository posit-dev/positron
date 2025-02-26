/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { renderIcon } from '../../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { IObservable, ISettableObservable, autorun, constObservable, derived, observableFromEvent, observableValue } from '../../../../../../base/common/observable.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { buttonBackground, buttonForeground, buttonSecondaryBackground, buttonSecondaryForeground } from '../../../../../../platform/theme/common/colorRegistry.js';
import { registerColor, transparent } from '../../../../../../platform/theme/common/colorUtils.js';
import { ObservableCodeEditor } from '../../../../../browser/observableCodeEditor.js';
import { Rect } from '../../../../../browser/rect.js';
import { HoverService } from '../../../../../browser/services/hoverService/hoverService.js';
import { HoverWidget } from '../../../../../browser/services/hoverService/hoverWidget.js';
import { EditorOption } from '../../../../../common/config/editorOptions.js';
import { LineRange } from '../../../../../common/core/lineRange.js';
import { OffsetRange } from '../../../../../common/core/offsetRange.js';
import { StickyScrollController } from '../../../../stickyScroll/browser/stickyScrollController.js';
import { InlineCompletionsModel } from '../../model/inlineCompletionsModel.js';
import { GutterIndicatorMenuContent } from './gutterIndicatorMenu.js';
import { mapOutFalsy, n, rectToProps } from './utils.js';
import { localize } from '../../../../../../nls.js';
import { trackFocus } from '../../../../../../base/browser/dom.js';
import { IAccessibilityService } from '../../../../../../platform/accessibility/common/accessibility.js';
export const inlineEditIndicatorPrimaryForeground = registerColor(
	'inlineEdit.gutterIndicator.primaryForeground',
	buttonForeground,
	localize('inlineEdit.gutterIndicator.primaryForeground', 'Foreground color for the primary inline edit gutter indicator.')
);
export const inlineEditIndicatorPrimaryBackground = registerColor(
	'inlineEdit.gutterIndicator.primaryBackground',
	buttonBackground,
	localize('inlineEdit.gutterIndicator.primaryBackground', 'Background color for the primary inline edit gutter indicator.')
);

export const inlineEditIndicatorSecondaryForeground = registerColor(
	'inlineEdit.gutterIndicator.secondaryForeground',
	buttonSecondaryForeground,
	localize('inlineEdit.gutterIndicator.secondaryForeground', 'Foreground color for the secondary inline edit gutter indicator.')
);
export const inlineEditIndicatorSecondaryBackground = registerColor(
	'inlineEdit.gutterIndicator.secondaryBackground',
	buttonSecondaryBackground,
	localize('inlineEdit.gutterIndicator.secondaryBackground', 'Background color for the secondary inline edit gutter indicator.')
);

export const inlineEditIndicatorsuccessfulForeground = registerColor(
	'inlineEdit.gutterIndicator.successfulForeground',
	buttonForeground,
	localize('inlineEdit.gutterIndicator.successfulForeground', 'Foreground color for the successful inline edit gutter indicator.')
);
export const inlineEditIndicatorsuccessfulBackground = registerColor(
	'inlineEdit.gutterIndicator.successfulBackground',
	{ light: '#2e825c', dark: '#2e825c', hcLight: '#2e825c', hcDark: '#2e825c' },
	localize('inlineEdit.gutterIndicator.successfulBackground', 'Background color for the successful inline edit gutter indicator.')
);

export const inlineEditIndicatorBackground = registerColor(
	'inlineEdit.gutterIndicator.background',
	{
		hcDark: transparent('tab.inactiveBackground', 0.5),
		hcLight: transparent('tab.inactiveBackground', 0.5),
		dark: transparent('tab.inactiveBackground', 0.5),
		light: '#5f5f5f18',
	},
	localize('inlineEdit.gutterIndicator.background', 'Background color for the inline edit gutter indicator.')
);

export class InlineEditsGutterIndicator extends Disposable {
	constructor(
		private readonly _editorObs: ObservableCodeEditor,
		private readonly _originalRange: IObservable<LineRange | undefined>,
		private readonly _verticalOffset: IObservable<number>,
		private readonly _model: IObservable<InlineCompletionsModel | undefined>,
		private readonly _isHoveringOverInlineEdit: IObservable<boolean>,
		private readonly _focusIsInMenu: ISettableObservable<boolean>,
		@IHoverService private readonly _hoverService: HoverService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
	) {
		super();

		this._register(this._editorObs.createOverlayWidget({
			domNode: this._indicator.element,
			position: constObservable(null),
			allowEditorOverflow: false,
			minContentWidthInPx: constObservable(0),
		}));

		this._register(autorun(reader => {
			if (!accessibilityService.isMotionReduced()) {
				this._indicator.element.classList.toggle('wiggle', this._isHoveringOverInlineEdit.read(reader));
			}
		}));
	}

	private readonly _originalRangeObs = mapOutFalsy(this._originalRange);

	private readonly _state = derived(reader => {
		const range = this._originalRangeObs.read(reader);
		if (!range) { return undefined; }
		return {
			range,
			lineOffsetRange: this._editorObs.observeLineOffsetRange(range, this._store),
		};
	});

	private readonly _stickyScrollController = StickyScrollController.get(this._editorObs.editor);
	private readonly _stickyScrollHeight = this._stickyScrollController
		? observableFromEvent(this._stickyScrollController.onDidChangeStickyScrollHeight, () => this._stickyScrollController!.stickyScrollWidgetHeight)
		: constObservable(0);

	private readonly _layout = derived(reader => {
		const s = this._state.read(reader);
		if (!s) { return undefined; }

		const layout = this._editorObs.layoutInfo.read(reader);

		const bottomPadding = 1;
		const fullViewPort = Rect.fromLeftTopRightBottom(0, 0, layout.width, layout.height - bottomPadding);
		const viewPortWithStickyScroll = fullViewPort.withTop(this._stickyScrollHeight.read(reader));

		const targetVertRange = s.lineOffsetRange.read(reader);

		const space = 1;

		const targetRect = Rect.fromRanges(OffsetRange.fromTo(space + layout.glyphMarginLeft, layout.lineNumbersLeft + layout.lineNumbersWidth + 4), targetVertRange);


		const lineHeight = this._editorObs.getOption(EditorOption.lineHeight).read(reader);
		const pillOffset = this._verticalOffset.read(reader);
		const pillRect = targetRect.withHeight(lineHeight).withWidth(22).moveDown(pillOffset);
		const pillRectMoved = pillRect.moveToBeContainedIn(viewPortWithStickyScroll);

		const rect = targetRect;

		const iconRect = (targetRect.containsRect(pillRectMoved))
			? pillRectMoved
			: pillRectMoved.moveToBeContainedIn(fullViewPort.intersect(targetRect.union(fullViewPort.withHeight(lineHeight)))!); //viewPortWithStickyScroll.intersect(rect)!;

		return {
			rect,
			iconRect,
			arrowDirection: (targetRect.containsRect(iconRect) ? 'right' as const
				: iconRect.top > targetRect.top ? 'top' as const : 'bottom' as const),
			docked: rect.containsRect(iconRect) && viewPortWithStickyScroll.containsRect(iconRect),
		};
	});

	private readonly _tabAction = derived(this, reader => {
		const m = this._model.read(reader);
		if (this._editorObs.isFocused.read(reader)) {
			if (m && m.tabShouldJumpToInlineEdit.read(reader)) { return 'jump' as const; }
			if (m && m.tabShouldAcceptInlineEdit.read(reader)) { return 'accept' as const; }
		}
		return 'inactive' as const;
	});

	private readonly _iconRef = n.ref<HTMLDivElement>();
	private _hoverVisible: boolean = false;
	private readonly _isHoveredOverIcon = observableValue(this, false);

	private _showHover(): void {
		if (this._hoverVisible) {
			return;
		}

		const displayName = derived(this, reader => {
			const state = this._model.read(reader)?.inlineEditState;
			const item = state?.read(reader);
			const completionSource = item?.inlineCompletion?.source;
			// TODO: expose the provider (typed) and expose the provider the edit belongs totyping and get correct edit
			const displayName = (completionSource?.inlineCompletions as any).edits[0]?.provider?.displayName ?? localize('inlineEdit', "Inline Edit");
			return displayName;
		});

		const disposableStore = new DisposableStore();
		const content = disposableStore.add(this._instantiationService.createInstance(
			GutterIndicatorMenuContent,
			displayName,
			this._tabAction,
			(focusEditor) => {
				if (focusEditor) {
					this._editorObs.editor.focus();
				}
				h?.dispose();
			},
			this._model.map((m, r) => m?.state.read(r)?.inlineCompletion?.source.inlineCompletions.commands),
		).toDisposableLiveElement());

		const focusTracker = disposableStore.add(trackFocus(content.element));
		disposableStore.add(focusTracker.onDidBlur(() => this._focusIsInMenu.set(false, undefined)));
		disposableStore.add(focusTracker.onDidFocus(() => this._focusIsInMenu.set(true, undefined)));
		disposableStore.add(toDisposable(() => this._focusIsInMenu.set(false, undefined)));

		const h = this._hoverService.showHover({
			target: this._iconRef.element,
			content: content.element,
		}) as HoverWidget | undefined;
		if (h) {
			this._hoverVisible = true;
			h.onDispose(() => { // TODO:@hediet fix leak
				disposableStore.dispose();
				this._hoverVisible = false;
			});
		} else {
			disposableStore.dispose();
		}
	}

	private readonly _indicator = n.div({
		class: 'inline-edits-view-gutter-indicator',
		onclick: () => {
			const model = this._model.get();
			if (!model) { return; }
			const docked = this._layout.map(l => l && l.docked).get();
			this._editorObs.editor.focus();
			if (docked) {
				model.accept();
			} else {
				model.jump();
			}
		},
		tabIndex: 0,
		style: {
			position: 'absolute',
			overflow: 'visible',
		},
	}, mapOutFalsy(this._layout).map(layout => !layout ? [] : [
		n.div({
			style: {
				position: 'absolute',
				background: 'var(--vscode-inlineEdit-gutterIndicator-background)',
				borderRadius: '4px',
				...rectToProps(reader => layout.read(reader).rect),
			}
		}),
		n.div({
			class: 'icon',
			ref: this._iconRef,
			onmouseenter: () => {
				// TODO show hover when hovering ghost text etc.
				this._isHoveredOverIcon.set(true, undefined);
				this._showHover();
			},
			onmouseleave: () => { this._isHoveredOverIcon.set(false, undefined); },
			style: {
				cursor: 'pointer',
				zIndex: '1000',
				position: 'absolute',
				backgroundColor: this._tabAction.map(v => {
					switch (v) {
						case 'inactive': return 'var(--vscode-inlineEdit-gutterIndicator-secondaryBackground)';
						case 'jump': return 'var(--vscode-inlineEdit-gutterIndicator-primaryBackground)';
						case 'accept': return 'var(--vscode-inlineEdit-gutterIndicator-successfulBackground)';
					}
				}),
				['--vscodeIconForeground' as any]: this._tabAction.map(v => {
					switch (v) {
						case 'inactive': return 'var(--vscode-inlineEdit-gutterIndicator-secondaryForeground)';
						case 'jump': return 'var(--vscode-inlineEdit-gutterIndicator-primaryForeground)';
						case 'accept': return 'var(--vscode-inlineEdit-gutterIndicator-successfulForeground)';
					}
				}),
				borderRadius: '4px',
				display: 'flex',
				justifyContent: 'center',
				transition: 'background-color 0.2s ease-in-out',
				...rectToProps(reader => layout.read(reader).iconRect),
			}
		}, [
			n.div({
				style: {
					rotate: layout.map(l => {
						switch (l.arrowDirection) {
							case 'right': return '0deg';
							case 'bottom': return '90deg';
							case 'top': return '-90deg';
						}
					}),
					transition: 'rotate 0.2s ease-in-out',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
				}
			}, [
				this._tabAction.map(v => v === 'accept' ? renderIcon(Codicon.keyboardTab) : renderIcon(Codicon.arrowRight))
			])
		]),
	])).keepUpdated(this._store);
}
