# Data Science Test Design — Full Heuristic Reference

86 heuristics across 13 domains, distilled from 21 data science textbooks, 2,400+ academic papers, 48 enterprise customer deployments, and deep analysis of the Positron IDE codebase.

The system prompt (`system-prompt.md`) uses a condensed 21-heuristic subset for the GitHub Action. This document is the full reference — used by the local `/ds-test-design` slash command and for maintaining/expanding the condensed set.

---

## Domain A: Scope & Bias

**H1 — Sampling Bias Detection**
Users inspect subsets (head of dataframe, first page of output, top of plot). Test whether early/visible samples are representative. Generate cases where `df.head()` looks correct but the full dataset is wrong. Big data does not mean representative data — millions of biased rows lose to thousands of well-selected ones.

**H2 — Coverage Bias in Access Frames**
The feature may systematically exclude elements from its target population. Test for: elements that exist but can't be reached; elements included that shouldn't be; non-respondents (data absent due to timeouts or encoding failures). When the access frame doesn't match the target population, the feature is answering the wrong question.

**H3 — Measurement Bias and Instrument Drift**
Every data display or transformation is an instrument that can introduce systematic error. Test for: rounding/truncation that consistently shifts values in one direction; format conversions that lose precision (float64 → float32, nanosecond timestamps → millisecond); instruments that drift over time (cached values becoming stale). A biased instrument with low variance looks precise but is systematically wrong — and more data doesn't fix it.

**H4 — Big Data Hubris**
Large datasets tempt users to treat them as censuses. Test for: confidence indicators that don't account for coverage bias; aggregations that mask subgroup differences; more data paradoxically degrading quality (duplicates, conflicting sources, temporal inconsistency across merges).

**H5 — Survivorship and Selection Bias**
Datasets that only include successful entities or add historical data retroactively distort analyses. Test for: failed/removed entities excluded from the dataset (only surviving stocks in a financial index); data that was backfilled with knowledge not available at the time; optimistic performance biases from retrospective inclusion.

---

## Domain B: Data Quality & Wrangling

**H6 — Quality Check Cascade**
Apply quality checks from four vantage points, in this order: (1) Scope — does the data match the population? Verify row counts match expected ranges. (2) Measurements — are individual values reasonable? Check for sentinel values disguised as data (-99.99, -1, 9999). (3) Relationships — are related features internally consistent? Cross-check constraints between columns. (4) Analysis readiness — does a feature have enough variation to be useful?

**H7 — Missing Data Treachery**
Missing data is never "just missing." Test all three strategies and compare: (1) drop records — does this silently change the population? (2) NaN propagation — do downstream calculations handle NaN or produce cascading NaN? (3) imputation — does interpolation introduce artificial patterns? Always check whether missingness is random or systematic — if it clusters, the missingness itself is informative.

**H8 — Schema Violation Propagation**
When data violates expected schemas, errors should surface early. Test with: nullable integers becoming float64, timestamps losing precision, categorical data losing ordering, index columns appearing/disappearing during serialization. The distinction between storage type and feature type is critical: a float64 column may represent ordinal categories — computing a mean on it is meaningless but pandas will do it.

**H9 — Tidy Data Violations**
Many bugs stem from untidy structure: column headers containing data values, multiple variables packed into single columns, mixed observational units. Test: (1) pivoting/melting edge cases with sparse cells, (2) multi-index ambiguity after operations, (3) mixed types within a column after merges.

**H10 — Feature Type Confusion**
The distinction between nominal, ordinal, and quantitative features determines what operations make sense. Test for: computing means on ordinal data (average of 1=high, 2=medium, 3=low is meaningless), treating categorical codes as numbers (averaging zip codes), assuming equal intervals between ordinal categories, sorting nominal categories alphabetically instead of by frequency or domain logic.

**H11 — Sentinel Value Contamination**
Special values like -99.99, -1, 9999, "N/A", "n/a", empty strings, and "null" (the string) are used as missing-data markers but can silently participate in calculations. Test that all sentinel values are identified and excluded from aggregations. Test with real-world messy data: "6/20/3014" as a date, "n/a" in a numeric field — these won't crash but produce screwy results.

---

## Domain C: Statistical Reasoning

**H12 — Regression to the Mean Deception**
Extreme values on first measurement tend toward average on second measurement, regardless of intervention. When testing "improvements," verify that gains aren't just statistical regression.

**H13 — Multiple Testing Inflation**
Running 20 tests at alpha=0.05 gives a 64% chance of at least one false significance. When a feature runs multiple comparisons, expect spurious findings. Test that multiple comparison corrections are applied.

**H14 — Correlation vs. Causation Confusion**
A confounding variable that causes both X and Y creates a spurious correlation between them. Test that the feature doesn't present correlational findings as causal.

