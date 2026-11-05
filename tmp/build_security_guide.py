from pathlib import Path
import re
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE as RT

root = Path(__file__).resolve().parents[1]
source = root / 'docs/guia-pruebas-seguridad-patrones.md'
output = root / 'docs/Guia_Pruebas_Seguridad_y_Patrones_Jorge_Motors.docx'
art = root / 'tmp/security-guide-art'
art.mkdir(parents=True, exist_ok=True)

font_file = Path('C:/Windows/Fonts/arial.ttf')
bold_file = Path('C:/Windows/Fonts/arialbd.ttf')
font = ImageFont.truetype(str(font_file), 29)
small = ImageFont.truetype(str(font_file), 24)
bold = ImageFont.truetype(str(bold_file), 31)

def rounded(draw, xy, label, fill, width=360, height=96):
    x, y = xy
    draw.rounded_rectangle((x, y, x + width, y + height), 14, fill=fill)
    box = draw.textbbox((0, 0), label, font=bold)
    draw.text((x + (width - (box[2]-box[0]))/2, y + (height - (box[3]-box[1]))/2 - 4), label, font=bold, fill='white')

def diagram_security(path):
    im = Image.new('RGB', (1600, 520), 'white')
    d = ImageDraw.Draw(im)
    navy, blue, teal = '#163A5F', '#2167A7', '#237C83'
    rounded(d, (50, 80), 'React local', navy)
    rounded(d, (620, 80), 'API Express local', blue)
    rounded(d, (1190, 80), 'Azure SQL', teal)
    d.line((410, 128, 620, 128), fill='#657484', width=7)
    d.polygon([(620,128),(596,114),(596,142)], fill='#657484')
    d.text((432, 145), 'Bearer JWT', font=small, fill='#34465A')
    d.line((980, 128, 1190, 128), fill='#657484', width=7)
    d.polygon([(1190,128),(1166,114),(1166,142)], fill='#657484')
    d.text((1000, 145), 'TLS y Entra', font=small, fill='#34465A')
    rounded(d, (50, 315), 'Microsoft Entra', teal)
    d.line((230, 315, 230, 176), fill='#657484', width=7)
    d.polygon([(230,176),(216,201),(244,201)], fill='#657484')
    d.text((435, 350), 'Firma, tenant, audiencia, ámbito, perfil y rol', font=font, fill='#163A5F')
    d.text((435, 397), 'MFA ocurre en Microsoft; el servidor valida el token.', font=small, fill='#45576A')
    im.save(path)

def diagram_patterns(path):
    im = Image.new('RGB', (1600, 510), 'white')
    d = ImageDraw.Draw(im)
    names = [('Cadena HTTP','#183C60'),('Facade','#2167A7'),('Repository','#237C83'),('Azure SQL','#315D77')]
    for i, (name, color) in enumerate(names):
        x = 45 + i*390
        rounded(d, (x, 60), name, color, 320, 100)
        if i < 3:
            d.line((x+320,110,x+390,110), fill='#667789', width=6)
            d.polygon([(x+390,110),(x+372,99),(x+372,121)], fill='#667789')
    d.line((585, 160, 585, 285), fill='#667789', width=6)
    d.polygon([(585,285),(573,264),(597,264)], fill='#667789')
    rounded(d, (410, 285), 'Observer', '#4B73A0', 350, 90)
    d.line((760,330,835,330), fill='#667789', width=6)
    d.polygon([(835,330),(817,319),(817,341)], fill='#667789')
    rounded(d, (835, 285), 'State y Outbox', '#537C86', 420, 90)
    d.text((45, 427), 'Singleton reutiliza el pool SQL. Strategy exporta el reporte en PDF o XLSX.', font=font, fill='#183C60')
    im.save(path)

security_img = art / 'security.png'
patterns_img = art / 'patterns.png'
diagram_security(security_img)
diagram_patterns(patterns_img)

doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Inches(8.5), Inches(11)
sec.top_margin = Inches(.72)
sec.bottom_margin = Inches(.68)
sec.left_margin = sec.right_margin = Inches(.78)

styles = doc.styles
styles['Normal'].font.name = 'Arial'
styles['Normal'].font.size = Pt(10.2)
styles['Normal'].font.color.rgb = RGBColor(34, 42, 50)
styles['Normal'].paragraph_format.space_after = Pt(7)
styles['Normal'].paragraph_format.line_spacing = 1.14
for name, size, before, after in [('Title',20,0,13),('Heading 1',15,16,8),('Heading 2',12,11,5),('Heading 3',10.7,9,4)]:
    s = styles[name]
    s.font.name = 'Arial'
    s.font.size = Pt(size)
    s.font.bold = True
    s.font.color.rgb = RGBColor(0,0,0)
    s.paragraph_format.space_before = Pt(before)
    s.paragraph_format.space_after = Pt(after)
    s.paragraph_format.keep_with_next = True
    if name == 'Title':
        ppr = s.element.pPr
        if ppr is not None:
            for border in ppr.findall(qn('w:pBdr')):
                ppr.remove(border)
