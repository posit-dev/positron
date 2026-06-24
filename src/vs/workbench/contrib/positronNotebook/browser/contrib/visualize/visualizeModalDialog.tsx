/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './visualizeModalDialog.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { PositronModalDialogReactRenderer } from '../../../../../../base/browser/positronModalDialogReactRenderer.js';
import { PositronDynamicModalDialog } from '../../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { FooterButton } from '../../../../../browser/positronComponents/positronDynamicModalDialog/components/footerButton.js';
import { LabeledTextInput } from '../../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { positronClassNames } from '../../../../../../base/common/positronUtilities.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ChartType, codeSnippetToCellSource, generateVizCode, isValidDataFrameExpr, VizAnswers, VizLibrary } from './generateVizCode.js';
import { InsertMode } from './applyVisualizeResult.js';
import { VisualizePreview } from './visualizePreview.js';

export type { InsertMode };

export interface VisualizeResult {
	answers: VizAnswers;
	mode: InsertMode;
}

export interface DataFrameColumn {
	name: string;
	type: string;
}

/**
 * IMPORTANT: This type is mirrored on the extension side in
 *   extensions/positron-assistant/src/visualizationSuggestions.ts
 * (as `VisualizationSuggestion`, with `VizLibrary` and `VizChartType`).
 *
 * The workbench cannot import from extensions, so drift is prevented by
 * keeping the allow-list literals and field shape identical on both
 * sides. `validateVisualizationSuggestion` below guards the IPC
 * boundary as defence in depth. When adding a field or changing a
 * literal, update BOTH.
 */
export interface VisualizationSuggestion {
	library: VizLibrary;
	chartType: ChartType;
	xCol: string;
	yCol: string | null;
	reasoning: {
		library: string;
		chartType: string;
		columns: string;
	};
	modelName?: string;
}

const VALID_LIBRARIES: ReadonlySet<string> = new Set(['plotly', 'matplotlib', 'seaborn']);
const VALID_CHART_TYPES: ReadonlySet<string> = new Set(['bar', 'line', 'scatter', 'histogram']);

/**
 * Guard an unknown value crossing the extension/workbench IPC boundary into
 * the strongly-typed VisualizationSuggestion shape. Returns null on any
 * validation failure -- the extension-side parser is already the first line
 * of defense; this is defence in depth so a bad model response can't throw
 * inside React state updates.
 */
export function validateVisualizationSuggestion(value: unknown): VisualizationSuggestion | null {
	if (!value || typeof value !== 'object') { return null; }
	const s = value as Partial<Record<keyof VisualizationSuggestion, unknown>> & { reasoning?: unknown };
	if (typeof s.library !== 'string' || !VALID_LIBRARIES.has(s.library)) { return null; }
	if (typeof s.chartType !== 'string' || !VALID_CHART_TYPES.has(s.chartType)) { return null; }
	if (typeof s.xCol !== 'string') { return null; }
	if (s.yCol !== null && typeof s.yCol !== 'string') { return null; }
	const r = s.reasoning;
	if (!r || typeof r !== 'object') { return null; }
	const rr = r as Record<string, unknown>;
	if (typeof rr.library !== 'string' || typeof rr.chartType !== 'string' || typeof rr.columns !== 'string') {
		return null;
	}
	return {
		library: s.library as VizLibrary,
		chartType: s.chartType as ChartType,
		xCol: s.xCol,
		yCol: s.yCol as string | null,
		reasoning: { library: rr.library, chartType: rr.chartType, columns: rr.columns },
		modelName: typeof s.modelName === 'string' ? s.modelName : undefined,
	};
}

export const showVisualizeModalDialog = (
	initialDfName: string,
	columns: DataFrameColumn[] = [],
	suggestionPromise?: Promise<VisualizationSuggestion | null>,
	notebookUri?: URI,
): Promise<VisualizeResult | undefined> => {
	return new Promise(resolve => {
		let resolved = false;
		// Resolve the promise at most once. Routed through the renderer's onDisposed so any close
		// path -- the Cancel/Insert buttons or Escape (native <dialog> close) -- settles the promise
		// exactly once.
		const settle = (r: VisualizeResult | undefined) => {
			if (resolved) { return; }
			resolved = true;
			resolve(r);
		};
		const renderer = new PositronModalDialogReactRenderer({
			onDisposed: () => settle(undefined),
		});
		const finish = (r: VisualizeResult | undefined) => {
			settle(r);
			renderer.dispose();
		};
		renderer.render(
			<VisualizeModalDialog
				columns={columns}
				initialDfName={initialDfName}
				notebookUri={notebookUri}
				renderer={renderer}
				suggestionPromise={suggestionPromise}
				onCancel={() => finish(undefined)}
				onFinish={(r) => finish(r)}
			/>
		);
	});
};

