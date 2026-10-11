import math
O="#1c1826"  # outline
SK="#f0c9a0"; SKS="#d4a27a"
HAIR="#e8d070"; HAIRS="#b8a048"
TUN="#3f9a52"; TUNS="#2b7040"; TUNL="#66c274"
RED="#d8384a"; REDS="#9c2236"; REDL="#f26a78"
BOOT="#6a4630"; BOOTS="#45291a"
W=128
def sw(w): return f'stroke="{O}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"'
def limb(x1,y1,x2,y2,col,w):
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" {sw(w+4)}/>'
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" stroke-width="{w}" stroke-linecap="round"/>')
def glove(x,y,r=11,ang=0):
    return (f'<g transform="translate({x},{y}) rotate({ang})">'
      f'<rect x="{-r-7}" y="-7" width="10" height="14" rx="3" fill="#eee" {sw(2.5)}/>'
      f'<circle r="{r}" fill="{RED}" {sw(3)}/>'
      f'<path d="M{-r+3},{r-4} A{r},{r} 0 0 0 {r-3},{r-4} Q0,{r-9} {-r+3},{r-4}Z" fill="{REDS}"/>'
      f'<ellipse cx="{-r*0.25}" cy="{-r*0.4}" rx="{r*0.45}" ry="{r*0.28}" fill="{REDL}"/>'
      f'<path d="M{-r*0.1},{r*0.1} q{r*0.5},{r*0.2} {r*0.7},{-r*0.2}" stroke="{REDS}" stroke-width="2" fill="none" stroke-linecap="round"/></g>')
