import uvicorn  # Similar to node + express
import os       # file handling
import io       # in-memory file handling (important for audio)
import json
import re
import tempfile # Temporary file storage (audio processing)
from fastapi import FastAPI,HTTPException,UploadFile,File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel   # request validation & response validation
from dotenv import load_dotenv
from typing import Optional  # type hinting for better code clarity and validation
import ollama
from pydub import AudioSegment  # audio processing (format conversion, in-memory handling)

load_dotenv()

AI_SERVICE_PORT = int(os.getenv("AI_SERVICE_PORT",8000))
OLLAMA_MODEL_NAME=os.getenv("OLLAMA_MODEL_NAME","mistral")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

client = ollama.Client(host=OLLAMA_HOST)

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

class QuestionResquest(BaseModel):
    role:str="MERN Stack Developer"
    level:str="Junior"
    count:int=5
    interview_type:str="coding-mix"

class NextQuestionRequest(BaseModel):
    role:str
    level:str
    interview_type:str
    previous_question:str
    user_answer:Optional[str]=None
    user_code:Optional[str]=None
    ai_feedback:str
    asked_questions:Optional[list[str]]=None


class QuestionResponse(BaseModel):
    questions:list[str]
    model_used:str

class EvaluationRequest(BaseModel):
    question:str
    question_type:str
    role:str
    level:str
    user_answer:Optional[str]=None
    user_code:Optional[str]=None

class EvaluationResponse(BaseModel):
    technicalScore:int
    confidenceScore:int
    aiFeedback:str
    idealAnswer:str


def _clamp_score(value, default=0):
    try:
        score = int(float(value))
        return max(0, min(100, score))
    except (TypeError, ValueError):
        return default


def _as_string(value, default=""):
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip() or default
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value).strip() or default


# Interviewer boilerplate that carries no topic meaning ("Can you please explain what ...")
QUESTION_FILLER_WORDS = {
    "a", "about", "an", "and", "any", "are", "as", "at", "be", "by", "can", "could",
    "describe", "did", "do", "does", "for", "from", "give", "how", "i", "if", "in",
    "is", "it", "its", "me", "of", "on", "one", "or", "please", "provide", "should",
    "some", "tell", "that", "the", "their", "them", "then", "there", "these", "this",
    "to", "us", "use", "used", "using", "was", "were", "what", "when", "where",
    "which", "why", "will", "with", "would", "you", "your",
}


def _stem(word: str) -> str:
    """Crude suffix stripping so 'define'/'defining'/'defines' collapse to one token."""
    for suffix in ("ing", "ed", "es", "s"):
        if len(word) > 4 and word.endswith(suffix):
            word = word[: -len(suffix)]
            break
    if len(word) > 4 and word.endswith("e"):
        word = word[:-1]
    return word


def _question_tokens(text: str) -> set:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return {_stem(w) for w in words if w not in QUESTION_FILLER_WORDS}


def is_duplicate_question(candidate: str, asked_questions, threshold: float = 0.6) -> bool:
    """True if candidate repeats a previously asked question's topic."""
    candidate_tokens = _question_tokens(candidate)
    if not candidate_tokens:
        return True

    for asked in asked_questions or []:
        asked_tokens = _question_tokens(asked)
        if not asked_tokens:
            continue

        overlap = len(candidate_tokens & asked_tokens)
        if overlap / len(candidate_tokens | asked_tokens) >= threshold:
            return True
        # One question fully contains the other's topic (just reworded/expanded)
        if overlap / min(len(candidate_tokens), len(asked_tokens)) >= 0.8:
            return True

    return False