interface Props {
	renderer: PositronModalDialogReactRenderer;
	initialDfName: string;
	columns: DataFrameColumn[];
	notebookUri?: URI;
	suggestionPromise?: Promise<VisualizationSuggestion | null>;
	onCancel: () => void;
	onFinish: (r: VisualizeResult) => void;
}

type Step = 'library' | 'chart' | 'columns' | 'insert';
const STEP_ORDER: Step[] = ['library', 'chart', 'columns', 'insert'];

interface Choice<T extends string> {
	id: T;
	title: string;
	description: string;
	icon: string;
}

const LIBRARY_CHOICES: Choice<VizLibrary>[] = [
	{
		id: 'plotly',
		title: localize('positron.notebook.visualize.library.plotly.title', 'Plotly'),
		description: localize('positron.notebook.visualize.library.plotly.description', 'Interactive charts, great for exploration'),
		icon: 'codicon-preview',
	},
	{
		id: 'matplotlib',
		title: localize('positron.notebook.visualize.library.matplotlib.title', 'Matplotlib'),
		description: localize('positron.notebook.visualize.library.matplotlib.description', 'Classic Python plotting, static output'),
		icon: 'codicon-graph',
	},
	{
		id: 'seaborn',
		title: localize('positron.notebook.visualize.library.seaborn.title', 'Seaborn'),
		description: localize('positron.notebook.visualize.library.seaborn.description', 'Statistical viz with nice defaults'),
		icon: 'codicon-color-mode',
	},
];

const CHART_CHOICES: Choice<ChartType>[] = [
	{
		id: 'bar',
		title: localize('positron.notebook.visualize.chart.bar.title', 'Bar'),
		description: localize('positron.notebook.visualize.chart.bar.description', 'Compare categories'),
		icon: 'codicon-graph',
	},
	{
		id: 'line',
		title: localize('positron.notebook.visualize.chart.line.title', 'Line'),
		description: localize('positron.notebook.visualize.chart.line.description', 'Trends over a series'),
		icon: 'codicon-graph-line',
	},
	{
		id: 'scatter',
		title: localize('positron.notebook.visualize.chart.scatter.title', 'Scatter'),
		description: localize('positron.notebook.visualize.chart.scatter.description', 'Relationships between two variables'),
		icon: 'codicon-graph-scatter',
	},
	{
		id: 'histogram',
		title: localize('positron.notebook.visualize.chart.histogram.title', 'Histogram'),
		description: localize('positron.notebook.visualize.chart.histogram.description', 'Distribution of one variable'),
		icon: 'codicon-graph-left',
	},
];

