import { NextResponse } from 'next/server'

/**
 * Respuesta 500 para errores de base de datos.
 *
 * El mensaje de Postgres/PostgREST revela nombres de tablas, columnas y
 * constraints, así que se registra en el servidor y al cliente solo le llega
 * un mensaje genérico.
 */
export function dbErrorResponse(error: { message?: string; code?: string } | null | undefined) {
  console.error('[api] database error:', error?.code ?? '', error?.message ?? error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
