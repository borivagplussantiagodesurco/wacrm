"use client";

import { useEffect, useRef } from "react";

/**
 * Vuelve a ejecutar `refresh` cuando la pestaña pasa de oculta a visible,
 * para que las pantallas de datos (tareas, radar, catálogo) no muestren
 * información vieja tras horas en segundo plano. `refresh` se guarda en un
 * ref: cambiar su identidad no re-suscribe el listener.
 */
export function useRefreshOnFocus(refresh: () => void) {
  const ref = useRef(refresh);
  useEffect(() => {
    ref.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") ref.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
}
