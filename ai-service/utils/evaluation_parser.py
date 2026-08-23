import json
import re

from models.evaluation_models import EvaluationResponse


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
