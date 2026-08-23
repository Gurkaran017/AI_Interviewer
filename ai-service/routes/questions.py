from fastapi import APIRouter, HTTPException

from models.question_models import NextQuestionRequest, QuestionRequest, QuestionResponse
from services import question_service

router = APIRouter()


@router.post("/generate-questions", response_model=QuestionResponse)
async def generate_questions(request: QuestionRequest):
    try:
        return question_service.generate_questions(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-next-question")
async def generate_next_question(request: NextQuestionRequest):
    try:
        return question_service.generate_next_question(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
