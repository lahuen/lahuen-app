import type { Timestamp } from 'firebase/firestore';

export interface Prospecto {
  id?: string;
  local: string;
  contacto: string;
  whatsapp: string;
  perfil: PerfilType;
  zona: string;
  segmento: SegmentoType;
  direccion: string;
  resultado: ResultadoType;
  fechaVisita: Timestamp | null;
  fechaSeguimiento: Timestamp | null;
  productosInteres: string;
  notas: string;
  vendedor: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy?: string;
}

export type PerfilType =
  | 'restaurante' | 'hotel' | 'bar' | 'dietetica' | 'revendedor'
  | 'mercado' | 'distribuidor' | 'feria' | 'supermercado' | 'comunidad' | 'otro';

export type SegmentoType = 'premium' | 'medio' | 'volumen' | 'corporativo' | '';

export type ResultadoType =
  | 'pendiente' | 'contactado' | 'entrega_prueba' | 'cliente' | 'no_interesado';

export interface Producto {
  id?: string;
  nombre: string;
  cantidad: number;
  unidad: string;
  precio: number;
  proveedor: string;
  lote: string;
  imagen: string;
  vencimiento: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy?: string;
}

export interface Usuario {
  email: string;
  nombre: string;
  role: 'admin' | 'miembro';
}

export interface Lote {
  id?: string;
  productoId: string;
  productoNombre: string;
  numero: string;
  cantidad: number;
  precio?: number;
  vencimiento: Timestamp | null;
  ubicacion: string;
  fechaIngreso: Timestamp;
  createdBy: string;
  createdAt: Timestamp;
}

export interface AuditEntry {
  action: 'create' | 'update' | 'delete';
  collection: string;
  docId: string;
  docLabel: string;
  userEmail: string;
  userId: string;
  timestamp: Timestamp;
  changes?: string;
}

export interface Movimiento {
  id?: string;
  tipo: 'entrada' | 'salida';
  productoId: string;
  productoNombre: string;
  cantidad: number;
  fecha: Timestamp;
  motivo: 'cosecha' | 'compra' | 'venta' | 'merma' | 'devolucion' | 'ajuste' | 'anulacion';
  vendedor: string;
  createdBy: string;
  createdAt: Timestamp;
  loteId?: string;
  prospectoId?: string;
  prospectoLocal?: string;
  precioVenta?: number;
  anulacionDe?: string;
  siembraId?: string;
}

export type SiembraEstado = 'activa' | 'cosechada' | 'cancelada';

export interface Siembra {
  id?: string;
  productoId: string;
  productoNombre: string;
  cantidad: number;
  fechaSiembra: Timestamp;
  estimadoCosecha: Timestamp;
  mermaEstimada: number;
  ubicacion: string;
  estado: SiembraEstado;
  cantidadCosechada?: number;
  fechaCosecha?: Timestamp;
  notas: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy?: string;
}
