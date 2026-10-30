# Kaggle 무료 GPU 에서 단어 그림을 한꺼번에 그리고(FLUX.2 klein 4B) 같은 GPU 에서 열린 비전 모델로 뜻·몸 구조를 검사한다.
# 깃허브 러너(scripts/kaggle.mjs pick)가 jobs.json(단어마다 프롬프트·검사 질문)과 borti-ref.png 를 같이 올린다.
# 결과: /kaggle/working/out/<id>.webp + out/verdicts.json (러너가 kaggle kernels output 으로 받아 scripts/kaggle.mjs collect 가 올린다)
import gc, glob, json, os, re, subprocess, sys, time

OUT = '/kaggle/working/out'
CAND = '/tmp/cand'
DRAW_REPO = 'black-forest-labs/FLUX.2-klein-4B'  # Apache-2.0 · 공개(gated 아님)
JUDGE_REPO = 'Qwen/Qwen2.5-VL-7B-Instruct'  # Apache-2.0 · 공개
os.makedirs(OUT, exist_ok=True)
os.makedirs(CAND, exist_ok=True)


def sh(*a):
    return subprocess.run(list(a), check=False, capture_output=True, text=True)


def find(name):
    for root in ['.', '/kaggle/src', '/kaggle/working', '/kaggle/input']:
        hits = glob.glob(os.path.join(root, '**', name), recursive=True)
        if hits:
            return hits[0]
    raise SystemExit(f'{name} 를 못 찾음 — cwd={os.getcwd()} ls={os.listdir(".")}')


print(sh('nvidia-smi').stdout, flush=True)
r = sh(sys.executable, '-m', 'pip', 'install', '-q', '-U', 'diffusers==0.42.1', 'transformers==5.22.0', 'accelerate==1.15.0', 'bitsandbytes==0.50.2', 'sentencepiece==0.2.2')
print('pip', r.returncode, r.stderr[-400:], flush=True)

import torch  # noqa: E402  (pip 뒤에 불러야 새 버전을 쓴다)
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

try:
    from diffusers import Flux2KleinPipeline
except ImportError:
    raise SystemExit('diffusers 0.42.1 에 Flux2KleinPipeline 이 없다')

jobs = json.load(open(find('jobs.json'), encoding='utf-8'))
ref = Image.open(find('borti-ref.png')).convert('RGB')
TRIES = int(os.environ.get('WORTY_TRIES', 2))  # 한 단어에 후보 그림 수 — 검사 통과가 나오면 거기서 멈춘다(daily 의 「탈락 시 한 번 더」와 같은 몫)
n_gpu = torch.cuda.device_count()
cap = torch.cuda.get_device_capability(0)
GPU = f'{n_gpu}x {torch.cuda.get_device_name(0)} sm{cap[0]}{cap[1]}'
# T4·P100 은 bf16 이 없다(sm < 80) → fp16
dtype = torch.bfloat16 if cap[0] >= 8 else torch.float16
print('GPU', GPU, 'dtype', dtype, 'torch', torch.__version__, flush=True)
meta = {'gpu': GPU, 'dtype': str(dtype), 'draw_repo': DRAW_REPO, 'judge_repo': JUDGE_REPO, 'tries': TRIES, 'jobs': len(jobs)}
items = {j['id']: {'cands': []} for j in jobs}


