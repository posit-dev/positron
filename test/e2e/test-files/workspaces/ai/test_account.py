# pip install openai

import openai
import os

client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))  # Explicitly pass API key

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello, how are you?"}]
)

print(response.choices[0].message.content)