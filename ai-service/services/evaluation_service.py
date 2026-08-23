from config import OLLAMA_MODEL_NAME
from models.evaluation_models import EvaluationRequest, EvaluationResponse
from services.ollama_service import client
from utils.evaluation_parser import parse_evaluation_response


def evaluate(request: EvaluationRequest) -> EvaluationResponse:
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
