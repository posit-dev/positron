# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------
"""
Example Inspect AI evaluation using JSON input with model_graded_qa scorer.

This example demonstrates how to:
1. Load a JSON dataset containing questions, model responses, and expected targets
2. Use the model_graded_qa scorer to evaluate responses
3. Support both OpenAI and Anthropic API keys from environment variables

The JSON dataset contains:
- question: The original question that was asked
- model_response: The response that was given by a model
- target: The expected answer or evaluation criteria

Usage:
	inspect eval json_model_graded_eval.py --model openai/gpt-4o
	inspect eval json_model_graded_eval.py --model anthropic/claude-3-5-sonnet-20241022
"""

from inspect_ai import Task, task
from inspect_ai.dataset import Sample, json_dataset
from inspect_ai.scorer import model_graded_qa
from inspect_ai.solver import generate


def record_to_sample(record):
	"""
	Convert a JSON record to an Inspect Sample.

	Args:
	record: Dictionary containing 'question', 'model_response', and 'target' keys

	Returns:
	Sample: Inspect Sample object with the model_response as input and target for grading
	"""
	return Sample(
		id=record.get("id"),
		input=f"Question: {record['question']}\n\nAnswer: {record['model_response']}",
		target=record["target"],
		metadata={
			"original_question": record["question"],
			"model_response": record["model_response"],
		},
	)


@task
def json_model_graded_eval():
	"""
	Evaluation task that loads responses from JSON and grades them using model_graded_qa.

	This task:
	1. Loads a JSONL dataset containing pre-generated model responses
	2. Uses model_graded_qa to evaluate the quality of those responses
	3. Returns accuracy and standard error metrics
	"""
	# Load the dataset from JSON file
	dataset = json_dataset("response-dataset.jsonl", sample_fields=record_to_sample)

	return Task(
		dataset=dataset,
		solver=[
		# Since we already have the model responses in our dataset,
		# we just need to pass them through.
			generate()
			],
		scorer=model_graded_qa(
			# Example of Custom instructions for the grader model
			# instructions="""
			# Please evaluate whether the provided answer adequately addresses the question based on the given criterion.
			# Consider:
			# - Factual accuracy of the information
			# - Completeness of the answer
			# - Relevance to the question asked
			# Provide your reasoning step by step, then conclude with either:
			# GRADE: C (if the answer meets the criterion)
			# GRADE: I (if the answer does not meet the criterion)
			# """,
			# Enable partial credit for answers that are partially correct
			partial_credit=True,
			# You can specify a different model for grading if desired
			# model="anthropic/claude-3-5-sonnet-20241022"
			),
	)