def elf(pose):
    t=pose.get('lean',0); sq=pose.get('sq',0); fx,fy=pose['front']; bx,by=pose['back']
    ff=pose.get('ff',10); bf=pose.get('bf',-12)
    hy=36+sq; ty=56+sq
    s=[f'<ellipse cx="64" cy="114" rx="30" ry="5" fill="#000" opacity=".25"/>']
    # back arm + glove
    s.append(limb(64+t-4,ty+4,bx,by,TUNS,8)); s.append(glove(bx,by,10))
    # legs
    s.append(limb(64+t-4,84+sq,64+bf,106,TUNS,10))
    s.append(f'<ellipse cx="{64+bf+3}" cy="108" rx="10" ry="6" fill="{BOOTS}" {sw(3)}/>')
    s.append(limb(64+t+4,84+sq,64+ff,106,TUN,10))
    s.append(f'<ellipse cx="{64+ff+3}" cy="108" rx="11" ry="6" fill="{BOOT}" {sw(3)}/>')
    # torso tunic
    tx=64+t
    s.append(f'<path d="M{tx-15},{ty-6} Q{tx-18},{ty+16} {tx-16},{88+sq} L{tx+16},{88+sq} Q{tx+18},{ty+16} {tx+15},{ty-6} Q{tx},{ty-14} {tx-15},{ty-6}Z" fill="{TUN}" {sw(3)}/>')
    s.append(f'<path d="M{tx-16},{88+sq} Q{tx-17},{ty+16} {tx-14},{ty+6} Q{tx-4},{ty+16} {tx-2},{88+sq}Z" fill="{TUNS}"/>')
    s.append(f'<path d="M{tx+6},{ty-4} Q{tx+11},{ty+8} {tx+10},{ty+16}" stroke="{TUNL}" stroke-width="3" fill="none" stroke-linecap="round"/>')
    s.append(f'<rect x="{tx-16}" y="{80+sq}" width="32" height="6" fill="#8a5a2c" {sw(2.5)}/><rect x="{tx-3}" y="{79+sq}" width="7" height="8" rx="1" fill="#f0c040" {sw(2)}/>')
    # head
    hx=tx+pose.get('hx',2)
    s.append(f'<path d="M{hx-13},{hy+2} L{hx-30},{hy-8} L{hx-12},{hy-8}Z" fill="{SKS}" {sw(3)}/>')  # back ear
    s.append(f'<ellipse cx="{hx}" cy="{hy}" rx="15" ry="16" fill="{SK}" {sw(3)}/>')
    s.append(f'<path d="M{hx+10},{hy-4} L{hx+32},{hy-14} L{hx+13},{hy+8}Z" fill="{SK}" {sw(3)}/>')  # front ear (toward viewer, angled)
    s.append(f'<path d="M{hx+13},{hy-2} L{hx+25},{hy-9} L{hx+14},{hy+4}Z" fill="{SKS}"/>')
    # hair
    s.append(f'<path d="M{hx-16},{hy+2} Q{hx-20},{hy-22} {hx},{hy-20} Q{hx+16},{hy-20} {hx+15},{hy-8} Q{hx+4},{hy-14} {hx-6},{hy-6} Q{hx-9},{hy} {hx-16},{hy+8}Z" fill="{HAIR}" {sw(3)}/>')
    s.append(f'<path d="M{hx-14},{hy-6} Q{hx-12},{hy-16} {hx-2},{hy-17}" stroke="#fff3a8" stroke-width="3" fill="none" stroke-linecap="round"/>')
    # face
    e=pose.get('eye','open')
    if e=='open':
        s.append(f'<ellipse cx="{hx+7}" cy="{hy+1}" rx="3" ry="4" fill="{O}"/><circle cx="{hx+8}" cy="{hy-1}" r="1.2" fill="#fff"/>')
    elif e=='angry':
        s.append(f'<ellipse cx="{hx+7}" cy="{hy+2}" rx="3" ry="3" fill="{O}"/><path d="M{hx+2},{hy-5} L{hx+13},{hy-1}" stroke="{O}" stroke-width="3" stroke-linecap="round"/>')
    else:
        s.append(f'<path d="M{hx+3},{hy+1} L{hx+11},{hy+1}" stroke="{O}" stroke-width="3" stroke-linecap="round"/>')
    mo=pose.get('mouth','smile')
    if mo=='smile': s.append(f'<path d="M{hx+4},{hy+9} q4,4 8,0" stroke="{O}" stroke-width="2.5" fill="none" stroke-linecap="round"/>')
    else: s.append(f'<ellipse cx="{hx+8}" cy="{hy+10}" rx="4" ry="3.5" fill="{O}"/><ellipse cx="{hx+8}" cy="{hy+11.5}" rx="2.2" ry="1.3" fill="#e0606a"/>')
    s.append(f'<circle cx="{hx+3}" cy="{hy+7}" r="3" fill="#f08a80" opacity=".5"/>')
    # front arm
    s.append(limb(tx+8,ty+2,fx,fy,TUNL,8)); s.append(glove(fx,fy,12))
    return ''.join(s)
