# Positron: LLM Eval Test Catalog

> 5 test cases · Auto-generated on 2026-02-12T13:53:03.636Z

<details>
<summary><strong>r-notebook-automatic-context</strong> · Edit · Ensure small notebooks have automatic context w...</summary>

### Intent

Ensure small notebooks have automatic context without tool calls

### User prompt

```text
What is the total revenue shown in my notebook? Just tell me the answer, don't add or modify any cells.
```

### Criteria

#### Required

- Correctly identifies the total revenue as 145,500 (sum of 45000 + 52000 + 48500)
- Response demonstrates the assistant can READ notebook contents by mentioning at least 2 of: specific revenue values (45000, 52000, 48500), months (January, February, March), or cell reference (cell 0)
- The `editNotebookCells` tool must NOT appear in "Tools Called:" (we asked NOT to edit)

#### Nice to have

- References the DataFrame "df" by name or describes the data structure
- Provides a clear, accurate calculation or explanation showing how the total was derived
- Does not hallucinate columns or values not present in the notebook

</details>

<details>
<summary><strong>r-notebook-create</strong> · Edit · Ensure createNotebook tool is used to create ne...</summary>

### Intent

Ensure createNotebook tool is used to create new notebooks

### User prompt

```text
Create a new R notebook for me.
```

### Criteria

#### Required

- The `createNotebook` tool must appear in the "Tools Called:" section
- Creates an R notebook (not Python)

#### Nice to have

- Confirms the notebook was created
- Offers to help add content or explains next steps
- Does not create a Python notebook when R was requested

</details>

<details>
<summary><strong>r-notebook-edit-cells</strong> · Edit · Ensure editNotebookCells is used when editing n...</summary>

### Intent

Ensure editNotebookCells is used when editing notebook cells

### User prompt

```text
Fix the error in cell 2 of my notebook.
```

### Criteria

#### Required

- The `editNotebookCells` tool must appear in the "Tools Called:" section
- The `editFile` or `positron_editFile_internal` tool must NOT appear (wrong tool for notebooks)

#### Nice to have

- Correctly identifies the R error (object "undefined_variable" not found)
- Provides a reasonable fix (define the variable, use a different value, or remove the reference)
- Fix is applied to the correct cell (cell index 1, which is the second cell)
- Explanation of what was wrong and how it was fixed

#### Fail if

- Uses editFile instead of editNotebookCells (indicates the assistant did not correctly identify the notebook context)

</details>

<details>
<summary><strong>r-notebook-get-cells</strong> · Edit · Ensure getNotebookCells is called for large not...</summary>

### Intent

Ensure getNotebookCells is called for large notebooks

### User prompt

```text
What is the value calculated in cell 20 of my notebook?
```

### Criteria

#### Required

- The `getNotebookCells` tool must appear in the "Tools Called:" section (required because large notebooks use sliding window)
- Reports the correct value from cell 20 (which is 200, since it calculates x * 10 where x = 20)

#### Nice to have

- Explains what the code does or references the calculation
- Does not hallucinate values from cells that don't exist
- Correctly identifies cell 20 (0-indexed: cell index 19)

</details>

<details>
<summary><strong>r-notebook-run-cells</strong> · Agent · Ensure runNotebookCells is used to execute note...</summary>

### Intent

Ensure runNotebookCells is used to execute notebook cells

### User prompt

```text
Run cell 2 of my notebook and tell me what the output is.
```

### Criteria

#### Required

- The `runNotebookCells` tool must appear in the "Tools Called:" section
- Reports the correct output value (15, since x=10 and the code is result <- x + 5)

#### Nice to have

- Explains what the code does (adds x + 5 where x is 10)
- Confirms the cell was executed successfully
- Does not use editNotebookCells when only asked to run (should use runNotebookCells)

</details>
