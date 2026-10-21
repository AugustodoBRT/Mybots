# Transcribes the MyBots window's dictation with faster-whisper, keeping the model loaded between dictations.
# One JSON line in ({"audio": path}), one JSON line out ({"text": ...} or {"error": ...}). Never touches the network.
import json, os, sys
import numpy
from faster_whisper import WhisperModel

name = os.environ.get('MYBOTS_WHISPER_MODEL', 'medium')
model = None
for device, compute in (('cuda', 'float16'), ('cpu', 'int8')):
    try:
        model = WhisperModel(name, device=device, compute_type=compute, local_files_only=True)
        # The GPU libraries load on first use: a second of silence proves this device works.
        list(model.transcribe(numpy.zeros(16000, dtype=numpy.float32), language='pt')[0])
        break
    except Exception as error:
        model, problem = None, str(error)
if model is None:
    print(json.dumps({'error': 'Modelo do Whisper indisponível: ' + problem[:200]}), flush=True)
    sys.exit(1)
print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    try:
        audio = json.loads(line)['audio']
        segments, _ = model.transcribe(audio, language='pt', vad_filter=True)
        print(json.dumps({'text': ' '.join(segment.text.strip() for segment in segments)}), flush=True)
    except Exception as error:
        print(json.dumps({'error': str(error)[:200]}), flush=True)
