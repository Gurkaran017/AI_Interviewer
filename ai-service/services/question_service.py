import json

from config import OLLAMA_MODEL_NAME
from models.question_models import NextQuestionRequest, QuestionRequest, QuestionResponse
from services.ollama_service import client
from utils.question_utils import is_duplicate_question


def generate_questions(request: QuestionRequest) -> QuestionResponse:
    print("\n========== GENERATE QUESTIONS ==========")
    print(f"Role           : {request.role}")
    print(f"Level          : {request.level}")
    print(f"Interview Type : {request.interview_type}")
    print(f"Count          : {request.count}")

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


def generate_next_question(request: NextQuestionRequest) -> dict:
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