def save():
    json.dump({'meta': meta, 'items': items}, open(f'{OUT}/verdicts.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


# ── 1) 그리기 ──────────────────────────────────────────────────────────────
t0 = time.time()
pipe = None
if n_gpu > 1:
    try:
        pipe = Flux2KleinPipeline.from_pretrained(DRAW_REPO, torch_dtype=dtype, device_map='balanced')
        meta['placement'] = 'balanced'
    except Exception as e:  # noqa: BLE001
        print('balanced 실패, CPU 오프로드로:', repr(e)[:300], flush=True)
        pipe = None
if pipe is None:
    pipe = Flux2KleinPipeline.from_pretrained(DRAW_REPO, torch_dtype=dtype)
    pipe.enable_model_cpu_offload()
    meta['placement'] = 'cpu_offload'
meta['load_draw_sec'] = round(time.time() - t0, 1)
print('모델 로드', meta['load_draw_sec'], 's', meta['placement'], flush=True)

draw_secs = []
for j in jobs:
    for t in range(TRIES):
        seed = int.from_bytes(os.urandom(4), 'big')
        s = time.time()
        img = pipe(prompt=j['prompt'], image=ref, height=768, width=1024, guidance_scale=1.0, num_inference_steps=4,
                   generator=torch.Generator('cpu').manual_seed(seed)).images[0]
        sec = round(time.time() - s, 2)
        draw_secs.append(sec)
        arr = np.asarray(img.convert('L'), dtype=np.float32)
        blank = float(arr.std()) < 4  # 새까만·단색 그림(가끔 나옴)
        f = f'{CAND}/{j["id"]}_{t}.png'
        img.save(f)
        items[j['id']]['cands'].append({'file': f, 'seed': seed, 'draw_sec': sec, 'blank': blank})
        print(f'그림 {j["id"]} #{t} {sec}s blank={blank}', flush=True)
meta['draw_sec_avg'] = round(sum(draw_secs) / max(1, len(draw_secs)), 2)
meta['drawn'] = len(draw_secs)
save()
del pipe
gc.collect()
torch.cuda.empty_cache()

# ── 2) 검사(열린 비전 모델, 4비트) ─────────────────────────────────────────
from transformers import AutoProcessor, BitsAndBytesConfig, Qwen2_5_VLForConditionalGeneration  # noqa: E402

t0 = time.time()
proc = AutoProcessor.from_pretrained(JUDGE_REPO, min_pixels=256 * 28 * 28, max_pixels=768 * 28 * 28)
judge = Qwen2_5_VLForConditionalGeneration.from_pretrained(
    JUDGE_REPO,
    quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_compute_dtype=torch.float16),
    torch_dtype=torch.float16, device_map='auto')
meta['load_judge_sec'] = round(time.time() - t0, 1)
print('검사 모델 로드', meta['load_judge_sec'], 's', flush=True)


def parse(text):
    m = re.search(r'\[.*\]', text, re.S)
    if not m:
        return None
    try:
        a = json.loads(m.group(0))
        return a[0] if a and isinstance(a[0], dict) and isinstance(a[0].get('ok'), bool) else None
    except Exception:  # noqa: BLE001
        return None


def ask(j, f):
    img = Image.open(f).convert('RGB')
    msgs = [{'role': 'user', 'content': [{'type': 'text', 'text': '#1'}, {'type': 'image', 'image': img}, {'type': 'text', 'text': j['judge_prompt']}]}]
    text = proc.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    inp = proc(text=[text], images=[img], return_tensors='pt').to(judge.device)
    with torch.no_grad():
        out = judge.generate(**inp, max_new_tokens=300, do_sample=False)
    raw = proc.batch_decode(out[:, inp.input_ids.shape[1]:], skip_special_tokens=True)[0]
    return parse(raw), raw


judge_secs = []
for j in jobs:
    it = items[j['id']]
    chosen = None
    for c in it['cands']:
        if c['blank']:
            c['verdict'] = {'ok': False, 'why': '빈 그림'}
            continue
        s = time.time()
        v, raw = ask(j, c['file'])
        c['judge_sec'] = round(time.time() - s, 2)
        judge_secs.append(c['judge_sec'])
        c['verdict'] = v or {'ok': None, 'why': 'parse', 'raw': raw[:200]}
        print(f'검사 {j["id"]} {c["judge_sec"]}s {c["verdict"]}', flush=True)
        if v and v['ok']:
            chosen = c
            break
    pick = chosen or next((c for c in it['cands'] if not c['blank']), None)
    it['ok'] = bool(chosen)
    it['verdict'] = pick['verdict'] if pick else {'ok': False, 'why': '빈 그림'}
    it['tries'] = len(it['cands'])
    if pick:
        Image.open(pick['file']).convert('RGB').save(f'{OUT}/{j["id"]}.webp', quality=92)
    save()
meta['judge_sec_avg'] = round(sum(judge_secs) / max(1, len(judge_secs)), 2)
meta['judged'] = len(judge_secs)
save()
json.dump(jobs, open(f'{OUT}/jobs.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('끝', json.dumps(meta, ensure_ascii=False), flush=True)