**H15 — Outlier Amplification**
A single outlier can change a correlation from 0.25 to 0.57. Mean and standard deviation are highly sensitive to outliers. Test edge cases with extreme values. Verify that robust alternatives behave correctly.

**H16 — Simpson's Paradox and Subgroup Reversal**
A relationship in aggregate data can reverse within subgroups. Test for features that show overall trends without enabling subgroup breakdown.

**H17 — Statistical vs. Practical Significance**
With large enough samples, tiny meaningless differences become "statistically significant." Test that features report effect sizes and confidence intervals, not just p-values.

**H18 — Precision-Recall Tradeoff Invisibility**
"Accuracy" alone is meaningless for imbalanced datasets. Test that evaluation metrics include precision, recall, F1, and that the rare class receives special attention.

---

## Domain D: Visualization & EDA

**H19 — Scale Reveals or Conceals Structure**
Visualization choices can hide or reveal patterns. Test that axis limits fill the data region, log transforms are available for skewed data, and aspect ratios enable trend detection.

**H20 — Smoothing Introduces and Removes Information**
Any aggregation trades detail for clarity. Test for oversmoothing that hides modes, undersmoothing no better than raw data, and missing tuning parameters.

**H21 — EDA-Induced Analysis Bias**
EDA is a winnowing process that can bias later analysis. If enough data is explored and enough comparisons made, spurious patterns emerge. Test that features don't encourage data dredging.

---

## Domain E: Model Correctness

**H22 — Overfitting and Model Selection Traps**
Training MSE always decreases with complexity but test MSE follows a U-curve. Test that training error is never presented as model quality and cross-validation boundaries aren't leaked.

**H23 — Data Leakage Detection**
If a model achieves unreasonably high performance, suspect leakage. Test for features that wouldn't be available at prediction time.

**H24 — Resampling & Validation Discipline**
Verify the training/assessment boundary is never violated. For time-series data, random cross-validation leaks future information.

**H25 — Model Versioning & Deployment Safety**
Verify that input data prototypes are validated before prediction, version pins are explicit, and metadata travels with the artifact.

**H26 — Bias-Variance Tradeoff in the Feature Itself**
A feature with low bias but high variance may pass testing but fail in production. Test with multiple different datasets to distinguish.

**H27 — Residual Pattern Analysis**
Residuals reveal what models miss. Heteroskedastic residuals signal incomplete models. Curvature in residual plots means the functional form is wrong.

---

## Domain F: Pipeline & Composition

**H28 — Pipeline Composition Correctness**
Data transformations compose: filter → group → summarize → plot. Each step may be correct individually but produce wrong results in sequence. Test the full pipeline.

**H29 — Silent Pipeline Failures**
In data pipelines, a failed upstream step can produce empty or partial data that downstream steps process without error. Verify that stderr is captured and exit codes are checked.

**H30 — Idempotency Requirement**
Duplicate executions should not corrupt state. Test that re-running doesn't create duplicate records and crash-and-retry doesn't leave partial state.

**H31 — Point-in-Time Correctness**
Historical data must reflect what was known at each timestamp, not future revisions. Test that backfilling preserves original release dates and look-ahead bias is prevented.

---

## Domain G: Stateful & Interactive Systems

**H32 — Stateful Execution Awareness**
Notebook and IDE workflows are non-linear. Cells execute out of order. Variables persist across re-runs. Kernels restart mid-workflow. Test: re-execution after modification, interrupt-and-resume, partial state after kernel restart, stale variable references after cell deletion.

**H33 — Multi-Representation Consistency**
Data appears simultaneously as tables, plots, widgets, console output, and variable explorers. Test: does the table view match the plot? Does the variable explorer reflect the current kernel state?

**H34 — Human-in-the-Loop Trust Signals**
Users trust UI signals — green checkmarks, "success" messages, cell execution counts, progress bars. Test for cases where the signal says "OK" but the result is wrong.

**H35 — Notebook-to-Production Transition**
Code that "works" in notebooks often fails in production because of hidden state, global dependencies, missing error handling, and unreproducible ordering.

---

## Domain H: Distributed & Streaming Systems

**H36 — Partition and Distribution Correctness**
When data is distributed across partitions: partition size skew, index operations resetting per-partition, rolling windows not crossing boundaries.

**H37 — Pandas-Like APIs with Different Semantics**
Distributed DataFrame APIs implement pandas-like interfaces but with different semantics. `concat` with unknown divisions produces incorrect results silently.

**H38 — Lazy Evaluation and Deferred Failure**
Spark and Dask use lazy evaluation — errors surface only when an action triggers execution. Test by forcing execution at intermediate stages.

