from typing import Optional

from pydantic import BaseModel


class QuestionRequest(BaseModel):
    role:str="MERN Stack Developer"
    level:str="Junior"
    count:int=5
    interview_type:str="coding-mix"


# Alias for the original misspelled name, kept so older imports keep resolving.
QuestionResquest = QuestionRequest


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
