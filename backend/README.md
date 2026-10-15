# Backend — API REST

Node.js + Express + TypeScript, con Prisma ORM sobre SQLite (PostgreSQL en producción). Se desarrolla en la Fase 3 (15/10 – 11/11/2026).

## Estructura prevista

```
backend/
├── prisma/schema.prisma           # copia de database/schema.prisma
└── src/
    ├── db/prisma.ts               # instancia única de PrismaClient (Singleton)
    ├── middlewares/               # jwt, roles, validación Zod, errores (Chain of Responsibility)
    ├── modules/
    │   ├── auth/                  # login, JWT, bcryptjs
    │   ├── productos/             # productos y categorías
    │   ├── proveedores/
    │   ├── inventario/            # InventarioFacade.registrarSalida() (Facade)
    │   ├── movimientos/
    │   ├── reportes/              # usa las vistas v_inventario y v_kardex
    │   └── notificaciones/        # NotificadorStock (Observer, State) y canales (Strategy)
    ├── events/                    # EventEmitter con el evento STOCK_ACTUALIZADO
    └── app.ts                     # rutas /api/v1 y health check
```
