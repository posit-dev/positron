# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------
"""
Inspect AI evaluation using JSON input with model_graded_qa scorer.

1. Load a JSON dataset containing questions, model responses, and expected targets
2. Use the model_graded_qa scorer to evaluate responses

The JSON dataset contains:
- question: The original question that was asked
- model_response: The response that was given by a model
- target: The expected answer or evaluation criteria

Usage:
	inspect eval json_model_graded_eval.py

	# Use custom input file:
	INPUT_FILENAME=custom-responses.json inspect eval json_model_graded_eval.py
"""

from inspect_ai import Task, task
from inspect_ai.dataset import Sample
import json
import os
from inspect_ai.scorer import model_graded_qa
from inspect_ai.solver import Solver, solver


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


@solver
def identity() -> Solver:
	"""Identity solver that extracts the pre-existing response and sets it as the model output.

	This allows us to evaluate pre-existing responses without generating new ones.
	"""

	async def solve(state, generate):
		# Extract the model response from metadata and set it as the output
		if "model_response" in state.metadata:
			# Set the pre-existing response as the completion for the scorer to evaluate
			state.output.completion = state.metadata["model_response"]
		return state

	return solve


@task
def json_model_graded_eval():
	"""
	Evaluation task that loads responses from JSON and grades them using model_graded_qa.

	This task:
	1. Loads a JSON dataset containing pre-generated model responses
	2. Uses model_graded_qa to evaluate the quality of those responses
	3. Returns accuracy and standard error metrics
	"""
	# Load the dataset from JSON file - use custom filename if specified via INPUT_FILENAME env var
	input_filename = os.getenv("INPUT_FILENAME", "response-dataset.json")
	with open(input_filename, "r") as f:
		data = json.load(f)

	test_data = data.get("tests", [])
	model_name = "anthropic/claude-haiku-4-5-20251001"

	# Create samples from the loaded JSON data
	samples = [record_to_sample(record) for record in test_data]
	# Create a dataset from the samples
	dataset = samples

	return Task(
		dataset=dataset,
		# Use identity solver to pass through existing responses without generating new ones
		solver=identity(),
		scorer=model_graded_qa(
			instructions="""
You are an expert evaluator for checking how well LLMs respond and use tools in Positron Assistant. Your task is to evaluate test code quality based ONLY on the provided app code and specific criteria.

CRITICAL INSTRUCTIONS:
1. The question asked does not matter as much as the criteria provided in the target. Focus ENTIRELY on whether the response meets the criteria.
2. When the criteria mentions specific tools called, they should be included in the response in a section denoted by "Tools Called:".

GRADING SCALE:
- C (Complete): ALL criteria are met
- P (Partial): MOST criteria are met
- I (Incomplete): MAJOR criteria are missing or incorrectly implemented

Provide your evaluation in the following format:
GRADE: [C/P/I]
EXPLANATION: [Brief explanation focusing ONLY on how well the specified criteria were met]
			""",
			grade_pattern=r"GRADE:\s*([CPI])",
			partial_credit=True,
			model=model_name
		),
	)
