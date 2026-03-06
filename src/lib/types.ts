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
  vencimiento: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export interface Movimiento {
  id?: string;
  tipo: 'entrada' | 'salida';
  productoId: string;
  productoNombre: string;
  cantidad: number;
  fecha: Timestamp;
  motivo: 'cosecha' | 'compra' | 'venta' | 'merma' | 'devolucion' | 'ajuste';
  vendedor: string;
  createdBy: string;
  createdAt: Timestamp;
  prospectoId?: string;
  prospectoLocal?: string;
  precioVenta?: number;
}