const VisualizeModalDialog = (props: Props) => {
	const [step, setStep] = useState<Step>('library');
	const [library, setLibrary] = useState<VizLibrary>('plotly');
	const [chartType, setChartType] = useState<ChartType>('bar');
	const [dfName, setDfName] = useState(props.initialDfName);
	const [xCol, setXCol] = useState('');
	const [yCol, setYCol] = useState('');
	const [insertMode, setInsertMode] = useState<InsertMode>('newCell');

	// Track whether the user has manually changed each field so we don't
	// stomp on their choice when the LLM suggestion arrives.
	const userEditedLibrary = useRef(false);
	const userEditedChart = useRef(false);
	const userEditedColumns = useRef(false);

	const [suggestion, setSuggestion] = useState<VisualizationSuggestion | null>(null);
	const [suggestionState, setSuggestionState] = useState<'idle' | 'loading' | 'done' | 'failed'>(
		props.suggestionPromise ? 'loading' : 'idle'
	);

	useEffect(() => {
		if (!props.suggestionPromise) { return; }
		let cancelled = false;
		props.suggestionPromise.then((s) => {
			if (cancelled) { return; }
			if (!s) {
				setSuggestionState('failed');
				return;
			}
			setSuggestion(s);
			setSuggestionState('done');
			if (!userEditedLibrary.current) { setLibrary(s.library); }
			if (!userEditedChart.current) { setChartType(s.chartType); }
			if (!userEditedColumns.current) {
				setXCol(s.xCol);
				setYCol(s.yCol ?? '');
			}
		}).catch(() => {
			if (!cancelled) { setSuggestionState('failed'); }
		});
		return () => { cancelled = true; };
	}, [props.suggestionPromise]);

	const onLibraryChange = (v: VizLibrary) => { userEditedLibrary.current = true; setLibrary(v); };
	const onChartChange = (v: ChartType) => { userEditedChart.current = true; setChartType(v); };
	const onXChange = (v: string) => { userEditedColumns.current = true; setXCol(v); };
	const onYChange = (v: string) => { userEditedColumns.current = true; setYCol(v); };

	const currentIdx = STEP_ORDER.indexOf(step);
	const goBack = () => currentIdx > 0 && setStep(STEP_ORDER[currentIdx - 1]);
	const goNext = () => currentIdx < STEP_ORDER.length - 1 && setStep(STEP_ORDER[currentIdx + 1]);

	const trimmedDfName = dfName.trim();
	const dfNameValid = isValidDataFrameExpr(trimmedDfName);
	const xColPresent = xCol.trim().length > 0;
	const yColPresent = yCol.trim().length > 0;
	const canAdvance = step === 'columns'
		? xColPresent && dfNameValid
		: true;

	const answers: VizAnswers = {
		library,
		chartType,
		dfName: trimmedDfName,
		x: xCol,
		y: chartType !== 'histogram' && yColPresent ? yCol : undefined,
	};

	const isLastStep = step === 'insert';
	const canInsert = dfNameValid && xColPresent;
	const onOk = () => {
		if (!canInsert) { return; }
		props.onFinish({ answers, mode: insertMode });
	};

	const advanceOrSubmit = () => {
		if (isLastStep) { onOk(); return; }
		if (canAdvance) { goNext(); }
	};

	const generatedSource = dfNameValid ? codeSnippetToCellSource(generateVizCode(answers)) : '';
	const previewReady = dfNameValid && answers.x.trim().length > 0;

	return (
		<PositronDynamicModalDialog
			content={
				<div className='visualize-split'>
					<div className='visualize-modal-content'>
						<StepIndicator currentIdx={currentIdx} total={STEP_ORDER.length} />

						{step === 'library' && (
							<StepBody
								subtitle={localize('positron.notebook.visualize.step.library.subtitle', 'We will generate code using the library you pick.')}
								title={localize('positron.notebook.visualize.step.library.title', 'Choose a plotting library')}
							>
								<SuggestionBanner
									reasoning={suggestion?.reasoning.library}
									state={suggestionState}
									suggestedLabel={suggestion && LIBRARY_CHOICES.find(c => c.id === suggestion.library)?.title}
								/>
								<ChoiceGrid
									choices={LIBRARY_CHOICES}
									selectedId={library}
									suggestedId={suggestion?.library}
									onSelect={onLibraryChange}
								/>
							</StepBody>
						)}

						{step === 'chart' && (
							<StepBody
								subtitle={localize('positron.notebook.visualize.step.chart.subtitle', 'Pick the shape that best fits your data.')}
								title={localize('positron.notebook.visualize.step.chart.title', 'What kind of chart?')}
							>
								<SuggestionBanner
									reasoning={suggestion?.reasoning.chartType}
									state={suggestionState}
									suggestedLabel={suggestion && CHART_CHOICES.find(c => c.id === suggestion.chartType)?.title}
								/>
								<ChoiceGrid
									choices={CHART_CHOICES}
									selectedId={chartType}
									suggestedId={suggestion?.chartType}
									onSelect={onChartChange}
								/>
							</StepBody>
						)}

						{step === 'columns' && (
							<StepBody
								subtitle={props.columns.length
									? localize('positron.notebook.visualize.step.columns.subtitle.withColumns', 'Pick columns from your dataframe.')
									: localize('positron.notebook.visualize.step.columns.subtitle.noColumns', 'Enter column names from your dataframe.')}
								title={localize('positron.notebook.visualize.step.columns.title', 'Map your columns')}
							>
								<SuggestionBanner
									reasoning={suggestion?.reasoning.columns}
									state={suggestionState}
									suggestedLabel={suggestion
										? `x: ${suggestion.xCol}${suggestion.yCol ? `, y: ${suggestion.yCol}` : ''}`
										: undefined}
								/>
								<div className='visualize-columns-form'>
									<LabeledTextInput
										error={trimmedDfName.length > 0 && !dfNameValid}
										errorMsg={trimmedDfName.length > 0 && !dfNameValid
											? localize('positron.notebook.visualize.dfName.invalid', 'Must be a Python name like "df" or "self.data".')
											: undefined}
										label={localize('positron.notebook.visualize.dfName.label', 'DataFrame variable')}
										value={dfName}
										onChange={(e) => setDfName(e.target.value)}
									/>
									<ColumnPicker
										autoFocus
										columns={props.columns}
										label={localize('positron.notebook.visualize.xColumn.label', 'X column')}
										value={xCol}
										onChange={onXChange}
									/>
									{chartType !== 'histogram' && (
										<ColumnPicker
											allowClear
											columns={props.columns}
											label={localize('positron.notebook.visualize.yColumn.label', 'Y column (optional)')}
											value={yCol}
											onChange={onYChange}
										/>
									)}
								</div>
							</StepBody>
						)}

						{step === 'insert' && (
							<StepBody
								subtitle={localize('positron.notebook.visualize.step.insert.subtitle', 'Review the code and choose where it should land.')}
								title={localize('positron.notebook.visualize.step.insert.title', 'Ready to visualize')}
							>
								<CodePreview source={generatedSource} />
								<div className='visualize-insert-mode'>
									<InsertModeOption
										description={localize('positron.notebook.visualize.insertMode.newCell.description', 'Keep your exploration cell unchanged.')}
										icon='codicon-add'
										selected={insertMode === 'newCell'}
										title={localize('positron.notebook.visualize.insertMode.newCell.title', 'Insert as new cell below')}
										onSelect={() => setInsertMode('newCell')}
									/>
									<InsertModeOption
										description={localize('positron.notebook.visualize.insertMode.append.description', 'Add the plot to the end of the current cell.')}
										icon='codicon-arrow-down'
										selected={insertMode === 'append'}
										title={localize('positron.notebook.visualize.insertMode.append.title', 'Append to this cell')}
										onSelect={() => setInsertMode('append')}
									/>
								</div>
							</StepBody>
						)}
					</div>
					{props.notebookUri && (
						<div className='visualize-split-preview'>
							<VisualizePreview
								code={previewReady ? generatedSource : ''}
								library={library}
								needsDfName={!dfNameValid && xColPresent}
								notebookUri={props.notebookUri}
							/>
						</div>
					)}
				</div>
			}
			contentMaxHeight={480}
			contentMinHeight={480}
			footer={
				<div className='visualize-footer'>
					<FooterButton disabled={currentIdx === 0} onPressed={goBack}>
						{localize('positron.notebook.visualize.back', 'Back')}
					</FooterButton>
					<div className='visualize-footer-right'>
						<FooterButton onPressed={props.onCancel}>
							{localize('positron.notebook.visualize.cancel', 'Cancel')}
						</FooterButton>
						{isLastStep
							? <FooterButton default disabled={!canInsert} type='submit' onPressed={advanceOrSubmit}>
								{localize('positron.notebook.visualize.insert', 'Insert')}
							</FooterButton>
							: <FooterButton default disabled={!canAdvance} type='submit' onPressed={advanceOrSubmit}>
								{localize('positron.notebook.visualize.next', 'Next')}
							</FooterButton>}
					</div>
				</div>
			}
			renderer={props.renderer}
			title={localize('positron.notebook.visualize.title', 'Visualize dataframe')}
			width={900}
			onSubmit={advanceOrSubmit}
		/>
	);
};

