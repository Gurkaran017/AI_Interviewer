import ollama

from config import OLLAMA_HOST

# Shared client for every service that talks to Ollama.
client = ollama.Client(host=OLLAMA_HOST)