def goblin(hit=False):
    G="#7cb342";GS="#558b2f";GL="#a4d65e"
    x=-4 if hit else 0
    s=[f'<ellipse cx="64" cy="114" rx="26" ry="5" fill="#000" opacity=".25"/>']
    s.append(f'<g transform="translate({x},0)">')
    s.append(limb(58,88,54,108,GS,10)); s.append(limb(72,88,78,108,G,10))
    s.append(f'<ellipse cx="51" cy="109" rx="9" ry="5" fill="{BOOTS}" {sw(3)}/><ellipse cx="81" cy="109" rx="9" ry="5" fill="{BOOT}" {sw(3)}/>')
    s.append(f'<path d="M48,66 Q44,92 52,94 L80,94 Q88,90 82,64 Q65,56 48,66Z" fill="#8a5a2c" {sw(3)}/><path d="M50,80 Q65,86 82,78" stroke="#5a3a1c" stroke-width="3" fill="none"/>')
    s.append(limb(50,70,36,84,GS,8)); s.append(limb(80,70,96,54,G,8))
    # club
    s.append(f'<g transform="rotate(-20 100 50)"><rect x="97" y="16" width="9" height="44" rx="3" fill="#8b5e34" {sw(3)}/><ellipse cx="101.5" cy="20" rx="11" ry="15" fill="#a9763e" {sw(3)}/><circle cx="96" cy="16" r="2" fill="#ddd"/><circle cx="107" cy="24" r="2" fill="#ddd"/></g>')
    s.append(f'<circle cx="96" cy="55" r="6" fill="{G}" {sw(3)}/>')
    # head
    s.append(f'<path d="M50,50 L26,38 L48,60Z" fill="{GS}" {sw(3)}/><path d="M80,50 L104,40 L82,60Z" fill="{G}" {sw(3)}/>')
    s.append(f'<ellipse cx="65" cy="50" rx="18" ry="17" fill="{G}" {sw(3)}/><ellipse cx="60" cy="42" rx="8" ry="4" fill="{GL}"/>')
    if hit:
        s.append(f'<path d="M55,46 l8,8 m0,-8 l-8,8 M70,46 l8,8 m0,-8 l-8,8" stroke="{O}" stroke-width="3" stroke-linecap="round"/><ellipse cx="68" cy="62" rx="5" ry="4" fill="{O}"/>')
    else:
        s.append(f'<circle cx="58" cy="49" r="5" fill="#fff" {sw(2)}/><circle cx="74" cy="49" r="5" fill="#fff" {sw(2)}/><circle cx="59" cy="50" r="2.3" fill="{O}"/><circle cx="75" cy="50" r="2.3" fill="{O}"/><path d="M52,42 L63,46 M80,42 L69,46" stroke="{O}" stroke-width="3" stroke-linecap="round"/>')
        s.append(f'<path d="M56,59 Q66,66 76,59" stroke="{O}" stroke-width="3" fill="#3a1420" stroke-linecap="round"/><path d="M59,60 l2,5 l2,-5 M70,60 l2,4 l2,-4" fill="#fff" stroke="#fff" stroke-width="1"/>')
    s.append('</g>')
    return ''.join(s)
def log(state):
    B="#a9763e";BS="#7a5028";BL="#c99458"
    s=[f'<ellipse cx="64" cy="112" rx="34" ry="6" fill="#000" opacity=".25"/>']
    def cyl(x,rot=0,w=70,h=46):
        return (f'<g transform="rotate({rot} {x} 88)">'
          f'<rect x="{x-w/2}" y="{88-h/2}" width="{w}" height="{h}" rx="6" fill="{B}" {sw(3)}/>'
          f'<rect x="{x-w/2+3}" y="{88+h/2-14}" width="{w-6}" height="11" rx="4" fill="{BS}"/>'
          f'<path d="M{x-w/2+8},{88-h/2+8} H{x+w/2-16} M{x-w/2+14},{88-h/2+18} H{x+w/2-8}" stroke="{BL}" stroke-width="3" stroke-linecap="round"/>'
          f'<ellipse cx="{x+w/2}" cy="88" rx="11" ry="{h/2}" fill="#e0b070" {sw(3)}/>'
          f'<ellipse cx="{x+w/2}" cy="88" rx="7" ry="{h/2-8}" fill="none" stroke="{BS}" stroke-width="2"/>'
          f'<ellipse cx="{x+w/2}" cy="88" rx="3" ry="{h/2-17}" fill="none" stroke="{BS}" stroke-width="2"/></g>')
    if state==0: s.append(cyl(58))
    elif state==1: s.append(cyl(54,-4)); s.append(f'<path d="M96,52 l8,-8 M104,62 l12,-4" stroke="#fff" stroke-width="3" stroke-linecap="round"/>')
    elif state==2:
        s.append(cyl(50,-6)); s.append(f'<path d="M74,62 L66,74 L78,82 L68,96 L76,110" stroke="{O}" stroke-width="3" fill="none"/>')
        s.append(f'<path d="M100,50 l10,-10 M108,64 l14,-4 M96,42 l2,-12" stroke="#fff" stroke-width="3" stroke-linecap="round"/>')
    else:
        s.append(cyl(36,-14,44,44)); s.append(cyl(82,10,40,44))
        for (x,y,r) in [(62,48,30),(70,40,-40),(58,30,80),(100,50,10)]:
            s.append(f'<g transform="translate({x},{y}) rotate({r})"><rect width="14" height="5" rx="1.5" fill="{B}" {sw(2.5)}/></g>')
    return ''.join(s)
