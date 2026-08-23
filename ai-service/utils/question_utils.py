import re

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
