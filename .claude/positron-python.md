# Positron Python Extension Development

## Overview
The Positron Python extension provides comprehensive Python language support and advanced data science features for Positron IDE, including interactive data exploration, kernel management, debugging, and environment detection. This extension is a fork of Microsoft's Python extension, enhanced for data science workflows.

## Project Structure
```
extensions/positron-python/
├── src/                           # TypeScript extension code
├── python_files/                  # Python runtime components
│   ├── posit/                    # Positron-specific Python modules
│   │   ├── positron/             # Core Positron Python functionality
│   │   │   └── tests/            # Python unit tests for Positron modules
│   │   ├── pyproject.toml        # Python project configuration
│   │   └── test-requirements.txt # Python test dependencies
│   └── lib/                      # Vendored Python dependencies
├── build/                        # Build configurations and CI helpers
├── package.json                  # Node.js extension manifest
└── requirements.txt              # Base Python dependencies
```

## Development Environment Setup

We assume for now that the user is responsible for setting up their development environment.

## Claude Code Configuration

### Recommended Bash Command Permissions

When working with Claude Code on the Python extension, consider allowing these commands for efficient development:

```bash
# Python testing (from extensions/positron-python/python_files/posit)
cd extensions/positron-python/python_files/posit && python -m pytest*

# TypeScript extension testing (from root directory)
npm run test-extension -- -l positron-python*

# Code quality commands (only for posit directory)
cd extensions/positron-python/python_files/posit && ruff check*
cd extensions/positron-python/python_files/posit && ruff format*
cd extensions/positron-python/python_files/posit && pyright positron/*

# Helper scripts (from extensions/positron-python)
cd extensions/positron-python && ./scripts/check-python-quality.sh
cd extensions/positron-python && ./scripts/fix-python-format.sh
```

These permissions enable Claude to run tests, check code quality, and apply formatting fixes without requiring manual approval for each command.

## Testing Framework

### Python Testing
**CRITICAL**: All Python tests MUST be run from `extensions/positron-python/python_files/posit` directory:

```bash
# ALWAYS start from project root, then navigate to the correct directory
cd extensions/positron-python/python_files/posit

# Run all Positron Python tests
python -m pytest

# Run specific test modules
python -m pytest positron/tests/test_data_explorer.py

# Run with coverage
python -m pytest --cov=positron --cov-report=term-missing

# Run specific test with verbose output
python -m pytest positron/tests/test_data_explorer.py::test_specific_function -v
```

### TypeScript Extension Testing
**Run from project root directory**:

```bash
# Test the positron-python extension TypeScript code
npm run test-extension -- -l positron-python

# With grep pattern for specific tests
npm run test-extension -- -l positron-python --grep "test pattern"
```

### Test Requirements
- **Module Resolution**: Always run pytest from `python_files/posit` directory
- **No Main Blocks**: Never use `if __name__ == "__main__"` in test files

## Code Quality & Linting

### Automatic Formatting
Code formatting is handled automatically via Claude Code hooks using ruff format.

### Helper Scripts

```bash
# Run all Python quality checks (linting + type checking)
cd extensions/positron-python
./scripts/check-python-quality.sh

# Fix formatting and safe linting issues
./scripts/fix-python-format.sh
```

### Manual Quality Checks

```bash
# Python linting (from python_files/posit/)
cd extensions/positron-python/python_files/posit
ruff check .
ruff format --check

# Type checking with Pyright (from python_files/posit/)
pyright positron/
```

### Tool Versions

- **Pyright**: Version 1.1.308 (matches CI)
- **Ruff**: Latest version

## Development Workflows

### Adding New Features
1. **Plan**: Use TodoWrite tool for complex multi-step tasks
2. **Develop**: Follow existing code patterns and conventions
3. **Test**: Write comprehensive tests covering edge cases
4. **Lint**: Code passes ruff and pyright checks

## Dependencies & Compatibility

### Core Dependencies
- **Required**: Python 3.9+, core data science libraries
- **Testing**: pytest, pytest-asyncio, pytest-mock, syrupy
- **Optional**: Various data science packages for enhanced functionality

### Version Support
- **Python**: 3.9, 3.10, 3.11, 3.12, 3.13
- **Platforms**: Windows, macOS, Linux
- **Data Libraries**: Latest stable versions with fallbacks for older Python

## Common Development Patterns

### Error Handling
```python
# Graceful degradation for missing dependencies
try:
    import optional_library
    HAS_OPTIONAL = True
except ImportError:
    HAS_OPTIONAL = False
    
def enhanced_function(data):
    if HAS_OPTIONAL:
        return optional_library.process(data)
    else:
        return fallback_implementation(data)
```

### Testing Best Practices
```python
import pytest

@pytest.mark.parametrize("input_data,expected", [
    # Regular cases
    ([1, 2, 3, 4, 5], "expected_result_1"),
    ([1.1, 2.2, 3.3], "expected_result_2"),
    # Edge cases
    ([], "empty_result"),
    ([1], "single_item_result"),
])
def test_function_with_various_inputs(input_data, expected):
    """Test function with different input types and edge cases."""
    result = function_under_test(input_data)
    assert result == expected
```

## Troubleshooting

### Common Issues
1. **Import errors**: Always run pytest from `python_files/posit` directory
2. **Module not found**: Check that your Python environment has required packages
3. **Test failures**: Ensure test requirements are installed
4. **Type errors**: Run pyright to catch type issues early