# props
def tree():
    return (f'<ellipse cx="64" cy="114" rx="24" ry="5" fill="#000" opacity=".25"/><rect x="56" y="76" width="16" height="36" rx="3" fill="#7a5028" {sw(3)}/><rect x="56" y="76" width="6" height="36" fill="#5a3a1c"/>'
      f'<circle cx="44" cy="62" r="20" fill="#2f7a3e" {sw(3)}/><circle cx="84" cy="62" r="20" fill="#2f7a3e" {sw(3)}/><circle cx="64" cy="42" r="26" fill="#3f9a52" {sw(3)}/><circle cx="64" cy="64" r="22" fill="#3f9a52" {sw(3)}/>'
      f'<circle cx="54" cy="34" r="9" fill="#66c274"/><circle cx="36" cy="56" r="6" fill="#4fae5e"/><circle cx="92" cy="70" r="5" fill="#2b7040"/>')
def barrel():
    return (f'<ellipse cx="64" cy="114" rx="26" ry="5" fill="#000" opacity=".25"/><path d="M38,50 Q30,80 38,108 L90,108 Q98,80 90,50Z" fill="#a9763e" {sw(3)}/><path d="M38,50 Q30,80 38,108 L52,108 Q44,80 52,50Z" fill="#7a5028"/>'
      f'<path d="M35,66 H93 M33,92 H95" stroke="{O}" stroke-width="9"/><path d="M35,66 H93 M33,92 H95" stroke="#8a93a0" stroke-width="5"/><ellipse cx="64" cy="50" rx="26" ry="9" fill="#c99458" {sw(3)}/><ellipse cx="64" cy="50" rx="18" ry="5" fill="#8a5a2c"/>'
      f'<path d="M70,70 v20" stroke="#c99458" stroke-width="3" stroke-linecap="round"/>')
def chest():
    return (f'<ellipse cx="64" cy="112" rx="34" ry="6" fill="#000" opacity=".25"/><rect x="26" y="68" width="76" height="42" rx="4" fill="#8a5a2c" {sw(3)}/><path d="M26,68 Q26,40 64,40 Q102,40 102,68Z" fill="#a9763e" {sw(3)}/>'
      f'<path d="M40,46 Q48,42 60,42" stroke="#c99458" stroke-width="3" fill="none" stroke-linecap="round"/>'
      f'<rect x="26" y="64" width="76" height="9" fill="#8a93a0" {sw(3)}/><rect x="44" y="40" width="9" height="70" fill="#8a93a0" {sw(3)}/><rect x="75" y="40" width="9" height="70" fill="#8a93a0" {sw(3)}/>'
      f'<rect x="58" y="62" width="14" height="16" rx="3" fill="#f0c040" {sw(3)}/><circle cx="65" cy="70" r="2.5" fill="{O}"/>')
def torch():
    return (f'<ellipse cx="64" cy="114" rx="14" ry="4" fill="#000" opacity=".25"/><rect x="58" y="60" width="12" height="52" rx="3" fill="#8b5e34" {sw(3)}/><rect x="54" y="56" width="20" height="10" rx="2" fill="#6a7280" {sw(3)}/>'
      f'<path d="M64,8 Q86,34 80,50 Q76,58 64,58 Q50,58 48,46 Q46,34 64,8Z" fill="#f0822a" {sw(3)}/><path d="M64,24 Q78,40 74,50 Q70,56 64,56 Q56,56 55,47 Q54,38 64,24Z" fill="#ffc940"/><path d="M64,40 Q70,48 67,54 Q64,56 61,54 Q59,48 64,40Z" fill="#fff3a8"/>')
