import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Catálogo ficticio reproducible para revisar volumen y búsqueda antes de cargar Azure.
const groups = [
  ['FIL-ACE', 'Filtros de aceite', 'Filtro de aceite', 220, 'mm', 55, 3, 18.50],
  ['FIL-AIR', 'Filtros de aire motor', 'Filtro de aire motor', 180, 'mm', 120, 5, 24.00],
  ['FIL-CAB', 'Filtros de cabina', 'Filtro de cabina', 160, 'mm', 130, 5, 20.00],
  ['FIL-COM', 'Filtros de combustible', 'Filtro de combustible', 140, 'mm', 48, 2, 32.00],
  ['FIL-TRA', 'Filtros de transmisión', 'Filtro de transmisión', 90, 'mm', 75, 3, 45.00],
  ['FIL-HID', 'Filtros hidráulicos', 'Filtro hidráulico', 80, 'mm', 65, 4, 39.00],
  ['FIL-SEC', 'Secadores de aire', 'Secador de aire', 60, 'mm', 90, 4, 66.00],
  ['FIL-PRE', 'Prefiltros', 'Prefiltro', 70, 'mm', 55, 3, 26.00],
  ['LUB-MOT', 'Aceites de motor', 'Aceite de motor', 220, 'L', 1, 1, 36.00],
  ['LUB-TRA', 'Aceites de transmisión', 'Aceite de transmisión', 140, 'L', 1, 1, 49.00],
  ['LUB-FRE', 'Líquidos de freno', 'Líquido de frenos', 120, 'mL', 250, 50, 17.00],
  ['LUB-REF', 'Refrigerantes', 'Refrigerante', 100, 'L', 1, 1, 29.00],
  ['LUB-GRA', 'Grasas', 'Grasa lubricante', 70, 'g', 100, 25, 21.00],
  ['FRE-PAS', 'Pastillas de freno', 'Juego de pastillas de freno', 250, 'mm', 85, 3, 87.00],
  ['FRE-DIS', 'Discos de freno', 'Disco de freno', 190, 'mm', 210, 5, 119.00],
  ['FRE-ZAP', 'Zapatas de freno', 'Juego de zapatas de freno', 110, 'mm', 120, 4, 72.00],
  ['FRE-TAM', 'Tambores de freno', 'Tambor de freno', 90, 'mm', 160, 5, 105.00],
  ['FRE-KIT', 'Kits de freno', 'Kit de reparación de freno', 110, 'mm', 60, 2, 54.00],
  ['ELE-BAT', 'Baterías', 'Batería 12 V', 170, 'Ah', 35, 3, 245.00],
  ['ELE-BUJ', 'Bujías', 'Bujía de encendido', 180, 'mm', 14, 1, 15.00],
  ['ELE-SEN', 'Sensores eléctricos', 'Sensor eléctrico', 240, 'mm', 20, 2, 62.00],
  ['ELE-ALT', 'Alternadores', 'Alternador', 130, 'A', 70, 5, 310.00],
  ['ELE-ARR', 'Motores de arranque', 'Motor de arranque', 90, 'kW', 1, 1, 295.00],
  ['ELE-LUZ', 'Iluminación', 'Lámpara automotriz', 180, 'W', 5, 2, 12.00],
  ['ELE-FUS', 'Fusibles y relés', 'Fusible o relé', 140, 'A', 5, 2, 7.00],
  ['SUS-AMP', 'Amortiguadores', 'Amortiguador', 210, 'mm', 250, 8, 145.00],
  ['SUS-RES', 'Resortes', 'Resorte de suspensión', 100, 'mm', 180, 6, 96.00],
  ['SUS-ROT', 'Rótulas', 'Rótula', 130, 'mm', 20, 2, 52.00],
  ['SUS-BUJ', 'Bujes', 'Buje de suspensión', 140, 'mm', 18, 2, 23.00],
  ['SUS-TER', 'Terminales de dirección', 'Terminal de dirección', 120, 'mm', 75, 3, 61.00],
  ['MOT-COR', 'Correas', 'Correa de transmisión', 150, 'mm', 700, 15, 48.00],
  ['MOT-MAN', 'Mangueras', 'Manguera', 110, 'mm', 120, 10, 33.00],
  ['MOT-TER', 'Termostatos', 'Termostato', 80, '°C', 75, 2, 58.00],
  ['MOT-BOM', 'Bombas de agua', 'Bomba de agua', 90, 'mm', 70, 4, 118.00],
  ['MOT-EMB', 'Embragues', 'Kit de embrague', 90, 'mm', 180, 5, 280.00],
  ['TAL-CON', 'Consumibles de taller', 'Consumible de taller', 250, 'g', 50, 10, 6.00],
];

