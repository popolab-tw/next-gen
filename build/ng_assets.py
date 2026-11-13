# NEXT GEN 用的圖片與 QR Code（主視覺、頭像或網址改了才需要重跑）
#   python3 build/ng_assets.py [主視覺.png] [--icon 作品集頭像.png]
# 產生 src/ng/：
#   kv-640.webp、kv-1280.webp — 遊戲頁下方 NEXT GEN 小欄的主視覺小圖（1x、2x）
#   kv-1920.webp              — NEXT GEN 開場標題畫面的背景
#   og.jpg                    — NEXT GEN 分享到社群時的預覽圖（1200×630）
#   qr-map.svg、qr-game.svg   — 兩個網站的 QR Code（網址來自 build/web.config.json）
#   qr-portfolio.svg          — 作品集網站的 QR Code（portfolioUrl）
#   pf-48.webp、pf-192.webp    — 作品集頭像（頁首 Portfolio 按鈕、地圖下方作品集小欄；網頁上裁成圓形）
import sys, os, json
from PIL import Image
import segno

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'ng')
os.makedirs(OUT, exist_ok=True)
cfg = json.load(open(os.path.join(ROOT, 'build', 'web.config.json'), encoding='utf8'))
site = cfg['siteUrl'].rstrip('/') + '/'
ng = cfg.get('nextgenUrl') or site + 'map/'

args = sys.argv[1:]
icon = None
if '--icon' in args:
    i = args.index('--icon'); icon = args[i + 1]; del args[i:i + 2]
if icon:
    im = Image.open(icon).convert('RGB')
    s = min(im.size); im = im.crop(((im.size[0] - s) // 2, (im.size[1] - s) // 2, (im.size[0] + s) // 2, (im.size[1] + s) // 2))
    for tw in (48, 192):
        im.resize((tw, tw), Image.LANCZOS).save(os.path.join(OUT, 'pf-%d.webp' % tw), 'WEBP', quality=84, method=6)
if args:
    kv = Image.open(args[0]).convert('RGB')
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
if cfg.get('portfolioUrl'): qr(cfg['portfolioUrl'], 'qr-portfolio.svg')
for f in sorted(os.listdir(OUT)): print(f, os.path.getsize(os.path.join(OUT, f)))