def gem():
    return (f'<ellipse cx="64" cy="108" rx="24" ry="5" fill="#000" opacity=".25"/><path d="M64,30 L92,52 L78,96 L50,96 L36,52Z" fill="#35b6e8" {sw(3)}/><path d="M64,30 L92,52 L64,60Z" fill="#7fd8f8"/><path d="M36,52 L64,60 L50,96Z" fill="#1f86b8"/><path d="M92,52 L64,60 L78,96Z" fill="#2a9ed0"/><path d="M50,96 L64,60 L78,96Z" fill="#1a78a8"/><path d="M50,46 l8,-6" stroke="#fff" stroke-width="3" stroke-linecap="round"/>')
def heart():
    return (f'<ellipse cx="64" cy="108" rx="24" ry="5" fill="#000" opacity=".25"/><path d="M64,100 C20,68 30,34 50,34 C60,34 64,42 64,46 C64,42 68,34 78,34 C98,34 108,68 64,100Z" fill="{RED}" {sw(3)}/><path d="M64,100 C100,72 100,44 86,38 C96,60 84,84 64,100Z" fill="{REDS}"/><ellipse cx="46" cy="48" rx="8" ry="5" fill="{REDL}" transform="rotate(-30 46 48)"/>')
def mushroom():
    return (f'<ellipse cx="64" cy="112" rx="24" ry="5" fill="#000" opacity=".25"/><path d="M52,72 Q50,108 56,110 L72,110 Q78,108 76,72Z" fill="#f2e6cf" {sw(3)}/><path d="M22,74 Q22,30 64,30 Q106,30 106,74 Q64,82 22,74Z" fill="{RED}" {sw(3)}/><circle cx="44" cy="52" r="7" fill="#fff"/><circle cx="74" cy="44" r="6" fill="#fff"/><circle cx="88" cy="62" r="5" fill="#fff"/><circle cx="60" cy="66" r="4" fill="#fff"/>')
def crate():
    return (f'<ellipse cx="64" cy="114" rx="34" ry="5" fill="#000" opacity=".25"/><rect x="28" y="50" width="72" height="60" fill="#b98550" {sw(3)}/><rect x="28" y="50" width="72" height="9" fill="#d9a468" {sw(3)}/><path d="M32,56 L96,106 M96,56 L32,106" stroke="#8a5a2c" stroke-width="7"/><rect x="28" y="50" width="72" height="60" fill="none" {sw(3)}/><circle cx="36" cy="58" r="2" fill="{O}"/><circle cx="92" cy="58" r="2" fill="{O}"/><circle cx="36" cy="102" r="2" fill="{O}"/><circle cx="92" cy="102" r="2" fill="{O}"/>')
