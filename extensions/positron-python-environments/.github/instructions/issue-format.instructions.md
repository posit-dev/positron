---
applyTo: '**/github-issues/**'
---

# Guidelines for Creating Effective GitHub Issues

## Issue Format

When creating GitHub issues, use the following structure to ensure clarity and ease of verification:

### For Bug Reports

1. **Title**: Concise description of the issue (5-10 words)

2. **Problem Statement**:

    - 1-2 sentences describing the issue
    - Focus on user impact
    - Use clear, non-technical language when possible

3. **Steps to Verify Fix**:
    - Numbered list (5-7 steps maximum)
    - Start each step with an action verb
    - Include expected observations
    - Cover both success paths and cancellation/back button scenarios

### For Feature Requests

1. **Title**: Clear description of the requested feature

2. **Need Statement**:

    - 1-2 sentences describing the user need
    - Explain why this feature would be valuable

3. **Acceptance Criteria**:
    - Bulleted list of verifiable behaviors
    - Include how a user would confirm the feature works as expected

## Examples

### Bug Report Example

```
# Terminal opens prematurely with PET Resolve Environment command

**Problem:** When using "Resolve Environment..." from the Python Environment Tool menu,
the terminal opens before entering a path, creating a confusing workflow.

**Steps to verify fix:**
1. Run "Python Environments: Run Python Environment Tool in Terminal" from Command Palette
2. Select "Resolve Environment..."
3. Verify no terminal opens yet
4. Enter a Python path
5. Verify terminal only appears after path entry
6. Try canceling at the input step - confirm no terminal appears
```

### Feature Request Example

```
# Add back button support to multi-step UI flows

**Problem:** The UI flows for environment creation and Python project setup lack back button
functionality, forcing users to cancel and restart when they need to change a previous selection.

**Steps to verify implementation:**
1. Test back button in PET workflow: Run "Python Environments: Run Python Environment Tool in Terminal",
   select "Resolve Environment...", press back button, confirm it returns to menu
2. Test back button in VENV creation: Run "Create environment", select VENV, press back button at various steps
3. Test back button in CONDA creation: Create CONDA environment, use back buttons to navigate between steps
4. Test back button in Python project flow: Add Python project, verify back functionality in project type selection
```

## Best Practices

1. **Be concise**: Keep descriptions short but informative
2. **Use active voice**: "Terminal opens prematurely" rather than "The terminal is opened prematurely"
3. **Include context**: Mention relevant commands, UI elements, and workflows
4. **Focus on verification**: Make steps actionable and observable
5. **Cover edge cases**: Include cancellation paths and error scenarios
6. **Use formatting**: Bold headings and numbered lists improve readability

Remember that good issues help both developers fixing problems and testers verifying solutions.
