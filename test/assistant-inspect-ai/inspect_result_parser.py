# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------
"""
Inspect AI Result Parser

Parses Inspect AI evaluation results and provides a summary with pass/fail determination
based on accuracy threshold. Designed for use in GitHub Actions.

Usage:
    python inspect_result_parser.py <json_file> --threshold <accuracy_threshold>

Exit codes:
    0: Success (accuracy >= threshold)
    1: Failure (accuracy < threshold)
    2: Error parsing file or other issues
"""

import json
import sys
import argparse
from typing import Dict, List, Any, Optional
from pathlib import Path


def load_inspect_result(file_path: str) -> Dict[str, Any]:
	"""Load and parse the Inspect AI JSON result file."""
	try:
		with open(file_path, 'r', encoding='utf-8') as f:
			return json.load(f)
	except FileNotFoundError:
		print(f"Error: File '{file_path}' not found.")
		sys.exit(2)
	except json.JSONDecodeError as e:
		print(f"Error: Invalid JSON in '{file_path}': {e}")
		sys.exit(2)
	except Exception as e:
		print(f"Error reading file '{file_path}': {e}")
		sys.exit(2)


def extract_sample_summary(sample: Dict[str, Any]) -> Dict[str, Any]:
	"""Extract key information from a sample."""
	sample_id = sample.get('id', 'unknown')

	# Extract the score (C/P/I grade)
	scores = sample.get('scores', {})
	graded_score = scores.get('model_graded_qa', {})
	grade = graded_score.get('value', 'Unknown')

	# Extract metadata
	metadata = sample.get('metadata', {})
	original_question = metadata.get('original_question', 'N/A')

	return {
		'sample_id': sample_id,
		'grade': grade,
		'original_question': original_question,
		'explanation': graded_score.get('explanation', 'No explanation provided')
	}


def calculate_grade_counts(samples: List[Dict[str, Any]]) -> Dict[str, int]:
	"""Calculate counts of C/P/I grades from samples."""
	counts = {'C': 0, 'P': 0, 'I': 0, 'Unknown': 0}

	for sample in samples:
		grade = sample.get('grade', 'Unknown')
		if grade in counts:
			counts[grade] += 1
		else:
			counts['Unknown'] += 1

	return counts


def extract_accuracy(result_data: Dict[str, Any]) -> Optional[float]:
	"""Extract accuracy metric from the results."""
	try:
		scores = result_data.get('results', {}).get('scores', [])
		for score in scores:
			if score.get('name') == 'model_graded_qa':
				metrics = score.get('metrics', {})
				accuracy_metric = metrics.get('accuracy', {})
				return accuracy_metric.get('value')
		return None
	except Exception:
		return None


def print_summary(result_data: Dict[str, Any], sample_summaries: List[Dict[str, Any]],
                 grade_counts: Dict[str, int], accuracy: Optional[float]):
	"""Print a comprehensive summary of the evaluation results."""

	# Header
	print("=" * 60)
	print("INSPECT AI EVALUATION SUMMARY")
	print("=" * 60)

	# Basic info
	eval_info = result_data.get('eval', {})
	print(f"Task: {eval_info.get('task_display_name', 'Unknown')}")
	print(f"Status: {result_data.get('status', 'Unknown')}")
	print(f"Created: {eval_info.get('created', 'Unknown')}")

	dataset_info = eval_info.get('dataset', {})
	print(f"Total Samples: {dataset_info.get('samples', 0)}")

	# Accuracy metric
	print(f"\nAccuracy: {accuracy:.3f}" if accuracy is not None else "\nAccuracy: N/A")

	# Grade distribution
	print(f"\nGrade Distribution:")
	total_graded = sum(grade_counts.values()) - grade_counts['Unknown']
	for grade, count in grade_counts.items():
		if grade != 'Unknown' or count > 0:
			percentage = (count / total_graded * 100) if total_graded > 0 else 0
			print(f"  {grade}: {count} ({percentage:.1f}%)")

	# Individual sample results
	print(f"\nSample Results:")
	print("-" * 40)
	for sample in sample_summaries:
		print(f"Sample: {sample['sample_id']}")
		print(f"  Grade: {sample['grade']}")
		print(f"  Question: {sample['original_question']}")
		if sample['explanation'] and sample['explanation'] != 'No explanation provided':
			# Show first line of explanation
			first_line = sample['explanation'].split('\n')[0]
			print(f"  Explanation: {first_line}")
		print()


def main():
	parser = argparse.ArgumentParser(
		description='Parse Inspect AI evaluation results and determine pass/fail based on accuracy threshold'
	)
	parser.add_argument('json_file', help='Path to the Inspect AI JSON result file')
	parser.add_argument('--threshold', '-t', type=float, default=0.8,
	                   help='Accuracy threshold for pass/fail (default: 0.8)')
	parser.add_argument('--quiet', '-q', action='store_true',
	                   help='Suppress detailed output, only show pass/fail result')

	args = parser.parse_args()

	# Load and parse the result file
	result_data = load_inspect_result(args.json_file)

	# Extract sample summaries
	samples = result_data.get('samples', [])
	sample_summaries = [extract_sample_summary(sample) for sample in samples]

	# Calculate grade counts
	grade_counts = calculate_grade_counts(sample_summaries)

	# Extract accuracy
	accuracy = extract_accuracy(result_data)

	if not args.quiet:
		print_summary(result_data, sample_summaries, grade_counts, accuracy)

	# Determine pass/fail
	if accuracy is None:
		print("ERROR: Could not extract accuracy metric from results")
		sys.exit(2)

	passed = accuracy >= args.threshold

	print("=" * 60)
	if passed:
		print(f"PASS: Accuracy {accuracy:.3f} >= threshold {args.threshold}")
		sys.exit(0)
	else:
		print(f"FAIL: Accuracy {accuracy:.3f} < threshold {args.threshold}")
		sys.exit(1)


if __name__ == '__main__':
	main()
