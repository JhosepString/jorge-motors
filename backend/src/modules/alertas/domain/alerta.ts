export type NombreEstadoAlerta = 'PENDIENTE' | 'ENVIADA' | 'ATENDIDA';

interface EstadoAlerta {
  readonly nombre: NombreEstadoAlerta;
  notificacionAceptada(): EstadoAlerta;
  atender(): EstadoAlerta;
}

class Pendiente implements EstadoAlerta {
  readonly nombre = 'PENDIENTE';
  notificacionAceptada(): EstadoAlerta { return new Enviada(); }
  atender(): EstadoAlerta { return new Atendida(); }
}
class Enviada implements EstadoAlerta {
  readonly nombre = 'ENVIADA';
  notificacionAceptada(): EstadoAlerta { throw new Error('La alerta ya tiene una notificación aceptada.'); }
  atender(): EstadoAlerta { return new Atendida(); }
}
class Atendida implements EstadoAlerta {
  readonly nombre = 'ATENDIDA';
  notificacionAceptada(): EstadoAlerta { throw new Error('Una alerta atendida no puede volver a enviarse.'); }
  atender(): EstadoAlerta { throw new Error('La alerta ya fue atendida.'); }
}

// State GoF: cada objeto de estado decide qué comportamiento/transición admite.
export class Alerta {
  private state: EstadoAlerta;
  constructor(nombre: NombreEstadoAlerta = 'PENDIENTE') {
    switch (nombre) {
      case 'PENDIENTE': this.state = new Pendiente(); break;
      case 'ENVIADA': this.state = new Enviada(); break;
      case 'ATENDIDA': this.state = new Atendida(); break;
      default: throw new Error('Estado de alerta desconocido.');
    }
  }
  get estado(): NombreEstadoAlerta { return this.state.nombre; }
  notificacionAceptada(): void { this.state = this.state.notificacionAceptada(); }
  atender(): void { this.state = this.state.atender(); }
}

export function requiereAlerta(stock: number, minimo: number): boolean {
  for (const value of [stock, minimo]) {
    if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) throw new Error('Stock o mínimo inválido.');
  }
  return stock <= minimo;
}
