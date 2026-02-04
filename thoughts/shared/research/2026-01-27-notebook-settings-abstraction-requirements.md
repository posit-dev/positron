---
date: 2026-01-27
author: Claude Code (think-through session)
branch: positron-nb-native-diff-view-toggle
repository: positron
topic: "Requirements for Notebook Assistant Settings Abstraction"
tags: [requirements, design, notebooks, metadata, assistant, settings]
status: complete
---

# Requirements: Notebook Assistant Settings Abstraction

This document captures requirements gathered through a structured discovery session about improving the abstraction for notebook-specific AI settings.

## Problem Statement

The current implementation of notebook-specific settings (starting with `showDiff`) works, but lacks a clear pattern for future extensibility. As more settings are added - especially complex ones like context rules or notebook-specific prompts - developers need clear guidance on where and how to add them.

## Goals

### Primary Goal
**Future extensibility** - prepare the system for complex settings like context rules, cell filters, and custom prompts, not just simple toggles.

### Key Constraint
**Reduce cognitive load** - developers should know exactly where to add new settings without hunting across multiple files or learning complex abstractions.

### Guard Rails Philosophy
Prevent less senior developers from designing themselves into corners, but don't over-engineer. The solution should be naturally guiding, not restrictive through complexity.

## Requirements

### Functional

1. **Support complex objects** - the abstraction must handle structured data (context rules, filters), not just enums and booleans

2. **Light validation** - check types and provide sensible defaults for missing/malformed data; don't strictly reject invalid data or surface errors to users

3. **Centralized nesting logic** - the `positron.assistant.*` path traversal and null-checking should happen in one place per side (workbench, extension), not repeated in every getter/setter

4. **Schema documentation** - one authoritative place that documents the canonical schema structure

### Non-Functional

1. **Accept the workbench/extension boundary** - don't create heroic abstractions to share code across these separate codebases. Make each side clean independently.

2. **Moderate complexity tolerance** - infrastructure investment is acceptable if it clearly pays off, but avoid over-engineering

3. **Clear patterns** - the solution should make it obvious how to add a new setting, through good structure and documentation rather than magical code generation

## Design Direction

### What the abstraction should provide

**Workbench side:**
- A settings helper module that handles:
  - Reading from nested `positron.assistant.*` metadata
  - Light validation with defaults
  - Writing with proper merge/cleanup logic
- Clear type definitions with documentation

**Extension side:**
- A parallel helper module with the same interface/behavior
- References the workbench schema as authoritative

**Consistency mechanism:**
- Either integration tests or clear documentation ensuring both sides interpret the schema identically
- Not code sharing - just behavioral consistency

### What it should NOT do

- Try to share code across the workbench/extension boundary through complex build steps
- Use code generation or decorator magic
- Strictly reject malformed data (graceful degradation preferred)
- Over-abstract for hypothetical future needs beyond complex objects

## Open Questions

1. **Schema evolution** - How should we handle notebooks created with older schema versions? Graceful defaults seem sufficient, but worth considering edge cases.

2. **Consumer clarity** - For any given setting, it may be unclear whether workbench, extension, or both need to read it. The abstraction should support any of these patterns without requiring upfront decisions.

## Next Steps

1. Design the workbench-side helper module with validation
2. Design the parallel extension-side helper
3. Define the consistency testing or documentation strategy
4. Update the architecture report with the refined approach