const grades = ['estándar', 'reforzado', 'alta duración', 'compacto'];
const fitTypes = ['tipo A', 'tipo B', 'tipo C'];
const categories = groups.map(([code, name]) => ({ code, name }));
const suppliers = Array.from({ length: 60 }, (_, index) => ({
  codigo: `SIM-PROV-${String(index + 1).padStart(3, '0')}`,
  razonSocial: `Proveedor ficticio de repuestos ${String(index + 1).padStart(2, '0')}`,
  correo: `proveedor${String(index + 1).padStart(2, '0')}@example.invalid`,
}));
const products = [];
for (const [categoryCode, categoryName, label, count, unit, firstSize, step, basePrice] of groups) {
  for (let i = 0; i < count; i++) {
    const ordinal = products.length;
    const min = 2 + (ordinal % 9);
    const stateIndex = ordinal % 50;
    const stock = stateIndex < 3 ? 0 : stateIndex < 13 ? 1 + (ordinal % min) : min + 5 + (ordinal % 27);
    const grade = grades[Math.floor(i / 25) % grades.length];
    const mounting = fitTypes[Math.floor(i / 100) % fitTypes.length];
    const size = firstSize + (i % 25) * step;
    products.push({
      sku: `SIM-${categoryCode}-${String(i + 1).padStart(4, '0')}`,
      nombre: `${label} ${size} ${unit}, ${grade}, ${mounting}`,
      categoria: categoryName,
      stockMinimo: min,
      precioCompra: (basePrice + (i % 25) * 1.35 + Math.floor(i / 25) % 4 * 3.5).toFixed(2),
      stockInicial: stock,
      estado: stock === 0 ? 'AGOTADO' : stock <= min ? 'BAJO_MINIMO' : 'NORMAL',
    });
  }
}

const skus = new Set(products.map((item) => item.sku));
const names = new Set(products.map((item) => item.nombre));
if (categories.length !== 36 || products.length !== 5000 || suppliers.length !== 60 || skus.size !== 5000 ||
  names.size !== 5000 || products.some((item) => item.sku.length > 40 || item.nombre.length > 150)) {
  throw new Error('La vista previa no cumple los controles de tamaño, unicidad o longitud.');
}
const counts = Object.fromEntries(['NORMAL', 'BAJO_MINIMO', 'AGOTADO'].map((state) =>
  [state, products.filter((item) => item.estado === state).length]));
if (counts.NORMAL !== 3700 || counts.BAJO_MINIMO !== 1000 || counts.AGOTADO !== 300) {
  throw new Error('La distribución de estados no coincide con el plan.');
}
const output = { version: 1, purpose: 'VISTA_PREVIA_NO_CARGADA', generatedDate: '2026-11-11',
  note: 'Datos ficticios. Sin marcas, compatibilidad vehicular, ubicación ni vínculo producto-proveedor.',
  summary: { categories: categories.length, products: products.length, suppliers: suppliers.length,
    states: counts, initialUnits: products.reduce((sum, item) => sum + item.stockInicial, 0) },
  categories, suppliers, products };
const path = fileURLToPath(new URL('./inventario-demo-5000.preview.json', import.meta.url));
await mkdir(fileURLToPath(new URL('./', import.meta.url)), { recursive: true });
await writeFile(path, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output.summary));
