"""Generate TTS MP3 files for all questions using OpenAI TTS.

Reads .env from project root, questions.json from this folder.
Produces audio/<id>/q.mp3, opts.mp3, ans.mp3 per question.
Skips files that already exist (idempotent).
"""

from pathlib import Path
import json
import sys
import time

HERE = Path(__file__).parent
ROOT = HERE.parent

# Load .env
env_path = None
for p in [HERE / '.env', ROOT / '.env']:
    if p.exists():
        env_path = p
        break
if not env_path:
    sys.exit('ERROR: .env not found')

for line in env_path.read_text(encoding='utf-8-sig').splitlines():
    if line.startswith('OPENAI_API_KEY='):
        import os
        os.environ['OPENAI_API_KEY'] = line.split('=', 1)[1].strip().strip('"').strip("'")
        break

from openai import OpenAI
client = OpenAI()

MODEL = 'tts-1-hd'
VOICE = 'nova'
QUESTIONS_FILE = HERE / 'questions.json'
AUDIO_DIR = HERE / 'audio'
AUDIO_DIR.mkdir(exist_ok=True)

questions = json.loads(QUESTIONS_FILE.read_text(encoding='utf-8'))
print(f'Loaded {len(questions)} questions.')
print(f'Voice: {VOICE}  Model: {MODEL}')


def synth(text: str, out: Path):
    if out.exists() and out.stat().st_size > 0:
        return False  # skip
    resp = client.audio.speech.create(
        model=MODEL,
        voice=VOICE,
        input=text,
        response_format='mp3',
    )
    out.write_bytes(resp.content)
    return True


total_chars = 0
generated = 0
skipped = 0
for i, q in enumerate(questions, 1):
    qdir = AUDIO_DIR / q['id']
    qdir.mkdir(exist_ok=True)

    # 1. question
    q_text = f"第{i}題。{q['question_zh']}"
    # 2. options
    letters = ['A', 'B', 'C', 'D']
    opts_text = '。'.join(f'選項{letters[j]}，{opt}' for j, opt in enumerate(q['options'])) + '。'
    # 3. answer + explanation
    ans_letter = letters[q['answer_index']]
    ans_text = f"答案是{ans_letter}。{q['explanation_zh']}"

    targets = [('q.mp3', q_text), ('opts.mp3', opts_text), ('ans.mp3', ans_text)]
    for fname, text in targets:
        total_chars += len(text)
        path = qdir / fname
        try:
            did = synth(text, path)
            if did:
                generated += 1
                print(f'  [{i:>3}/{len(questions)}] {q["id"]}/{fname} ({len(text)} chars)')
            else:
                skipped += 1
        except Exception as e:
            print(f'  ERROR {q["id"]}/{fname}: {e}')
            time.sleep(2)

print(f'\nDone. Generated {generated}, skipped {skipped}.')
print(f'Total chars: {total_chars}  (~${total_chars * 30 / 1_000_000:.2f} USD for tts-1-hd)')
