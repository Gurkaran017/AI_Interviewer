from fastapi import APIRouter, HTTPException

from models.evaluation_models import EvaluationRequest, EvaluationResponse
from services import evaluation_service

router = APIRouter()


@router.post("/evaluate", response_model=EvaluationResponse)
async def evaluate(request: EvaluationRequest):
    try:
        return evaluation_service.evaluate(request)
    except Exception as e:
        print(f"Failed to generate response: {e}")
        raise HTTPException(status_code=500, detail=str(e))
