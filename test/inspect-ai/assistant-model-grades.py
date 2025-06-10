import asyncio
import os
from inspect_ai.model import ModelOutput
from inspect_ai.solver import TaskState
from inspect_ai.scorer import Target, model_graded_qa, multi_scorer
from inspect_ai._util.dotenv import load_dotenv


def loadenv():
    """Load environment variables from .env file if it exists"""
    env_file = ".env"
    if os.path.exists(env_file):
        load_dotenv(env_file)
        print(f"Loaded environment variables from {env_file}")
    else:
        print("No .env file found. Make sure ANTHROPIC_API_KEY and OPENAI_API_KEY are set.")


async def main():
    print("=== Simple Model-Graded QA Scoring Example ===\n")

    # Load environment variables for API credentials
    loadenv()

    # Check that we have the required API keys
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    if not anthropic_key:
        print("⚠️  ANTHROPIC_API_KEY not found. Please set it in environment or .env file.")
    if not openai_key:
        print("⚠️  OPENAI_API_KEY not found. Please set it in environment or .env file.")

    if not (anthropic_key and openai_key):
        print("\nExample requires both API keys to demonstrate different grader models.")
        return

    print("✅ Found API keys for both Anthropic and OpenAI\n")

    qa_examples = [
        {
            "question": "Explain how photosynthesis works.",
            "llm_output": """Let me inspect the DataFrame 'df' to provide you with detailed information about it.Let me provide you with a detailed description of the DataFrame 'df':

This is a large dataset containing information about flights, with 336,776 rows and 19 columns. Here are the columns and their descriptions:

1. year: The year of the flight (int16)
2. month: Month of the flight (int8)
3. day: Day of the month (int8)
4. dep_time: Departure time (float64)
5. sched_dep_time: Scheduled departure time (int16)
6. dep_delay: Departure delay in minutes (float64)
7. arr_time: Arrival time (float64)
8. sched_arr_time: Scheduled arrival time (int16)
9. arr_delay: Arrival delay in minutes (float64)
10. carrier: Airline carrier code (object/string)
11. flight: Flight number (int16)
12. tailnum: Aircraft tail number (object/string)
13. origin: Origin airport code (object/string)
14. dest: Destination airport code (object/string)
15. air_time: Time in air in minutes (float64)
16. distance: Distance in miles (int16)
17. hour: Hour of scheduled departure (int8)
18. minute: Minute of scheduled departure (int8)
19. time_hour: Timestamp of scheduled departure hour (datetime64[ns])

The data appears to be from 2013 and contains flight information from various airports (including EWR, LGA, and JFK) with multiple airlines. The dataset includes both scheduled and actual flight times, delays, and flight-specific information like aircraft numbers and distances.

Let me execute a quick summary to show you some basic statistics about the numerical columns:Some key observations from the summary statistics:
- All flights are from 2013
- The data covers all 12 months of the year
- The average departure delay is captured in the 'dep_delay' column
- Flight distances vary significantly, with the mean around halfway between the min and max values
- The data includes flights throughout the day, as shown by the 'hour' and 'minute' columns

Let me know if you'd like to explore any specific aspect of this dataset in more detail!""",
            "target_criteria": "A correct explanation should mention: (1) The rows and columsn of the dataframe, (2) The year the data is from"
        },

    ]

    # Create TaskState objects from the existing outputs
    task_states = []
    targets = []

    for i, example in enumerate(qa_examples):
        # Convert existing LLM output to ModelOutput object
        model_output = ModelOutput.from_content(
            model="positron-assistant",  # Placeholder model name
            content=example["llm_output"]
        )

        # Create TaskState with the pre-existing output
        state = TaskState(
            model="existing-model",
            sample_id=f"qa_sample_{i+1}",
            epoch=1,
            input=example["question"],
            messages=[],  # Empty since we're scoring existing outputs
            output=model_output
        )

        # Create Target with grading criteria
        target = Target(example["target_criteria"])

        task_states.append(state)
        targets.append(target)

    # Test with different grader models
    grader_models = [
        ("Anthropic Claude", "anthropic/claude-3-5-sonnet-latest"),
        ("OpenAI GPT-4", "openai/gpt-4o-mini")
    ]

    for grader_name, grader_model in grader_models:
        print(f"\n{'='*60}")
        print(f"Scoring with {grader_name} ({grader_model})")
        print(f"{'='*60}")

        try:
            # Create model-graded scorer with specific grader model
            scorer = model_graded_qa(model=grader_model)

            # Score each example
            for i, (state, target) in enumerate(zip(task_states, targets)):
                print(f"\n--- Question {i+1} ---")
                print(f"Q: {qa_examples[i]['question']}")
                print(f"\nLLM Output: {state.output.completion}")
                print(f"\nGrading Criteria: {target.text}")

                try:
                    # Score the response
                    score = await scorer(state, target)

                    print(f"\n🏆 Grade: {score.value}")
                    print(f"📝 Grader Explanation: {score.explanation}")

                except Exception as e:
                    print(f"❌ Error scoring sample {i+1}: {e}")

        except Exception as e:
            print(f"❌ Error creating scorer for {grader_name}: {e}")

    print(f"\n{'='*60}")
    print("Using multi_scorer with explicit majority vote")
    print(f"{'='*60}")

    try:
        # Create individual scorers and combine them with multi_scorer
        claude_scorer = model_graded_qa(model="anthropic/claude-3-5-sonnet-latest")
        gpt_scorer = model_graded_qa(model="openai/gpt-4o-mini")

        # Use multi_scorer with "mode" reducer for majority vote
        alternative_multi_scorer = multi_scorer([claude_scorer], "mode")

        print("\nUsing explicit multi_scorer with mode reducer...\n")

        for i, (state, target) in enumerate(zip(task_states, targets)):
            print(f"Question {i+1}: {qa_examples[i]['question']}")

            try:
                score = await alternative_multi_scorer(state, target)
                print(f"   Final Grade: {score.value}")
                explanation = score.explanation if score.explanation else "No explanation provided"
                print(f"   Explanation: {explanation[:150]}...")
                print()

            except Exception as e:
                print(f"   ❌ Error: {e}\n")

    except Exception as e:
        print(f"❌ Error creating alternative multi-grader scorer: {e}")

    print("\n" + "="*60)
    print("✅ Test Complete!")
    print("="*60)

if __name__ == "__main__":
    asyncio.run(main())
