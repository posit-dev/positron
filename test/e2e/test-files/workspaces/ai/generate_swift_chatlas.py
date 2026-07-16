# pip install chatlas
# pip install openai


from chatlas import ChatOpenAI
import os

# Setup your Open API key in an env var
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

def chat_with_chatlas(prompt: str):
    chatlas_client = ChatOpenAI(api_key=OPENAI_API_KEY, model="gpt-4o-mini")
    try:
        response = chatlas_client.chat(prompt)
        return response
    except Exception as e:
        return f"An error occurred: {e}"

prompt = "Write me a simple Swift program that shows me how many performance cores I have"
response = chat_with_chatlas(prompt)