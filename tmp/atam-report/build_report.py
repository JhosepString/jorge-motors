from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE as RT

ROOT = Path(r'C:\Users\josen\OneDrive\Documents\CURSOS\Arquitectura de software\proyecto_final\jorge-motors')
OUT = ROOT / 'docs' / 'Pruebas_ATAM_Jorge_Motors.docx'
SCREENSHOT = ROOT / 'frontend' / 'test-results' / 'inventario-admin.png'

def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:fill'), fill)
    tcPr.append(shd)

def borders(cell):
    tcPr = cell._tc.get_or_add_tcPr()
    bd = OxmlElement('w:tcBorders')
    for side in ('top', 'left', 'bottom', 'right'):
        node = OxmlElement(f'w:{side}')
        node.set(qn('w:val'), 'single')
        node.set(qn('w:sz'), '4')
        node.set(qn('w:color'), 'D9D9D9')
        bd.append(node)
    tcPr.append(bd)

def hyperlink(p, title, url):
    rid = p.part.relate_to(url, RT.HYPERLINK, is_external=True)
    h = OxmlElement('w:hyperlink')
    h.set(qn('r:id'), rid)
    r = OxmlElement('w:r')
    rpr = OxmlElement('w:rPr')
    c = OxmlElement('w:color'); c.set(qn('w:val'), '215C93'); rpr.append(c)
    u = OxmlElement('w:u'); u.set(qn('w:val'), 'single'); rpr.append(u)
    r.append(rpr)
    t = OxmlElement('w:t'); t.text = title; r.append(t)
    h.append(r); p._p.append(h)

