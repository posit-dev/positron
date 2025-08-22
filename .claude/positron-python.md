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
│   │   └── pyproject.toml        # Python project configuration
│   └── lib/                      # Vendored Python dependencies
├── build/                        # Build configurations and CI helpers
├── package.json                  # Node.js extension manifest
└── requirements.txt              # Base Python dependencies
```

## Development Environment Setup

### Prerequisites
- Node.js 20.12.1+
- Python 3.9+ (supports 3.9-3.13)
- uv (for Python dependency management)

### Initial Setup
```bash
# From extensions/positron-python/
npm ci --fetch-timeout 120000
npm run prePublish
```

## Testing Framework

### Python Testing
All Python tests must be run from the correct directory with proper module resolution:

```bash
# Navigate to the Python module root (CRITICAL)
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

### Test Requirements
- **Test Environment**: Use pinned-test-requirements.txt for consistent CI behavior
- **Module Resolution**: Always run pytest from `python_files/posit` directory
- **No Main Blocks**: Never use `if __name__ == "__main__"` in test files

## Code Quality & Linting

### Automatic Formatting
Code formatting is handled automatically via Claude Code hooks using ruff format.

### Manual Quality Checks
```bash
# TypeScript linting and formatting
npm run lint
npm run format-check

# Python linting (from python_files/)
ruff check .
ruff format --check

# Type checking with Pyright (from python_files/)
pyright
```

### Tool Versions & Configuration
- **Pyright**: Version 1.1.308 (matches CI)
- **Ruff**: Line length 100 characters, target Python 3.8+
- **Enabled rules**: Comprehensive set including flake8-bugbear, pycodestyle, isort, etc.
- **Excludes**: Vendored dependencies (`lib/`, `posit/positron/_vendor/`)

## Architecture & Key Components

### Python Runtime Integration
- **Kernel Management**: IPython kernel lifecycle and communication
- **Environment Detection**: Virtual environments, conda, pyenv, pipenv, poetry
- **Data Science Features**: Interactive data exploration and visualization
- **Language Server**: Pylsp/Jedi integration for IntelliSense
- **Debugging**: Integration with debugpy for Python debugging

## Development Workflows

### Adding New Features
1. **Plan**: Use TodoWrite tool for complex multi-step tasks
2. **Develop**: Follow existing code patterns and conventions
3. **Test**: Write comprehensive tests covering edge cases
4. **Lint**: Code passes ruff and pyright checks
5. **Integration**: Test with Positron IDE end-to-end

### Development Testing
1. **Launch Positron**: Ensure build daemons are running, launch via `./scripts/code.sh`
2. **Open Python File**: Create test files or notebooks
3. **Test Features**: Interactive features, debugging, environment detection
4. **Check Console**: Monitor for errors in Positron Developer Console

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
def test_function_with_various_inputs():
    """Test function with different input types and edge cases."""
    test_cases = [
        # Regular cases
        ([1, 2, 3, 4, 5], "expected_result_1"),
        ([1.1, 2.2, 3.3], "expected_result_2"),
        # Edge cases
        ([], "empty_result"),
        ([1], "single_item_result"),
    ]
    
    for input_data, expected in test_cases:
        result = function_under_test(input_data)
        assert result == expected
```

### Performance Considerations
- **Efficient algorithms**: Choose optimal time complexity for large datasets
- **Memory usage**: Stream data when possible, avoid unnecessary copies
- **Lazy evaluation**: Use generators and lazy operations where appropriate

## Troubleshooting

### Common Issues
1. **Import errors**: Always run pytest from `python_files/posit` directory
2. **Module not found**: Check that your Python environment has required packages
3. **Test failures**: Ensure test requirements are installed
4. **Type errors**: Run pyright to catch type issues early

### Debugging Tips
- **Python Console**: Use Positron's Python console for interactive debugging
- **Logging**: Add logging statements to trace execution flow
- **Step-through debugging**: Use Positron's debugger for complex issues
- **Performance profiling**: Time critical sections when optimizing

This development guide ensures consistent, high-quality development practices for the Positron Python extension while maintaining compatibility with the broader data science ecosystem.