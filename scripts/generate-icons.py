"""Generate desktop icon formats with the same notched TRAE mark as the UI.
Requires Pillow only when regenerating committed icon assets.
"""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
icon = Image.new('RGBA', (1024, 1024))
draw = ImageDraw.Draw(icon)
draw.rounded_rectangle((0, 0, 1023, 1023), radius=210, fill='#ff2442')
scale = 26
ox, oy = 148, 230

def points(values):
    return [(round(ox+x*scale), round(oy+y*scale)) for x,y in values]

draw.polygon(points([(0,.846),(28,.846),(28,20.846),(4,20.846),(4,16.848),(0,16.848)]), fill='white')
draw.polygon(points([(4,4.845),(24,4.845),(24,16.848),(4,16.848)]), fill='#ff2442')
for cx in [11.173,19.173]:
    draw.polygon(points([(cx,7.957),(cx+2.829,10.786),(cx,13.615),(cx-2.829,10.786)]), fill='white')
icon.save(root/'build/icon.png')
icon.save(root/'build/icon.ico', sizes=[(n,n) for n in [16,24,32,48,64,128,256]])
icon.save(root/'build/icon.icns')
for size in [16,24,32,48,64,128,256,512]:
    icon.resize((size,size),Image.Resampling.LANCZOS).save(root/f'build/icons/{size}x{size}.png')