function StepIndicator({ currentIdx, total }: { currentIdx: number; total: number }) {
	return (
		<div aria-hidden className='visualize-step-indicator'>
			{Array.from({ length: total }, (_, i) => (
				<span
					key={i}
					className={positronClassNames('visualize-step-dot', {
						active: i === currentIdx,
						completed: i < currentIdx,
					})}
				/>
			))}
		</div>
	);
}

function StepBody({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
	return (
		<div className='visualize-step-body'>
			<h2 className='visualize-step-title'>{title}</h2>
			<p className='visualize-step-subtitle'>{subtitle}</p>
			{children}
		</div>
	);
}

function ChoiceGrid<T extends string>({ choices, selectedId, suggestedId, onSelect }: {
	choices: Choice<T>[];
	selectedId: T;
	suggestedId?: T;
	onSelect: (id: T) => void;
}) {
	return (
		<div className='visualize-choice-grid'>
			{choices.map((c) => {
				const isSelected = c.id === selectedId;
				const isSuggested = c.id === suggestedId;
				return (
					<button
						key={c.id}
						aria-pressed={isSelected}
						className={positronClassNames('visualize-choice-card', {
							selected: isSelected,
							suggested: isSuggested && !isSelected,
						})}
						type='button'
						onClick={() => onSelect(c.id)}
					>
						<span className={positronClassNames('visualize-choice-icon', 'codicon', c.icon)} />
						<span className='visualize-choice-text'>
							<span className='visualize-choice-title'>
								{c.title}
								{isSuggested && (
									<span
										className='visualize-choice-badge'
										title={localize('positron.notebook.visualize.suggestion.badgeTooltip', 'Suggested by the assistant')}
									>
										<span className='codicon codicon-sparkle' />
										{localize('positron.notebook.visualize.suggestion.badge', 'Suggested')}
									</span>
								)}
							</span>
							<span className='visualize-choice-description'>{c.description}</span>
						</span>
					</button>
				);
			})}
		</div>
	);
}

/** Status banner for the LLM suggestion path: idle/loading/done/failed. */
function SuggestionBanner({ state, reasoning, suggestedLabel }: {
	state: 'idle' | 'loading' | 'done' | 'failed';
	reasoning?: string;
	suggestedLabel?: string | null;
}) {
	if (state === 'idle') { return null; }
	if (state === 'loading') {
		return (
			<div className='visualize-suggestion-banner loading'>
				<span className='codicon codicon-loading codicon-modifier-spin' />
				<span>{localize('positron.notebook.visualize.suggestion.loading', 'Thinking about the best choice for your data...')}</span>
			</div>
		);
	}
	if (state === 'failed') {
		return (
			<div className='visualize-suggestion-banner failed'>
				<span className='codicon codicon-info' />
				<span>{localize('positron.notebook.visualize.suggestion.failed', 'Assistant suggestion unavailable. Pick manually below.')}</span>
			</div>
		);
	}
	if (!reasoning && !suggestedLabel) { return null; }
	return (
		<div className='visualize-suggestion-banner done'>
			<span className='codicon codicon-sparkle' />
			<div className='visualize-suggestion-banner-text'>
				{suggestedLabel && (
					<span className='visualize-suggestion-banner-label'>
						{localize('positron.notebook.visualize.suggestion.suggestedPrefix', 'Suggested:')} <strong>{suggestedLabel}</strong>
					</span>
				)}
				{reasoning && (
					<span className='visualize-suggestion-banner-reason'>{reasoning}</span>
				)}
			</div>
		</div>
	);
}

function InsertModeOption({ title, description, icon, selected, onSelect }: {
	title: string;
	description: string;
	icon: string;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			aria-pressed={selected}
			className={positronClassNames('visualize-insert-option', { selected })}
			type='button'
			onClick={onSelect}
		>
			<span className={positronClassNames('visualize-insert-icon', 'codicon', icon)} />
			<span className='visualize-insert-text'>
				<span className='visualize-insert-title'>{title}</span>
				<span className='visualize-insert-description'>{description}</span>
			</span>
		</button>
	);
}

function CodePreview({ source }: { source: string }) {
	return (
		<pre className='visualize-code-preview'>
			<code>{source}</code>
		</pre>
	);
}

function ColumnPicker({ label, value, onChange, columns, autoFocus, allowClear }: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	columns: DataFrameColumn[];
	autoFocus?: boolean;
	allowClear?: boolean;
}) {
	const hasColumns = columns.length > 0;

	// Fallback when the dataframe wasn't inspectable -- the select would
	// be empty, so let the user type a column name.
	if (!hasColumns) {
		return (
			<LabeledTextInput
				autoFocus={autoFocus}
				label={label}
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
		);
	}

	// A native <select> is used instead of the styled DropDownListBox because
	// this dialog is a native <dialog> opened with showModal(), which lives in
	// the browser top layer. DropDownListBox renders its popup into the normal
	// DOM, so it would be occluded behind the dialog. Native <select> popups
	// render in the OS layer and appear correctly above the dialog.
	const placeholder = localize('positron.notebook.visualize.columnPicker.placeholder', 'Select a column');
	return (
		<div className='visualize-column-picker'>
			<span className='visualize-column-picker-label'>{label}</span>
			<select
				autoFocus={autoFocus}
				className='visualize-column-select'
				value={value}
				onChange={(e) => onChange(e.target.value)}
			>
				{/*
					Empty placeholder option. When allowClear, this is the "None" choice; otherwise it's
					the initial prompt. Selecting it sets the value to '', which the canAdvance/canInsert
					guards treat as "no column chosen" -- so it can't be submitted either way.
				*/}
				<option value=''>
					{allowClear ? localize('positron.notebook.visualize.columnPicker.none', 'None') : placeholder}
				</option>
				{columns.map(c => (
					<option key={c.name} value={c.name}>{`${c.name}   ${c.type}`}</option>
				))}
			</select>
		</div>
	);
}
