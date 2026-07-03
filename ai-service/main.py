import uvicorn  # Similar to node + express
import os       # file handling
import io       # in-memory file handling (important for audio)
import json
import tempfile # Temporary file storage (audio processing)
from fastapi import FastAPI,HTTPException,UploadFile,File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel   # request validation & response validation
from dotenv import load_dotenv
from typing import Optional  # type hinting for better code clarity and validation
import ollama
import whisper
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

WHISPER_MODEL=None

try:
    print("Loading Whisper Model ...")
    WHISPER_MODEL=whisper.load_model("base.en")
    print("Whisper Model Loaded Successfully")
except Exception as e:
    print("Error while loading Whisper Model")
    print(e)

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
                
        return QuestionResponse(
            questions=normalized_questions[:request.count],
            model_used=OLLAMA_MODEL_NAME
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate-next-question")
async def generate_next_question(request:NextQuestionRequest):
    try:
        system_prompt=(
            "You are a professional technical interviewer. "
            "Task: Generate ONE follow-up interview question based on the candidate's last answer. "
            "If the answer was poor, ask a simpler follow-up. If it was good, challenge them with something advanced. "
            "CRITICAL: Do NOT include any conversational filler (e.g. 'Good job!', 'Interesting approach...'). "
            "CRITICAL: Start immediately with the question body. "
            "Respond ONLY with a JSON object: {'question': 'text', 'questionType': 'oral' | 'coding'}"
        )

        user_prompt=(
            f"Role: {request.role}\nLevel: {request.level}\n"
            f"Previous Question: {request.previous_question}\n"
            f"Candidate's Answer: {request.user_answer or 'None'}\n"
            f"Candidate's Code: {request.user_code or 'None'}\n"
            f"Evaluation: {request.ai_feedback}\n"
            "Ask the next question now."
        )

        response = client.generate(
            model=OLLAMA_MODEL_NAME,
            prompt=user_prompt,
            system=system_prompt,
            format="json",
            options={"temperature":0.7},
            )

        next_q_data = json.loads(response['response'].strip())
        return {"question": next_q_data.get('question', ""), "questionType": next_q_data.get('questionType', 'oral')}

    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))
@app.post("/transcribe")
async def transcribe_audio(file:UploadFile=File(...)):
    print("\n========== TRANSCRIPTION ==========")
    print(f"Filename : {file.filename}")
    print(f"Type     : {file.content_type}")
    try:
        audio_bytes=await file.read()
        print(f"Audio Size : {len(audio_bytes)} bytes")
        audio_in_memory=io.BytesIO(audio_bytes)
        audio_segment=AudioSegment.from_file(audio_in_memory)
        with tempfile.NamedTemporaryFile(delete=False,suffix=".mp3") as tmp:
            temp_audio_path=tmp.name
            audio_segment.export(temp_audio_path,format="mp3")
        if not WHISPER_MODEL:
            raise HTTPException(status_code=503,detail="Whisper Model is not loaded")
        
        result=WHISPER_MODEL.transcribe(temp_audio_path)
        print("Transcription completed")
        print(result["text"])
                
        os.remove(temp_audio_path)
        return {"transcription":result["text"].strip()}

    except Exception as e:
        if 'temp_audio_path' in locals() and os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)
        raise HTTPException(status_code=500,detail=str(e))

@app.post("/evaluate",response_model=EvaluationResponse)
async def evaluate(request:EvaluationRequest):
    try:
        if request.question_type=="oral":
            assessment_intruction=(
                "This is a conceptual oral question. Focus purely on candidate's veral explanation. "
                "Ignore any code blocks. "
                "CRITICAL: If the transcript is empty, nonsense (e.g. 'blah blah','testing') or irrelevent to the question, SCORE 0."
            )
        else:
            assessment_intruction=(
                "This is a coding challenge question. Evaluate the code logic and efficiency. "
                "Use the transcription only for insight into their thought process. "
                "CRITICAL: If the code is 'udefined',empty, just random comments, or random characters, SCORE 0."
            )
        
        system_prompt=(
            "You are a sstrict technical interviewer. "
            "Do NOT hallucinate positive reviews for bad input. "
            "RULE 1: If the answer is gibberish, irrelevant, or missing, return 'technicalScore':0 and 'confidenceScore':0. "
            "RULE 2: For 'idealAnswer', provide a clean Markdown string.Do NOT return a nested JSON object. "
            f"Context:{assessment_intruction}"
            "Respond ONLY with a JSON object. "
            "Required keys: 'technicalScore' (0-100), 'confidenceScore' (0-100), 'aiFeedback', 'idealAnswer'. "
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
            options={"temperature":0.1},
            )
        
        response_text=response['response'].strip()
        try:
            evaluation_data=json.loads(response_text)
            if 'idealAnswer' in evaluation_data and not isinstance(evaluation_data['idealAnswer'],str):
                evaluation_data['idealAnswer']=json.dumps(evaluation_data['idealAnswer'])
            return EvaluationResponse(**evaluation_data)
        except json.JSONDecodeError:
            import re
            fixed_text=re.sub(r'[\r\n\t]',' ',response_text)
            try :
                evaluation_data=json.loads(fixed_text)
                if 'idealAnswer' in evaluation_data and not isinstance(evaluation_data['idealAnswer'],str):
                    evaluation_data['idealAnswer']=json.dumps(evaluation_data['idealAnswer'])
                return EvaluationResponse(**evaluation_data)
            except :
                print(f"Failed to parse response: {response_text}")
                return EvaluationResponse(technicalScore=0,confidenceScore=0,aiFeedback="Failed to parse response",idealAnswer="Failed to parse response")

    except Exception as e:
        print(f"Failed to generate response: {e}")
        raise HTTPException(status_code=500,detail=str(e))
        

if __name__ == "__main__":
    uvicorn.run(app,host="0.0.0.0",port=AI_SERVICE_PORT)