**H39 — Streaming Temporal Correctness**
Streaming systems produce sequences of intermediate results before converging. Test for eventual consistency, out-of-order events, and window boundary conditions.

**H40 — Exactly-Once vs. At-Least-Once Semantics**
Test for duplicate handling, idempotency, and data loss under failure. Simulate crashes, network partitions, and retries.

---

## Domain I: Data Matching, Privacy & Governance

**H41 — Fuzzy Matching Threshold Sensitivity**
Small changes in matching thresholds dramatically affect false positive/negative rates. Over-normalization destroys data.

**H42 — NULL Semantics Across Systems**
NULL is not equal to NULL. Three-valued logic means `WHERE x NOT BETWEEN a AND b` silently excludes NULLs. Test every query path with NULLs.

**H43 — SQL Type Coercion and Truncation**
Float precision rounds silently. String truncation loses data without warning. Test type boundaries and implicit conversions.

**H44 — Privacy Budget Composition**
Each query on sensitive data consumes privacy budget additively. Test that epsilon accumulation is tracked correctly.

**H45 — Metadata Staleness and Lineage Breaks**
Catalog entries that fall out of sync with source systems cause users to discover data that no longer exists. Test that lineage tracking captures all transformation steps.

---

## Domain J: Cross-Tool Scientific Workflows

**H46 — Cross-Tool Data Handoff Corruption**
Real scientific workflows chain multiple tools. Each handoff is a corruption opportunity. Test for CSV exports with unexpected delimiters, coordinate system conversions introducing drift, and file paths hardcoded to one user's machine.

**H47 — Transformation Chain Opacity**
Real analyses chain 4-6 transformations before modeling. Each step can introduce errors, but intermediate outputs are rarely validated.

**H48 — Fitted Object State Persistence**
Scalers, encoders, imputers carry fitted state. After kernel restart, these objects lose their state but the transformed data still exists — creating a mismatch.

**H49 — Equivalence Table and Lookup Merge Fragility**
Scientists frequently merge data using manually-created equivalence tables. Test for IDs that don't match, one-to-many duplications, and stale tables.

**H50 — Statistical Assumption Violations Without Guardrails**
Researchers apply parametric tests without checking normality, run multiple comparisons without correction, compute means on ordinal data. The IDE doesn't stop them.

**H51 — Large Output and Verbose Model Training**
Real notebooks produce outputs too large to render: 15K+ column DataFrames, 250+ iteration logs. Test that the IDE handles these without freezing.

**H52 — Domain-Specific Validation Gaps**
Scientists trust domain conventions that the IDE can't verify: OTU counts should be non-negative integers; GPS coordinates must fall within the study region.

**H53 — Reproducibility Erosion Across Sessions**
Published papers cite specific tool versions but don't pin all dependencies. Package updates silently change defaults.

---

## Domain K: Enterprise Data Science at Scale

**H54 — Legacy Migration Parity Traps**
Enterprises migrate from Excel/SAS/SPSS expecting identical results. But floating-point libraries differ, default sort orders change, date parsing conventions diverge.

**H55 — Non-Technical Stakeholder Trust Miscalibration**
Dashboards give non-technical users direct access to model outputs. These users can't evaluate model quality — they trust whatever the UI presents.

**H56 — Unattended Scheduled Report Drift**
Automated reports run unattended for months. Test that failures send alerts, schema changes fail loudly, and stale cached data is distinguishable.

**H57 — Polyglot Environment Interop**
Enterprise teams mix R, Python, SQL, JavaScript, Bash, VBA. Test that objects crossing language boundaries preserve type fidelity.

**H58 — Regulatory Reproducibility Requirements**
Pharma, finance, and healthcare face strict reproducibility mandates. Test that the full environment is captured and restorable.

**H59 — AI/LLM Non-Determinism in Data Workflows**
LLMs are non-deterministic. Test that the same prompt doesn't produce materially different analytical conclusions on consecutive runs. Validate LLM-generated code before execution.

**H60 — Equity and Fairness in High-Stakes Models**
Healthcare, education, and government models directly affect human outcomes. Test that model performance is stratified by protected attributes.

**H61 — PII and Sensitive Data Leakage in Interactive Environments**
Interactive tools make it easy to accidentally expose sensitive data. Test that role-based access controls work at the data level.

**H62 — Global Deployment Locale Divergence**
Enterprises deploy the same analytics across continents. Locale affects everything: decimal separators, date formats, character encoding, currency symbols, timezones.

**H63 — Democratization-Induced Novice Error Amplification**
Enterprises train hundreds of non-specialists to write R/Python. These users produce valid code that embodies statistical or domain errors.

**H64 — Scenario Modeling Extrapolation Risk**
Interactive what-if tools let users adjust parameters freely. Users will push sliders beyond training data bounds.

