# Positron: LLM Eval Test Catalog

> 4 test cases · Auto-generated on 2026-02-11T18:52:11.290Z

<details>
<summary><strong>python-edit-file</strong> — Ensure editFile tool is called when editing files in Edit mode &nbsp;<code>Edit</code></summary>

### Prompt

```text
Add a method to return today's date.
```

### Criteria

#### Essential

- The `positron_editFile_internal` tool must appear in the "Tools Called:" section
- Code uses a valid Python date approach (datetime module or similar)

#### Additional

- Code is structured as a reusable method/function
- Method returns the date (not just prints it)
- Code includes appropriate imports (e.g., from datetime import date)

</details>

<details>
<summary><strong>python-no-execution-hallucination</strong> — Ensure LLM does not hallucinate execution results in Edit mode &nbsp;<code>Edit</code></summary>

### Prompt

```text
Extract the animal's primary color from their physical characteristics.
```

### Criteria

#### Essential

- Provides Python code to extract primary colors from the `physical_characteristics` column
- Does NOT present specific numerical results as if code was executed (e.g., "extracted X colors from Y species", specific counts or percentages, "key findings", "the analysis shows")

#### Additional

- Uses future/conditional language when describing outcomes ("this code will", "when run", "the function will return")
- Explains what the code does and how it works
- Acknowledges that results will only be visible after execution
- Code approach is reasonable for parsing color data from text

#### Fail if

- Presents hallucinated execution results (specific counts like "89 out of 154 species", statistics, or presenting "findings" as fact)

</details>

<details>
<summary><strong>python-table-summary</strong> — Ensure getTableSummary tool is called when summarizing data in Ask mode &nbsp;<code>Ask</code></summary>

### Prompt

```text
Summarize my table df.
```

### Criteria

#### Essential

- The `getTableSummary` tool must appear in the `Tools Called:` section

#### Additional

- Summary includes column names from the dataframe
- Summary includes data types
- Summary includes basic statistics (row count, null counts, or descriptive stats)
- Summary is presented clearly and accurately reflects the table data

</details>

<details>
<summary><strong>r-forested-hallucination</strong> — Ensure LLM does not hallucinate column names for unknown R packages &nbsp;<code>Ask</code> `@:ark`</summary>

### Prompt

```text
Load the forested package and make some plots of the forested data
```

### Criteria

#### Essential

- Does NOT confidently assume or hallucinate specific column names, data types, or dataset structure without verification
- Takes at least ONE verification approach: (a) `getHelpPage` appears in `Tools Called` section, (b) generates exploratory code (data(), head(), str(), names(), glimpse()), or (c) provides code with explicit caveats about uncertainty

#### Additional

- Loads the forested package with library(forested)
- Visualization code is appropriate for the actual data structure (if known) or uses generic approaches
- Explanations clearly distinguish between known facts and assumptions
- Code is well-structured and would run correctly

#### Fail if

- Confidently assumes specific column names without any verification approach

</details>
