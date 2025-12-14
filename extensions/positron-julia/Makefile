# Makefile for positron-julia development
# Simplifies common workflows for Julia extension and Positron.jl library

JULIA := ~/.juliaup/bin/julia
JULIA_PROJECT := julia/Positron
JULIA_FLAGS := --project=$(JULIA_PROJECT)
NPX := npx
TS_NODE := ts-node

.PHONY: help test test-julia test-ts build install clean coverage benchmark \
        generate-comms format-julia qa beads

help:  ## Show this help message
	@echo "Positron Julia Extension - Development Workflows"
	@echo "================================================"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Testing
test: test-julia  ## Run all tests (Julia + TypeScript)

test-julia:  ## Run Julia test suite
	@echo "Running Julia tests..."
	cd $(JULIA_PROJECT) && $(JULIA) --project=. -e 'using Pkg; Pkg.test()'

test-ts:  ## Run TypeScript tests
	@echo "Running TypeScript tests..."
	npm test

test-watch:  ## Run Julia tests in watch mode (requires Revise)
	cd $(JULIA_PROJECT) && $(JULIA) --project=. -e 'using Revise; include("test/runtests.jl")'

# Code Coverage
coverage:  ## Run tests with coverage and show report
	@echo "Running tests with coverage..."
	cd $(JULIA_PROJECT) && $(JULIA) --project=. --code-coverage=user test/runtests.jl
	@echo "\nGenerating coverage report..."
	cd $(JULIA_PROJECT) && $(JULIA) --project=. -e '\
		using Coverage; \
		cov = process_folder("src"); \
		covered, total = get_summary(cov); \
		println("Coverage: $$covered/$$total = $$(round(covered/total*100, digits=1))%")'
	@echo "\nCleaning coverage files..."
	find $(JULIA_PROJECT) -name "*.cov" -delete

coverage-clean:  ## Clean coverage files
	find $(JULIA_PROJECT) -name "*.cov" -delete

# Performance
benchmark:  ## Run performance benchmarks
	@echo "Running Data Explorer benchmarks..."
	cd $(JULIA_PROJECT) && $(JULIA) --project=. test/benchmark_data_explorer.jl

# Code Generation
generate-comms:  ## Regenerate comm types from JSON schemas
	@echo "Regenerating comm types..."
	PATH="$$HOME/.juliaup/bin:$$PATH" $(NPX) $(TS_NODE) ../../positron/comms/generate-comms.ts

generate-comms-julia:  ## Regenerate only Julia comm types
	@echo "Regenerating Julia comm types..."
	PATH="$$HOME/.juliaup/bin:$$PATH" $(NPX) $(TS_NODE) ../../positron/comms/generate-comms.ts variables help plot data_explorer ui connections

# Installation & Setup
install:  ## Install all dependencies (Julia packages + npm)
	@echo "Installing Julia dependencies..."
	cd $(JULIA_PROJECT) && $(JULIA) --project=. -e 'using Pkg; Pkg.instantiate()'
	@echo "Installing npm dependencies..."
	npm install
	@echo "Installing Julia formatter..."
	$(JULIA) -e 'using Pkg; Pkg.add("JuliaFormatter")'

install-julia-deps:  ## Install only Julia package dependencies
	cd $(JULIA_PROJECT) && $(JULIA) --project=. -e 'using Pkg; Pkg.instantiate()'

# Formatting
format-julia:  ## Format Julia code with JuliaFormatter
	cd $(JULIA_PROJECT) && $(JULIA) -e 'using JuliaFormatter; format("src"); format("test")'

# Building
build:  ## Build TypeScript extension
	npm run compile

build-watch:  ## Build TypeScript in watch mode
	npm run watch

# Cleaning
clean:  ## Clean build artifacts and coverage files
	rm -rf out/
	find $(JULIA_PROJECT) -name "*.cov" -delete
	find $(JULIA_PROJECT) -name "*.mem" -delete

# Interactive Development
repl:  ## Start Julia REPL with Positron loaded
	cd $(JULIA_PROJECT) && $(JULIA) --project=. -e 'using Positron'

repl-revise:  ## Start Julia REPL with Revise for auto-reload
	cd $(JULIA_PROJECT) && $(JULIA) --project=. -e 'using Revise; using Positron'

# Quick Checks
check: test coverage  ## Run tests and coverage

quick-test:  ## Run just Data Explorer tests (fast iteration)
	cd $(JULIA_PROJECT) && $(JULIA) --project=. -e 'include("test/test_data_explorer_comprehensive.jl")'

# Status
status:  ## Show project status summary
	@echo "Positron Julia Extension - Status"
	@echo "=================================="
	@echo ""
	@echo "Test Suite:"
	cd $(JULIA_PROJECT) && $(JULIA) --project=. test/runtests.jl 2>&1 | grep "Test Summary" -A3 || echo "Run 'make test' to see results"
	@echo ""
	@echo "Use 'make help' for available commands"
