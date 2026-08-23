import uvicorn  # Similar to node + express
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import AI_SERVICE_PORT, OLLAMA_HOST, OLLAMA_MODEL_NAME
from routes import evaluation, health, questions, transcription

print("=" * 60)
print("AI Microservice Starting...")
print(f"AI_SERVICE_PORT : {AI_SERVICE_PORT}")
print(f"OLLAMA_HOST     : {OLLAMA_HOST}")
print(f"OLLAMA_MODEL    : {OLLAMA_MODEL_NAME}")
print("Whisper loads lazily on first /transcribe (tiny.en, CPU)")
print("=" * 60)

app=FastAPI(title="AI Interviewer Microservice",version="1.0")

origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(questions.router)
app.include_router(transcription.router)
app.include_router(evaluation.router)


if __name__ == "__main__":
    uvicorn.run(app,host="0.0.0.0",port=AI_SERVICE_PORT)
