# Positron Claude Context Files

This directory contains modular context files for Claude Code to provide specialized knowledge when working on different areas of Positron.

## How to Use

When working on a specific area, ask Claude to read the relevant context file:

```
Please read .claude/e2e-testing.md
```

Claude Code will automatically detect these files and may suggest them based on your current work.

## Available Context Files

- **e2e-testing.md** - Playwright end-to-end testing setup and commands
- **positron-duckdb.md** - DuckDB WebAssembly extension for data exploration
- **extensions.md** - Positron extension development (coming soon)
- **data-explorer.md** - Data viewer and exploration frontend architecture
- **console.md** - Console/REPL functionality (coming soon)
- **notebooks.md** - Jupyter notebook integration (coming soon)
- **language-support.md** - Python/R language features (coming soon)
- **ui-components.md** - Positron-specific UI development (coming soon)
- **backend.md** - Kernel and service integration (coming soon)
- **build.md** - Build, packaging, and deployment (coming soon)

## Best Practices

1. Reference the appropriate context file at the start of your session
2. Context files are cumulative - you can read multiple if needed
3. Files are kept focused on specific domains to avoid overwhelming Claude
4. Update context files when workflows or commands change