if 'Code' not in styles:
    s = styles.add_style('Code', WD_STYLE_TYPE.PARAGRAPH)
else:
    s = styles['Code']
s.font.name = 'Consolas'
s.font.size = Pt(8.2)
s.font.color.rgb = RGBColor(25, 46, 64)
s.paragraph_format.space_after = Pt(7)
s.paragraph_format.left_indent = Inches(.18)
s.paragraph_format.line_spacing = 1.0

def hyperlink(p, label, target):
    if target.startswith('../'):
        target = (root / 'docs' / target).resolve().as_uri()
    rid = p.part.relate_to(target, RT.HYPERLINK, is_external=True)
    h = OxmlElement('w:hyperlink')
    h.set(qn('r:id'), rid)
    r = OxmlElement('w:r')
    pr = OxmlElement('w:rPr')
    c = OxmlElement('w:color'); c.set(qn('w:val'), '1769AA'); pr.append(c)
    u = OxmlElement('w:u'); u.set(qn('w:val'), 'single'); pr.append(u)
    r.append(pr)
    t = OxmlElement('w:t'); t.text = label; r.append(t); h.append(r)
    p._p.append(h)

token = re.compile(r'(\[([^]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*)')
def inline(p, text):
    cursor = 0
    for m in token.finditer(text):
        if m.start() > cursor:
            p.add_run(text[cursor:m.start()])
        if m.group(2):
            hyperlink(p, m.group(2), m.group(3))
        elif m.group(4):
            r = p.add_run(m.group(4)); r.font.name = 'Consolas'; r.font.size = Pt(8.7)
        else:
            r = p.add_run(m.group(5)); r.bold = True
        cursor = m.end()
    if cursor < len(text): p.add_run(text[cursor:])

def paragraph(text, style=None):
    p = doc.add_paragraph(style=style)
    inline(p, text)
    return p

def figure(path, caption):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = True
    p.add_run().add_picture(str(path), width=Inches(6.85))
    c = doc.add_paragraph(caption)
    c.alignment = WD_ALIGN_PARAGRAPH.CENTER
    c.runs[0].italic = True
    c.runs[0].font.size = Pt(8.5)

lines = source.read_text(encoding='utf-8').splitlines()
doc.add_paragraph('Jorge Motors  Guía de pruebas de seguridad y patrones', style='Title')
paragraph('Procedimiento para comprobar la API, Azure SQL y los patrones del proyecto. La guía separa las pruebas ejecutadas el 5 de noviembre de 2026 de las que requieren una persona para completar Microsoft Entra y MFA.')
figure(security_img, 'Figura 1. Recorrido actual de identidad y datos en la demostración local')
paragraph('Código fuente: la rama local contiene la implementación documentada. Los enlaces al código abren archivos de esta PC; al compartir el documento, conserva la estructura del repositorio. La rama pública main todavía no contiene esta implementación completa.')

buffer = []
code = []
in_code = False
in_table = False
def flush():
    global buffer
    if buffer:
        paragraph(' '.join(buffer))
        buffer = []

for line in lines:
    if line.startswith('# '):
        continue
    if line.startswith('```'):
        flush()
        if in_code:
            p=doc.add_paragraph(style='Code')
            p.paragraph_format.keep_together = True
            p.add_run('\n'.join(code))
            code=[]
        in_code = not in_code
        continue
    if in_code:
        code.append(line)
        continue
    if line.startswith('|'):
        flush()
        if line.startswith('| Patrón') or line.startswith('| ---'):
            continue
        cols = [x.strip() for x in line.strip('|').split('|')]
        if len(cols) == 4:
            title = re.sub(r'\*\*', '', cols[0])
            doc.add_paragraph(title, style='Heading 2')
            paragraph(cols[1])
            paragraph('Código: ' + cols[2])
            paragraph('Prueba: ' + cols[3])
        continue
    if line.startswith('## '):
        flush()
        title = re.sub(r'[^\w\sÁÉÍÓÚáéíóúñÑ]', ' ', line[3:])
        title = re.sub(r'\s+', ' ', title).strip()
        doc.add_paragraph(title, style='Heading 1')
        if line.startswith('## 4.'):
            figure(patterns_img, 'Figura 2. Relación entre la cadena HTTP, la operación y los eventos')
        continue
    if line.startswith('### '):
        flush()
        title = re.sub(r'[^\w\sÁÉÍÓÚáéíóúñÑ]', ' ', line[4:])
        doc.add_paragraph(re.sub(r'\s+', ' ', title).strip(), style='Heading 2')
        continue
    if line.startswith('- '):
        flush()
        paragraph(line[2:], 'List Bullet')
        continue
    if not line.strip():
        flush()
        continue
    buffer.append(line.strip())
flush()

footer = sec.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
footer.add_run('Jorge Motors  |  Guía de verificación  |  5 noviembre 2026').font.size = Pt(8)
doc.save(output)
print(output)
