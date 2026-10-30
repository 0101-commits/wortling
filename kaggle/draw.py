# Kaggle 무료 GPU 에서 단어 그림을 한꺼번에 그리고(FLUX.2 klein 4B) 같은 GPU 에서 열린 비전 모델로 뜻·몸 구조를 검사한다.
# 깃허브 러너(scripts/kaggle.mjs pick)가 jobs.json(단어마다 프롬프트·검사 질문)과 borti-ref.png 를 같이 올린다.
# 결과: /kaggle/working/out/<id>.webp + out/verdicts.json (러너가 kaggle kernels output 으로 받아 scripts/kaggle.mjs collect 가 올린다)
import base64, gc, gzip, io, json, os, random, re, subprocess, sys, time

PAYLOAD = ''  # @@PAYLOAD@@
OUT = '/kaggle/working/out'
CAND = '/tmp/cand'
DRAW_REPO = 'black-forest-labs/FLUX.2-klein-4B'  # Apache-2.0 · 공개(gated 아님)
JUDGE_REPO = 'Qwen/Qwen2.5-VL-7B-Instruct'  # Apache-2.0 · 공개
os.makedirs(OUT, exist_ok=True)
os.makedirs(CAND, exist_ok=True)


def sh(*a):
    return subprocess.run(list(a), check=False, capture_output=True, text=True)


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

# 스크립트 커널은 코드 파일 하나만 올라간다 → 러너가 PAYLOAD 줄에 jobs + 참고 그림(gzip+base64)을 넣어 보낸다
_p = json.loads(gzip.decompress(base64.b64decode(PAYLOAD)))
jobs = _p['jobs']
ref = Image.open(io.BytesIO(base64.b64decode(_p['ref']))).convert('RGB')
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
CALIB = all('image' in j for j in jobs)  # 보정 모드: 이미 올라간 그림만 검사에 돌린다(그리기 없음)
meta['calibrate'] = CALIB
if CALIB:
    for j in jobs:
        f = f'{CAND}/{j["id"]}_0.png'
        Image.open(io.BytesIO(base64.b64decode(j['image']))).convert('RGB').save(f)
        items[j['id']]['cands'].append({'file': f, 'seed': 0, 'draw_sec': 0, 'blank': False})
    save()
else:
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

# ── 2) 엄격 2단계 검사(열린 비전 모델) ─────────────────────────────────────────
from transformers import AutoProcessor, BitsAndBytesConfig, Qwen2_5_VLForConditionalGeneration  # noqa: E402

t0 = time.time()
proc = AutoProcessor.from_pretrained(JUDGE_REPO, min_pixels=256 * 28 * 28, max_pixels=768 * 28 * 28)
if n_gpu > 1 and os.environ.get('WORTY_JUDGE_4BIT') != '1':
    # fp16 7B ≈ 15.5GB — 두 T4 에 나눠 올린다(4비트보다 판정이 덜 흐려진다)
    judge = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        JUDGE_REPO, torch_dtype=torch.float16, device_map='auto', max_memory={0: '13GiB', 1: '13GiB'})
    meta['judge_mode'] = 'fp16_split'
else:
    judge = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        JUDGE_REPO,
        quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_compute_dtype=torch.float16),
        torch_dtype=torch.float16, device_map='auto')
    meta['judge_mode'] = '4bit'
meta['load_judge_sec'] = round(time.time() - t0, 1)
print('검사 모델 로드', meta['load_judge_sec'], 's', flush=True)


def parse(text):
    m = re.search(r'\{.*\}', text, re.S)
    if m:
        try:
            d = json.loads(m.group(0))  # 한 개짜리 배열의 안쪽 객체
            if isinstance(d, dict) and isinstance(d.get('ok'), bool):
                return d
        except Exception:  # noqa: BLE001
            pass
    # 잘린 답(why 가 길어 토큰이 끊김)도 불리언 칸만 건진다
    d = {}
    for k in ('ok', 'key_visible', 'guessable', 'body_ok', 'text_ok'):
        mm = re.search(r'"%s"\s*:\s*(true|false)' % k, text)
        if mm:
            d[k] = mm.group(1) == 'true'
    if 'ok' in d:
        d['why'] = 'truncated'
        return d
    return None