def table(headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    for i, h in enumerate(headers):
        t.columns[i].width = Inches(widths[i])
        c = t.rows[0].cells[i]; c.width = Inches(widths[i]); c.text = h
        shade(c, 'DCEAF3'); borders(c); c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        for r in c.paragraphs[0].runs: r.bold = True
    t.rows[0]._tr.get_or_add_trPr().append(OxmlElement('w:tblHeader'))
    for n, row in enumerate(rows):
        cells = t.add_row().cells
        for i, value in enumerate(row):
            cells[i].width = Inches(widths[i]); cells[i].text = value
            borders(cells[i]); cells[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if n % 2: shade(cells[i], 'F7FAFC')
    doc.add_paragraph()
    return t

doc = Document()
sec = doc.sections[0]
sec.page_width = Inches(8.5); sec.page_height = Inches(11)
sec.top_margin = Inches(.75); sec.bottom_margin = Inches(.65)
sec.left_margin = Inches(.8); sec.right_margin = Inches(.8)

styles = doc.styles
normal = styles['Normal']; normal.font.name = 'Aptos'; normal.font.size = Pt(9.5)
normal.font.color.rgb = RGBColor(20, 30, 39)
normal.paragraph_format.space_after = Pt(5)
for name, size, before, after in [('Title', 20, 0, 8), ('Heading 1', 12.5, 12, 5), ('Heading 2', 10.5, 9, 4)]:
    s = styles[name]; s.font.name = 'Aptos Display' if name == 'Title' else 'Aptos'
    s.font.size = Pt(size); s.font.bold = True; s.font.color.rgb = RGBColor(0, 0, 0)
    s.paragraph_format.space_before = Pt(before); s.paragraph_format.space_after = Pt(after)
    if name == 'Title':
        ppr = s._element.get_or_add_pPr()
        for child in list(ppr):
            if child.tag == qn('w:pBdr'):
                ppr.remove(child)
styles['Caption'].font.color.rgb = RGBColor(0, 0, 0)
for sname in ('List Bullet', 'List Number'):
    styles[sname].font.name = 'Aptos'; styles[sname].font.size = Pt(9.5)

header = sec.header.paragraphs[0]
header.text = 'JORGE MOTORS  |  EVIDENCIA DEL TALLER ATAM'
header.style = 'Caption'; header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
for run in header.runs: run.font.color.rgb = RGBColor(0, 0, 0)
footer = sec.footer.paragraphs[0]
footer.text = 'Pruebas ejecutadas el 5 de noviembre de 2026'
footer.style = 'Caption'; footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
for run in footer.runs: run.font.color.rgb = RGBColor(0, 0, 0)

doc.add_paragraph('Pruebas del taller ATAM Jorge Motors', 'Title')
doc.add_paragraph('Informe de verificación del documento Taller ATAM aplicado a Jorge Motors')
doc.add_paragraph('Se comprobaron los escenarios ejecutables con el repositorio local. Pasaron 236 pruebas automatizadas: 102 de backend, 119 sobre SQL Server local, 6 de frontend y 9 de navegador. La medición de rendimiento, el correo real, la restauración y la continuidad ante una PC apagada siguen pendientes de pruebas de extremo a extremo.')

doc.add_paragraph('Matriz de escenarios', 'Heading 1')
table(['Escenario', 'Resultado', 'Límite de la prueba'], [
    ('Stock 3; dos mecánicos retiran 2', 'Aprobado: una salida, un rechazo; stock final 1 y un movimiento.', 'Dos perfiles ficticios sobre una base SQL efímera.'),
    ('Anónimo o mecánico registra entrada', 'Aprobado: HTTP 401 o 403; stock intacto y rechazo auditado.', 'Tokens firmados de prueba; MFA real no se ejecutó.'),
    ('Falla el correo de bajo stock', 'Aprobado: Outbox durable, lease recuperable y máximo 5 intentos.', 'Transporte ficticio; no llegó correo a un proveedor.'),
    ('PC de API apagada o SQL pausada', 'Pendiente: la prueba de health no cubre continuidad.', 'La API continúa en una PC; no se probó restauración.'),
    ('20 consultas; p95 menor o igual a 2 s', 'Prueba lista para ejecutar con una sesión real de Entra.', '20 solicitudes simultáneas, no 20 usuarios distintos.'),
    ('Nuevo formato CSV', 'Pendiente: CSV aún no existe; PDF y XLSX sí pasan regresión.', 'Requiere implementar el formato y repetir las pruebas.'),
], [2.0, 2.65, 2.25])

doc.add_paragraph('Evidencia ejecutada', 'Heading 1')
table(['Comando', 'Resultado'], [
    ('backend: pnpm.cmd check', '102/102; tipos y compilación correctos'),
    ('backend: pnpm.cmd test:sql', '119/119; bases temporales eliminadas'),
    ('frontend: pnpm.cmd check', '6/6; tipos y compilación correctos'),
    ('frontend: pnpm.cmd test:e2e', '9/9; API simulada en flujos de pantalla'),
    ('pnpm.cmd audit --prod --audit-level=high', 'Backend y frontend sin vulnerabilidades conocidas tras actualizar dependencias'),
], [3.2, 3.7])

doc.add_page_break()
doc.add_paragraph('Ubicación del código y las pruebas', 'Heading 1')
for title, path, detail in [
    ('Integridad y concurrencia', 'backend/tests/integration/inventory-sql.test.ts', 'Dos mecánicos, idempotencia, rollback e historial inmutable. Implementación en backend/src/infrastructure/database/sql-inventory.ts y backend/src/modules/inventario/application/inventario.facade.ts.'),
    ('Seguridad y perfiles', 'backend/tests/auth.test.ts', 'Valida tokens y roles; backend/src/middleware/authentication.ts aplica identidad, perfil y permisos. HTTP+SQL verifica 401, 403 y auditoría.'),
    ('Alertas y reintentos', 'backend/tests/integration/outbox-sql.test.ts', 'Simula fallos, cinco intentos y recuperación de lease. El worker está en backend/src/modules/alertas/application/notification-worker.ts.'),
    ('Reportes', 'backend/src/modules/reportes/infrastructure/report-strategies.ts', 'Las estrategias PDF y XLSX pasan pruebas. El contrato de formatos todavía no acepta CSV.'),
    ('Medidor de rendimiento', 'backend/src/cli/atam-load-check.ts', 'Autenticación interactiva, 20 lecturas simultáneas y cálculo de p95; no imprime el token.'),
]:
    p = doc.add_paragraph(); p.add_run(title + '. ').bold = True; p.add_run(path + '. ' + detail)

doc.add_paragraph('Captura de la prueba de navegador', 'Heading 1')
doc.add_picture(str(SCREENSHOT), width=Inches(6.8))
p = doc.add_paragraph('Pantalla de inventario del Administrador en Playwright. Los datos y respuestas de API de esta captura son simulados; la concurrencia y persistencia se verificaron por separado en SQL local.')
p.style = 'Caption'

doc.add_page_break()
doc.add_paragraph('Pruebas pendientes y cómo ejecutarlas', 'Heading 1')
doc.add_paragraph('Rendimiento con sesión real', 'Heading 2')
doc.add_paragraph('Con la API local iniciada y conectada a Azure SQL, ejecutar desde backend: pnpm.cmd atam:load. Microsoft abre el navegador para iniciar sesión. El programa realiza una lectura de calentamiento, lanza 20 lecturas concurrentes de stock y muestra errores, p95 y cumplimiento de 2000 ms. Cada lectura conserva la auditoría normal del sistema.')
doc.add_paragraph('Disponibilidad y recuperación', 'Heading 2')
doc.add_paragraph('En un entorno de ensayo, medir fallos y tiempo de recuperación al detener y reiniciar la API. Medir por separado la primera consulta tras una pausa real de Azure SQL. Restaurar la base en una copia de ensayo y comparar recuentos y saldos. Esas acciones no se efectuaron en la base de demostración.')
doc.add_paragraph('Correo real y CSV', 'Heading 2')
doc.add_paragraph('Al integrar el transporte real, provocar un error controlado y verificar recepción posterior y estado del Outbox. Al añadir CSV, repetir la regresión PDF/XLSX y probar contenido, permisos y auditoría del nuevo formato.')

doc.add_paragraph('Hallazgo de seguridad corregido', 'Heading 1')
doc.add_paragraph('La primera auditoría detectó dos dependencias transitivas vulnerables. Se actualizó Azure Identity a 4.14.1 y se fijó body-parser en 2.4.0. La segunda auditoría de dependencias de producción no reportó vulnerabilidades conocidas.')
p = doc.add_paragraph('Referencias: ')
hyperlink(p, 'Aviso body-parser', 'https://github.com/advisories/GHSA-27r3-jxmh-p828')
p.add_run('  ·  ')
hyperlink(p, 'Aviso MSAL Node', 'https://github.com/advisories/GHSA-xcx6-jx8p-x3h5')

doc.add_paragraph('Alcance de la conclusión', 'Heading 1')
doc.add_paragraph('La evidencia automatizada respalda integridad de stock, autorización y comportamiento del Outbox sobre SQL Server local. No demuestra por sí sola MFA interactivo, entrega de correo, continuidad entre PCs, restauración de Azure SQL ni p95 en nube. Esos resultados se completan con las pruebas pendientes indicadas arriba.')

OUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUT)
print(OUT)
