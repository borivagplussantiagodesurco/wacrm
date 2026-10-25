import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

/**
 * Chequeo de salud.
 *
 * - Sin credenciales: solo confirma que la app responde (`{ ok: true }`).
 *   No toca la base de datos, así que es seguro dejarlo público para un
 *   monitor externo (UptimeRobot, etc.).
 * - Con `x-cron-secret` válido (el mismo `AUTOMATION_CRON_SECRET` que usan
 *   los cron): además hace una lectura mínima en Supabase. Esa lectura es la
 *   "actividad" que evita que el plan gratis pause el proyecto tras 7 días
 *   sin uso, y devuelve 503 si la base no responde para que el workflow de
 *   GitHub Actions falle de forma visible.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  const supplied = request.headers.get('x-cron-secret')

  if (!supplied) {
    return NextResponse.json({ ok: true })
  }
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }

  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabaseAdmin()
    .from('accounts')
    .select('id', { head: true, count: 'exact' })
    .limit(1)

  if (error) {
    console.error('[health] database check failed:', error.message)
    return NextResponse.json({ ok: false, db: false }, { status: 503 })
  }
  return NextResponse.json({ ok: true, db: true })
}