def tile(kind):
    if kind=='wall':
        r=[f'<rect x="4" y="4" width="120" height="120" fill="#7b8291" {sw(3)}/>']
        for i,(y) in enumerate(range(4,124,30)):
            off=0 if i%2==0 else 30
            r.append(f'<path d="M4,{y} H124" stroke="{O}" stroke-width="3"/>')
            for x in range(4+off,124,60):
                if x>4: r.append(f'<path d="M{x},{y} v30" stroke="{O}" stroke-width="3"/>')
            r.append(f'<path d="M8,{y+5} H52" stroke="#9aa1ae" stroke-width="3" stroke-linecap="round"/>')
        return ''.join(r)
    if kind=='grass':
        r=[f'<rect x="4" y="4" width="120" height="120" fill="#4f9a48" {sw(3)}/>']
        for (x,y) in [(24,30),(60,22),(96,40),(40,62),(84,74),(20,96),(64,100),(104,104),(108,14),(46,44)]:
            r.append(f'<path d="M{x},{y} l-4,-9 M{x},{y} l0,-11 M{x},{y} l4,-9" stroke="#2f7a3e" stroke-width="3" stroke-linecap="round"/><path d="M{x+14},{y+8} l-3,-6" stroke="#7fcf6a" stroke-width="3" stroke-linecap="round"/>')
        return ''.join(r)
    if kind=='planks':
        r=[f'<rect x="4" y="4" width="120" height="120" fill="#b98550" {sw(3)}/>']
        for y in range(4,124,30):
            r.append(f'<path d="M4,{y} H124" stroke="{O}" stroke-width="3"/><path d="M12,{y+10} H60 M70,{y+20} H110" stroke="#d9a468" stroke-width="3" stroke-linecap="round"/><circle cx="{20+ (y*3)%90}" cy="{y+15}" r="2.2" fill="#6a4630"/>')
        return ''.join(r)
    if kind=='water':
        r=[f'<rect x="4" y="4" width="120" height="120" fill="#3a7fc4" {sw(3)}/>']
        for (x,y) in [(18,30),(70,50),(30,86),(76,104),(84,20)]:
            r.append(f'<path d="M{x},{y} q8,-8 16,0 t16,0" stroke="#8ec8f0" stroke-width="3" fill="none" stroke-linecap="round"/>')
        return ''.join(r)
def tower():
    S="#8c93a2";SS="#5f6676";SL="#b2b8c4"
    s=[f'<ellipse cx="64" cy="116" rx="36" ry="5" fill="#000" opacity=".25"/>']
    s.append(f'<path d="M34,112 L38,44 L90,44 L94,112Z" fill="{S}" {sw(3)}/><path d="M34,112 L38,44 L56,44 L52,112Z" fill="{SS}"/><path d="M78,48 L86,48 L88,108" stroke="{SL}" stroke-width="3" fill="none"/>')
    s.append(f'<path d="M30,44 H98 V34 H88 V40 H76 V34 H64 V40 H52 V34 H40 V40 H30Z" fill="{S}" {sw(3)}/>')
    s.append(f'<path d="M26,34 L64,4 L102,34Z" fill="{RED}" {sw(3)}/><path d="M26,34 L64,4 L64,34Z" fill="{REDS}"/>')
    s.append(f'<line x1="64" y1="4" x2="64" y2="-4" stroke="{O}" stroke-width="3"/><path d="M64,-4 l12,4 l-12,4Z" fill="#f0c040" {sw(2)}/>')
    s.append(f'<path d="M56,112 V88 Q64,78 72,88 V112Z" fill="#4a2f1a" {sw(3)}/><path d="M50,62 v12 q5,-6 10,0 v-12 q-5,-6 -10,0Z" fill="#1c1826" transform="translate(16,0)"/>')
    return ''.join(s)
def fx(kind):
    if kind=='impact':
        pts=[]
        for i in range(16):
            a=i*math.pi/8; r=48 if i%2==0 else 24
            pts.append(f'{64+r*math.cos(a):.1f},{64+r*math.sin(a):.1f}')
        return (f'<polygon points="{" ".join(pts)}" fill="#ffd23f" {sw(3)}/><polygon points="'+" ".join(f'{64+(30 if i%2==0 else 15)*math.cos(i*math.pi/8):.1f},{64+(30 if i%2==0 else 15)*math.sin(i*math.pi/8):.1f}' for i in range(16))+f'" fill="#fff3a8"/><text x="64" y="72" text-anchor="middle" font-family="Impact,DejaVu Sans,sans-serif" font-weight="900" font-size="22" fill="{RED}" stroke="{O}" stroke-width="4" paint-order="stroke">POW</text>')
    if kind=='splinters':
        r=[]
        for (x,y,a) in [(30,40,20),(60,30,-50),(90,50,70),(40,80,-20),(80,88,40),(64,62,100),(100,90,-70)]:
            r.append(f'<g transform="translate({x},{y}) rotate({a})"><path d="M0,0 L20,2 L2,7Z" fill="#c99458" {sw(2.5)}/></g>')
        return ''.join(r)
    if kind=='sparkle':
        return ''.join(f'<path d="M{x},{y-r} Q{x},{y} {x+r},{y} Q{x},{y} {x},{y+r} Q{x},{y} {x-r},{y} Q{x},{y} {x},{y-r}Z" fill="#fff3a8" {sw(2.5)}/>' for x,y,r in [(64,60,26),(30,30,12),(98,36,14),(92,94,10)])
    if kind=='dust':
        return ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#d8ccb8" {sw(3)}/>' for x,y,r in [(40,96,14),(64,88,18),(90,98,13),(54,80,9)])