def parse_evaluation_response(response_text: str) -> EvaluationResponse:
    """Parse Ollama JSON robustly; salvage partial fields if JSON is truncated."""
    text = (response_text or "").strip()
    candidates = [text]

    # Flatten whitespace variant
    candidates.append(re.sub(r"[\r\n\t]+", " ", text))

    # Extract outermost JSON object if surrounded by prose/markdown
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        candidates.append(match.group(0))

    for candidate in candidates:
        try:
            data = json.loads(candidate)
            return EvaluationResponse(
                technicalScore=_clamp_score(data.get("technicalScore", 0)),
                confidenceScore=_clamp_score(data.get("confidenceScore", 0)),
                aiFeedback=_as_string(data.get("aiFeedback"), "No feedback provided"),
                idealAnswer=_as_string(data.get("idealAnswer"), "No ideal answer provided"),
            )
        except (json.JSONDecodeError, TypeError, ValueError):
            continue

    # Salvage truncated JSON: pull fields with regex even if quotes are broken
    tech = re.search(r'"technicalScore"\s*:\s*(\d+(?:\.\d+)?)', text)
    conf = re.search(r'"confidenceScore"\s*:\s*(\d+(?:\.\d+)?)', text)
    feedback = re.search(r'"aiFeedback"\s*:\s*"(.*?)(?:"\s*,|"\s*}|$)', text, re.DOTALL)
    ideal = re.search(r'"idealAnswer"\s*:\s*"(.*?)(?:"\s*,|"\s*}|$)', text, re.DOTALL)

    salvaged_feedback = feedback.group(1).strip() if feedback else ""
    salvaged_ideal = ideal.group(1).strip() if ideal else ""

    if tech or conf or salvaged_feedback or salvaged_ideal:
        print("Partially salvaged truncated evaluation JSON")
        return EvaluationResponse(
            technicalScore=_clamp_score(tech.group(1) if tech else 0),
            confidenceScore=_clamp_score(conf.group(1) if conf else 0),
            aiFeedback=salvaged_feedback or "Evaluation partially recovered from truncated model output.",
            idealAnswer=salvaged_ideal or "Ideal answer was truncated by the model. Please retry evaluation.",
        )

    print(f"Failed to parse response: {text[:2000]}")
    return EvaluationResponse(
        technicalScore=0,
        confidenceScore=0,
        aiFeedback="Failed to parse response",
        idealAnswer="Failed to parse response",
    )


@app.get("/")
async def root():
    return {"message":"Hello from AI Interviewer Microservice !","model":OLLAMA_MODEL_NAME}


@app.post("/generate-questions", response_model=QuestionResponse)
async def generate_questions(request: QuestionResquest):
    print("\n========== GENERATE QUESTIONS ==========")
    print(f"Role           : {request.role}")
    print(f"Level          : {request.level}")
    print(f"Interview Type : {request.interview_type}")
    print(f"Count          : {request.count}")

    try:
        if request.interview_type == "coding-mix":
            coding_count = int(request.count * 0.2)
            oral_count = int(request.count) - int(coding_count)

            intruction = (
                f"The first {coding_count} questions MUST be coding challenge requiring function implementation. "
                f"The remaining {oral_count} questions MUST be conceptual oral questions."
            )
        else:
            intruction = (
                "All questions MUST be conceptual oral questions. "
                "Do Not generate any coding or implementation challenges."
            )

        # MOVE THIS OUTSIDE ELSE
        system_prompt = (
            "You are an expert technical interviewer. "
            "Task: Generate interview questions. "
            "CRITICAL: Do NOT include any introductory phrases like 'To help you understand...' or 'Here is a question:'. "
            "CRITICAL: Start immediately with the question body. "
            f"Instructions: {intruction} "
            "Respond ONLY with a JSON object containing a 'questions' array of strings."
        )

        user_prompt = (
            f"Generate exactly {request.count} unique, comprehensive interview questions for a {request.level} level {request.role}. "
            "Preserve all necessary code context or scenario details within the single question string."
        )

        print("Sending request to Ollama...")
        response = client.generate( 
           model=OLLAMA_MODEL_NAME,
           prompt=user_prompt,
           system=system_prompt,
           format="json",
           options={"temperature":0.6},
           )


        response_data = json.loads(response['response'].strip())
        questions = response_data.get('questions', [])

        normalized_questions = []

        for q in questions:
            if isinstance(q, str):
                normalized_questions.append(q)

            elif isinstance(q, dict):
                # handle {"question": "..."}
                if "question" in q:
                    normalized_questions.append(q["question"])

                # fallback if single string
        if isinstance(questions, str):
            normalized_questions = [questions]

        unique_questions = []
        for q in normalized_questions:
            if is_duplicate_question(q, unique_questions):
                print(f"Duplicate question dropped from batch: {q}")
                continue
            unique_questions.append(q)

        return QuestionResponse(
            questions=unique_questions[:request.count],
            model_used=OLLAMA_MODEL_NAME
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate-next-question")
async def generate_next_question(request:NextQuestionRequest):
    try:
        asked_questions = list(request.asked_questions or [])
        if request.previous_question and request.previous_question not in asked_questions:
            asked_questions.append(request.previous_question)

        history_block = "\n".join(f"- {q}" for q in asked_questions) or "- (none)"

        base_system_prompt=(
            "You are a professional technical interviewer. "
            "Task: Generate ONE follow-up interview question based on the candidate's last answer. "
            "If the answer was poor, move to a DIFFERENT and simpler topic. If it was good, challenge them with something advanced. "
            "CRITICAL: The new question MUST cover a topic that has NOT been asked before. "
            "Never rephrase, re-ask, or slightly reword an earlier question. "
            "CRITICAL: Do NOT include any conversational filler (e.g. 'Good job!', 'Interesting approach...'). "
            "CRITICAL: Start immediately with the question body. "
            "Respond ONLY with a JSON object: {'question': 'text', 'questionType': 'oral' | 'coding'}"
        )

        base_user_prompt=(
            f"Role: {request.role}\nLevel: {request.level}\n"
            f"Questions already asked (do NOT repeat these topics):\n{history_block}\n\n"
            f"Previous Question: {request.previous_question}\n"
            f"Candidate's Answer: {request.user_answer or 'None'}\n"
            f"Candidate's Code: {request.user_code or 'None'}\n"
            f"Evaluation: {request.ai_feedback}\n"
            "Ask the next question now, on a new topic."
        )

        last_result = {"question": "", "questionType": "oral"}

        for attempt, temperature in enumerate((0.7, 0.9, 1.0)):
            user_prompt = base_user_prompt
            if attempt > 0:
                user_prompt += (
                    f"\n\nYour previous attempt repeated an earlier question: '{last_result['question']}'. "
                    f"Choose a COMPLETELY DIFFERENT area of {request.role} that shares no keywords with the list above."
                )

            response = client.generate(
                model=OLLAMA_MODEL_NAME,
                prompt=user_prompt,
                system=base_system_prompt,
                format="json",
                options={"temperature":temperature},
                )

            next_q_data = json.loads(response['response'].strip())
            last_result = {
                "question": next_q_data.get('question', ""),
                "questionType": next_q_data.get('questionType', 'oral'),
            }

            if not is_duplicate_question(last_result["question"], asked_questions):
                return last_result

            print(f"Duplicate follow-up rejected (attempt {attempt + 1}): {last_result['question']}")

        return last_result

    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))
