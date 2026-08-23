from fastapi import APIRouter, File, HTTPException, UploadFile

from services import transcription_service

router = APIRouter()


@router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    try:
        return await transcription_service.transcribe_audio(file)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