poses=[
 dict(front=(86,66),back=(44,76),ff=8,bf=-14,eye='open',mouth='smile'),
 dict(lean=-6,front=(50,62),back=(84,70),ff=2,bf=-18,sq=2,eye='angry',mouth='smile'),
 dict(lean=8,front=(112,62),back=(40,78),ff=20,bf=-16,eye='angry',mouth='open',hx=4),
 dict(lean=10,front=(116,58),back=(38,80),ff=22,bf=-16,eye='closed',mouth='open',hx=5),
 dict(lean=2,front=(90,70),back=(44,76),ff=10,bf=-14,eye='open',mouth='smile'),
]
rows=[
 ('ELF PUNCH  idle / windup / punch / impact / recover',[elf(p) for p in poses]),
 ('ENEMIES + WOOD  goblin / goblin hit / log / log hit / log cracked',[goblin(),goblin(True),log(0),log(1),log(2)]),
 ('WOOD SPLIT + FX  log split / pow / splinters / sparkle / dust',[log(3),fx('impact'),fx('splinters'),fx('sparkle'),fx('dust')]),
 ('PROPS  tree / barrel / chest / torch / gem',[tree(),barrel(),chest(),torch(),gem()]),
 ('PICKUPS + CASTLE  heart / mushroom / crate / tower / wall tile',[heart(),mushroom(),crate(),tower(),tile('wall')]),
 ('TILES  grass / planks / water / wall / grass',[tile('grass'),tile('planks'),tile('water'),tile('wall'),tile('grass')]),
]
PAD=16; CW=W+8; LBL=26
Wd=PAD*2+5*CW; H=PAD*2+60+len(rows)*(W+LBL+6)
out=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{Wd}" height="{H}" viewBox="0 0 {Wd} {H}">',
 '<defs><pattern id="g" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#2a2638"/><rect width="8" height="8" fill="#2e2a3c"/><rect x="8" y="8" width="8" height="8" fill="#2e2a3c"/></pattern></defs>',
 f'<rect width="{Wd}" height="{H}" fill="url(#g)"/>',
 f'<text x="{PAD}" y="42" font-family="Impact,DejaVu Sans,sans-serif" font-size="22" fill="#ffd23f" stroke="{O}" stroke-width="5" paint-order="stroke" letter-spacing="1">ELF CASTLE WOOD PUNCHER 5000  -  SPRITE SHEET v1</text>']
y=PAD+60
for title,items in rows:
    out.append(f'<text x="{PAD}" y="{y+16}" font-family="DejaVu Sans Mono,monospace" font-size="13" fill="#b9b3d0">{title}</text>')
    for i,it in enumerate(items):
        x=PAD+i*CW
        out.append(f'<g transform="translate({x+4},{y+LBL})"><rect width="{W}" height="{W}" fill="#ffffff" opacity=".04" stroke="#ffffff" stroke-opacity=".12"/>{it}</g>')
    y+=W+LBL+6
out.append('</svg>')
open('sheet.svg','w').write('\n'.join(out))
print(Wd,H)
