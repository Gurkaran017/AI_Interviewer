import io       # in-memory file handling (important for audio)
import os       # file handling
import tempfile # Temporary file storage (audio processing)

from fastapi import UploadFile
from pydub import AudioSegment  # audio processing (format conversion, in-memory handling)

WHISPER_MODEL = None


def get_whisper_model():
    """Load Whisper only when transcription is requested (keeps Render startup under RAM limit)."""
    global WHISPER_MODEL
    if WHISPER_MODEL is None:
        import whisper  # lazy: importing whisper pulls in torch
        print("Loading Whisper Model (tiny.en, cpu)...")
        WHISPER_MODEL = whisper.load_model("tiny.en", device="cpu")
        print("Whisper Model Loaded Successfully")
    return WHISPER_MODEL


async def transcribe_audio(file: UploadFile) -> dict:
    print("\n========== TRANSCRIPTION ==========")
    print(f"Filename : {file.filename}")
    print(f"Type     : {file.content_type}")
    temp_audio_path = None
    try:
        audio_bytes = await file.read()
        print(f"Audio Size : {len(audio_bytes)} bytes")
        audio_in_memory = io.BytesIO(audio_bytes)
        audio_segment = AudioSegment.from_file(audio_in_memory)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
            temp_audio_path = tmp.name
            audio_segment.export(temp_audio_path, format="mp3")

        model = get_whisper_model()
        result = model.transcribe(temp_audio_path, fp16=False)
        print("Transcription completed")
        print(result["text"])

        return {"transcription": result["text"].strip()}

    finally:
        if temp_audio_path and os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)
