import os, sys
from PIL import Image, ImageDraw
src = Image.open('resources/icon.png').convert('RGBA')
res = 'android/app/src/main/res'
sizes = {'mdpi':48,'hdpi':72,'xhdpi':96,'xxhdpi':144,'xxxhdpi':192}
for d,sz in sizes.items():
    p = f'{res}/mipmap-{d}'; os.makedirs(p, exist_ok=True)
    im = src.resize((sz,sz), Image.LANCZOS)
    im.save(f'{p}/ic_launcher.png'); im.save(f'{p}/ic_launcher_foreground.png')
    m = Image.new('L',(sz*4,sz*4),0); ImageDraw.Draw(m).ellipse((0,0,sz*4-1,sz*4-1),fill=255)
    m = m.resize((sz,sz), Image.LANCZOS)
    r = im.copy(); r.putalpha(m); r.save(f'{p}/ic_launcher_round.png')
import shutil
shutil.rmtree(f'{res}/mipmap-anydpi-v26', ignore_errors=True)
print('icons done')
