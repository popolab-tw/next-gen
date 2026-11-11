# NEXT GEN 用的圖片與 QR Code（主視覺或網址改了才需要重跑）
#   python3 build/ng_assets.py 主視覺.png
# 產生 src/ng/：
#   kv-640.webp、kv-1280.webp — 遊戲頁下方 NEXT GEN 小欄的主視覺小圖（1x、2x）
#   kv-1920.webp              — NEXT GEN 開場標題畫面的背景
#   og.jpg                    — NEXT GEN 分享到社群時的預覽圖（1200×630）
#   qr-map.svg、qr-game.svg   — 兩個網站的 QR Code（網址來自 build/web.config.json）
import sys, os, json
from PIL import Image
import segno

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'ng')
os.makedirs(OUT, exist_ok=True)
cfg = json.load(open(os.path.join(ROOT, 'build', 'web.config.json'), encoding='utf8'))
site = cfg['siteUrl'].rstrip('/') + '/'
ng = cfg.get('nextgenUrl') or site + 'map/'

if len(sys.argv) > 1:
    kv = Image.open(sys.argv[1]).convert('RGB')
    w, h = kv.size
    for tw, q in ((640, 78), (1280, 80), (1920, 82)):
        kv.resize((tw, round(h * tw / w)), Image.LANCZOS).save(os.path.join(OUT, 'kv-%d.webp' % tw), 'WEBP', quality=q, method=6)
    # 社群預覽 1200×630：寬度縮到 1200，上下各切一點
    s = kv.resize((1200, round(h * 1200 / w)), Image.LANCZOS)
    top = (s.size[1] - 630) // 2
    s.crop((0, top, 1200, top + 630)).save(os.path.join(OUT, 'og.jpg'), 'JPEG', quality=86, optimize=True, progressive=True)

def qr(url, name):
    q = segno.make(url, error='m')
    svg = q.svg_inline(scale=1, border=0, dark='#000', light=None, omitsize=True).replace('stroke="#000"', 'stroke="currentColor"')
    assert 'currentColor' in svg
    open(os.path.join(OUT, name), 'w', encoding='utf8').write(svg)
    print(name, url, q.version, q.error)
qr(ng, 'qr-map.svg')
qr(site, 'qr-game.svg')
for f in sorted(os.listdir(OUT)): print(f, os.path.getsize(os.path.join(OUT, f)))