**H65 — Cross-Platform Data and Credential Drift**
Enterprise stacks integrate multiple platforms. Each integration point can drift. Test that credential rotation doesn't silently break scheduled jobs.

---

## Domain L: Academic Research Workflow Patterns

**H66 — Meta-Analysis Pipeline Fragility**
Meta-analysis: pooling effect sizes, computing forest plots, assessing heterogeneity. Every step has silent failure modes.

**H67 — Bibliometric Analysis at Scale**
Researchers analyze thousands of publications. Test that CSV/BibTeX import handles encoding issues and deduplication works across databases.

**H68 — Survival Analysis and Censoring Correctness**
Clinical researchers use Kaplan-Meier curves and Cox regression. The core challenge is censoring: patients lost to follow-up are right-censored, not removed.

**H69 — Diagnostic Model Overfit Cascade**
Researchers build prediction models then validate with ROC curves and calibration plots. The entire pipeline is vulnerable to overfitting.

**H70 — Bioinformatics Pipeline Assumptions**
Genomics researchers chain DESeq2/limma → enrichment analysis → network analysis → visualization. Each step has implicit assumptions.

**H71 — Multi-Package Statistical Workflow Inconsistency**
Researchers chain packages that make different assumptions. Switching packages mid-workflow produces subtly wrong results.

**H72 — Clinical Threshold and Cutoff Sensitivity**
Researchers use ROC curves to find "optimal" cutoffs. The cutoff is sample-dependent — it shifts with different data.

**H73 — Domain-Specific Statistical Test Misapplication**
Researchers routinely apply t-tests without checking normality, use Pearson correlation on non-linear relationships, apply chi-squared tests to small cells.

**H74 — Structural Equation Model Convergence**
SEM and confirmatory factor analysis frequently fail to converge or produce improper solutions (negative variance, correlations > 1).

**H75 — Network Analysis and Graph Metric Fragility**
Network metrics (centrality, clustering, community detection) are sensitive to graph construction choices.

**H76 — Image and Spatial Data Processing in Non-GIS Tools**
Researchers use the IDE for image analysis and geospatial work. Test that CRS transformations are explicit and reversible.

**H77 — Parameterized Report Generation at Scale**
Researchers generate hundreds of parameterized reports. Test that one failed parameter doesn't crash the batch.

---

## Domain M: IDE Component Architecture and Synchronization

**H78 — Multi-Pane State Synchronization Drift**
Data science IDEs display the same data across multiple synchronized panes. Each pane communicates via independent comm channels. Test that editing a DataFrame in the console updates the data explorer without manual refresh; kernel restart invalidates all pane states simultaneously.

**H79 — Comm Channel Lifecycle Fragility**
IDE panes communicate with kernels via RPC over comm channels. Test that operations on a closed comm produce clear errors, not hangs; long-running operations don't timeout prematurely; comm ID reuse after restart doesn't route messages to dead channels.

**H80 — Widget and Interactive Output Rendering Pipeline**
IPyWidgets, htmlwidgets, and interactive visualizations pass through a multi-stage rendering pipeline. Test that widget state persists across tab switches; kernel restart makes widgets non-interactive with a visible indicator.

**H81 — Data Explorer Instrument Fidelity**
The data explorer is a measurement instrument. Test that INT64/BIGINT values don't lose precision; decimal values aren't silently rounded; clipboard copy doesn't silently cap; DuckDB backend matches kernel backend behavior.

**H82 — Kernel Supervisor and Session Recovery**
The kernel supervisor manages session lifecycle: creation, reconnection, adoption, cleanup. Test that session reconnection restores all comm channels; adopted sessions have full functionality; startup failures produce diagnostic messages.

**H83 — Proxy Content Rewriting and Rendering Chain**
Help content, HTML previews, Shiny apps, and widgets are served through proxy servers. Test that binary content isn't corrupted; help pages with relative URLs resolve correctly; style injection doesn't break existing CSS.

**H84 — RStudio API Migration Compatibility**
R users migrating from RStudio depend on the rstudioapi compatibility layer. Test that functions behave identically, especially insertText() positions and documentSaveAll().

**H85 — Runtime Discovery and Environment Complexity**
The IDE must discover, validate, and manage R and Python interpreters across diverse installation methods. Test that non-ASCII paths work; environment activation doesn't silently fail; conda doesn't conflict with virtualenv.

---

## Meta-Heuristic

**H86 — Silent Failure Prioritization**
The most dangerous bugs produce incorrect results without crashing. Actively search for: operations that return wrong answers instead of errors, visualizations that render but misrepresent data, status indicators that show success despite failure, and IDE panes showing stale state after kernel restart. Formalize every manual check — if a data scientist would "eyeball" a plot to verify, define what "looks right" means as a concrete, automatable assertion.