def gen(img, parts, max_new=300):
    msgs = [{'role': 'user', 'content': parts}]
    text = proc.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    inp = proc(text=[text], images=[img], return_tensors='pt').to(judge.device)
    with torch.no_grad():
        out = judge.generate(**inp, max_new_tokens=max_new, do_sample=False)
    return proc.batch_decode(out[:, inp.input_ids.shape[1]:], skip_special_tokens=True)[0]


def mcq(img, j):
    """눈가림 객관식 — 정답 단어 하나 + 다른 단어 5개 중 그림이 어느 것인지 단어를 모르는 채 고르게 한다.
    순서를 바꿔 두 번 맞혀야 통과(그림이 막연하면 X). 반환: [정답 여부, 정답 여부]"""
    opts = [(j['word'], j['meaning_ko'])] + [(o['word'], o['meaning_ko']) for o in j.get('distractors', [])][:5]
    letters = 'ABCDEF'
    res = []
    for rot in (0, 1):
        order = opts[:]
        random.Random(f'{j["id"]}{rot}').shuffle(order)
        lines = '\n'.join(f'{letters[i]}. {w} — {m}' for i, (w, m) in enumerate(order))
        q = ('This doodle was drawn to illustrate exactly ONE of the following German words, like a picture dictionary.\n' + lines +
             '\nWhich one is it? Answer with ONE letter only. If the picture is generic (for example the puppy just stands, sits or wears something) '
             'and none of the options is clearly shown, answer X.')
        ans = gen(img, [{'type': 'image', 'image': img}, {'type': 'text', 'text': q}], 6).strip()[:1].upper()
        res.append(ans == letters[order.index(opts[0])])
    return res


def ask(j, f):
    """1단계 = 단어 없이 그림만 묘사 · 2단계 = 눈가림 객관식 · 3단계 = 묘사 + 의도한 장면·뜻으로 판정. 최종 ok 는 모두 통과할 때만"""
    img = Image.open(f).convert('RGB')
    desc = gen(img, [{'type': 'image', 'image': img}, {'type': 'text', 'text': j['desc_prompt']}], 260).strip()
    picks = mcq(img, j)
    raw = gen(img, [{'type': 'text', 'text': '#1'}, {'type': 'image', 'image': img}, {'type': 'text', 'text': j['check_prompt'].replace('{DESC}', desc)}], 450)
    v = parse(raw)
    if v:
        v['mcq'] = picks
        # 모델이 적은 ok 는 무시(보정 실측: 칸이 모두 true 인데 ok=false 로 적은 경우가 있었다) — 칸과 객관식으로만 정한다
        v['ok'] = all(picks) and all(v.get(k) is not False for k in ('key_visible', 'guessable', 'body_ok', 'text_ok'))
    return v, raw, desc


judge_secs = []
for j in jobs:
    it = items[j['id']]
    chosen = None
    for c in it['cands']:
        if c['blank']:
            c['verdict'] = {'ok': False, 'why': '빈 그림'}
            continue
        s = time.time()
        v, raw, desc = ask(j, c['file'])
        c['desc'] = desc
        c['judge_sec'] = round(time.time() - s, 2)
        judge_secs.append(c['judge_sec'])
        c['verdict'] = v or {'ok': None, 'why': 'parse', 'raw': raw[:300]}
        print(f'검사 {j["id"]} {c["judge_sec"]}s {c["verdict"]}', flush=True)
        print('   묘사:', desc[:400], flush=True)
        if v and v['ok']:
            chosen = c
            break
    pick = chosen or next((c for c in it['cands'] if not c['blank']), None)
    it['ok'] = bool(chosen)
    it['verdict'] = pick['verdict'] if pick else {'ok': False, 'why': '빈 그림'}
    it['tries'] = len(it['cands'])
    if pick and not CALIB:
        Image.open(pick['file']).convert('RGB').save(f'{OUT}/{j["id"]}.webp', quality=92)
    save()
meta['judge_sec_avg'] = round(sum(judge_secs) / max(1, len(judge_secs)), 2)
meta['judged'] = len(judge_secs)
save()
json.dump(jobs, open(f'{OUT}/jobs.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('끝', json.dumps(meta, ensure_ascii=False), flush=True)
