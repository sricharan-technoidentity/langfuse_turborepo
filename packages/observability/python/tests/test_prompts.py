from repo_observability import compile_template, define_chat_prompt, get_chat_prompt, seed_chat_prompt
from repo_observability.testing import TestTracing

prompt = define_chat_prompt(
    name="test/greeting",
    messages=[
        {"role": "system", "content": "You work for {{ company }}."},
        {"role": "user", "content": "{{question}} {{unknown}}"},
    ],
    config={"model": "mock-gpt-small", "temperature": 0.1},
)


def test_compiles_variables_like_langfuse_and_keeps_unknown_ones() -> None:
    assert compile_template("Hi {{ name }} {{other}}", {"name": "Ana"}) == "Hi Ana {{other}}"


def test_falls_back_to_the_local_definition(tracing: TestTracing) -> None:
    resolved = get_chat_prompt(prompt)
    assert resolved.is_fallback
    assert resolved.version is None
    assert resolved.link is None
    assert resolved.config == {"model": "mock-gpt-small", "temperature": 0.1}
    assert resolved.compile({"company": "Acme", "question": "Refunds?"}) == [
        {"role": "system", "content": "You work for Acme."},
        {"role": "user", "content": "Refunds? {{unknown}}"},
    ]


def test_skips_seeding_when_disabled(tracing: TestTracing) -> None:
    assert seed_chat_prompt(prompt) == {"name": "test/greeting", "status": "skipped", "reason": "Langfuse disabled"}