@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
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

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if temp_audio_path and os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)

@app.post("/evaluate",response_model=EvaluationResponse)
async def evaluate(request:EvaluationRequest):
    try:
        if request.question_type=="oral":
            assessment_intruction=(
                "This is a conceptual oral question. Focus purely on candidate's verbal explanation. "
                "Ignore any code blocks. "
                "CRITICAL: If the transcript is empty, nonsense (e.g. 'blah blah','testing') or irrelevant to the question, SCORE 0."
            )
        else:
            assessment_intruction=(
                "This is a coding challenge question. Evaluate the code logic and efficiency. "
                "Use the transcription only for insight into their thought process. "
                "CRITICAL: If the code is 'undefined', empty, just random comments, or random characters, SCORE 0."
            )
        
        system_prompt=(
            "You are a strict technical interviewer. "
            "Do NOT hallucinate positive reviews for bad input. "
            "RULE 1: If the answer is gibberish, irrelevant, or missing, return technicalScore 0 and confidenceScore 0. "
            "RULE 2: Return ONE compact JSON object only. No markdown fences. No nested objects. "
            "RULE 3: aiFeedback must be a short plain string (max 2 sentences). Avoid raw quotes inside strings; use single quotes if needed. "
            "RULE 4: idealAnswer must be a short plain Markdown string (max 6 lines) explaining the correct approach. "
            f"Context: {assessment_intruction} "
            "Required keys: technicalScore (number 0-100), confidenceScore (number 0-100), aiFeedback (string), idealAnswer (string)."
        )
        user_prompt=(
           
            f"Role: {request.role}\n"
            f"Question: {request.question}\n"
            f"Level: {request.level}\n"
            f"Verbal Answer: {request.user_answer or 'No verbal answer provided'}\n"
            f"Code Answer: {request.user_code or 'No code provided'}\n"
        )
        response = client.generate(
            model=OLLAMA_MODEL_NAME,
            prompt=user_prompt,
            system=system_prompt,
            format="json",
            options={"temperature":0.1, "num_predict": 1024},
            )
        
        response_text=response['response'].strip()
        return parse_evaluation_response(response_text)

    except Exception as e:
        print(f"Failed to generate response: {e}")
        raise HTTPException(status_code=500,detail=str(e))
        

if __name__ == "__main__":
    uvicorn.run(app,host="0.0.0.0",port=AI_SERVICE_PORT)