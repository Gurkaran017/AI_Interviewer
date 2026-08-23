from fastapi import APIRouter

from config import OLLAMA_MODEL_NAME

router = APIRouter()


@router.get("/")
async def root():
    return {"message":"Hello from AI Interviewer Microservice !","model":OLLAMA_MODEL_NAME}
