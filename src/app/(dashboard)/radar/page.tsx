"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlarmClock, MessageSquare, Radar as RadarIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { Button, buttonVariants } from "@/components/ui/button";

interface RadarRow {
  id: string;
  contact_id: string;
  unread_count: number;
  last_message_text: string | null;
  last_message_at: string;
  contact: { name: string | null; phone: string } | null;
}

const THRESHOLDS = [24, 48, 72, 168] as const;
// Tope por lista: cada consulta trae como máximo estas conversaciones (las más recientes).
const LIST_LIMIT = 100;

const ROW_SELECT =
  "id,contact_id,unread_count,last_message_text,last_message_at,contact:contacts(name,phone)";

function ago(iso: string, now: number, t: (k: string, v?: Record<string, number>) => string) {
  const hours = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 3_600_000));
  return hours < 48 ? t("hoursAgo", { count: hours }) : t("daysAgo", { count: Math.floor(hours / 24) });
}

export default function RadarPage() {
  const t = useTranslations("Radar");
  const supabase = useMemo(() => createClient(), []);
  const { accountId, user } = useAuth();
  const canWrite = useCan("send-messages");

  const [waiting, setWaiting] = useState<RadarRow[]>([]);
  const [cooled, setCooled] = useState<RadarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hours, setHours] = useState<number>(48);
  const [now, setNow] = useState(0);

  // Dos consultas separadas: así las conversaciones recientes nunca quedan
  // fuera por culpa de un tope global (antes: 300 más antiguas primero).
  //  - "Esperando": el cliente escribió y nadie respondió (mensajes sin leer).
  //  - "Enfriados": ya se le respondió pero el hilo murió hace más de N horas.
  // `silent` = recarga en segundo plano: si falla y ya hay datos, se conservan.
  const load = useCallback(
    async (silent = false) => {
      const cutoffIso = new Date(Date.now() - hours * 3_600_000).toISOString();
      try {
        const [waitingRes, cooledRes] = await Promise.all([
          supabase
            .from("conversations")
            .select(ROW_SELECT)
            .eq("status", "open")
            .gt("unread_count", 0)
            .not("last_message_at", "is", null)
            .order("last_message_at", { ascending: false })
            .limit(LIST_LIMIT),
          supabase
            .from("conversations")
            .select(ROW_SELECT)
            .eq("status", "open")
            .eq("unread_count", 0)
            .lt("last_message_at", cutoffIso)
            .order("last_message_at", { ascending: false })
            .limit(LIST_LIMIT),
        ]);
        if (waitingRes.error || cooledRes.error) throw waitingRes.error ?? cooledRes.error;
        setWaiting((waitingRes.data ?? []) as unknown as RadarRow[]);
        setCooled((cooledRes.data ?? []) as unknown as RadarRow[]);
        setLoadFailed(false);
      } catch {
        if (!silent) setLoadFailed(true);
      } finally {
        setNow(Date.now());
        setLoading(false);
      }
    },
    [supabase, hours],
  );

  useEffect(() => {
    // Carga inicial y al cambiar el umbral: solo actualiza estado tras el await.
    void load();
  }, [load]);

  // Al volver a la pestaña se refresca; y "ahora" se recalcula cada minuto
  // para que los "hace X h" no se queden congelados.
  useRefreshOnFocus(() => void load(true));
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const capped = waiting.length >= LIST_LIMIT || cooled.length >= LIST_LIMIT;

  async function followUp(r: RadarRow) {
    if (!accountId) return;
    const due = new Date();
    due.setDate(due.getDate() + 1);
    due.setHours(9, 0, 0, 0);
    const { error } = await supabase.from("crm_tasks").insert({
      account_id: accountId,
      created_by: user?.id ?? null,
      assigned_to: user?.id ?? null,
      contact_id: r.contact_id,
      conversation_id: r.id,
      title: t("taskTitle", { name: r.contact?.name || r.contact?.phone || "" }),
      due_at: due.toISOString(),
    });
    if (error) return toast.error(t("taskError"));
    toast.success(t("taskCreated"));
  }

  const section = (title: string, hint: string, list: RadarRow[], urgent: boolean) => (
    <section className="space-y-2">
      <div>
        <h2 className="flex items-center gap-2 font-medium">
          {title}
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${urgent && list.length ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground"}`}
          >
            {list.length}
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {t("emptySection")}
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card p-3"
            >
              <div className="min-w-[10rem] flex-1 basis-40">
                <p className="truncate font-medium">{r.contact?.name || r.contact?.phone}</p>
                <p className="truncate text-sm text-muted-foreground">{r.last_message_text}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{ago(r.last_message_at, now, t)}</span>
              <Link
                href={`/inbox?c=${r.id}`}
                className={buttonVariants({ size: "sm", variant: "outline", className: "h-9 shrink-0" })}
              >
                <MessageSquare className="mr-1 h-4 w-4" /> {t("open")}
              </Link>
              {canWrite && (
                <Button size="sm" variant="ghost" className="h-9 shrink-0" onClick={() => followUp(r)}>
                  <AlarmClock className="mr-1 h-4 w-4" /> {t("followUp")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <RadarIcon className="h-5 w-5" /> {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          {t("coolAfter")}
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {THRESHOLDS.map((h) => (
              <option key={h} value={h}>
                {h < 48 ? t("hoursOption", { count: h }) : t("daysOption", { count: h / 24 })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : loadFailed ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-8 text-center"
        >
          <p className="text-sm font-medium text-red-600 dark:text-red-400">{t("loadError")}</p>
          <p className="text-xs text-muted-foreground">{t("loadErrorHint")}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            {t("retry")}
          </Button>
        </div>
      ) : (
        <>
          {capped && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {t("limitNotice", { count: LIST_LIMIT })}
            </p>
          )}
          {section(t("waitingTitle"), t("waitingHint"), waiting, true)}
          {section(t("cooledTitle"), t("cooledHint"), cooled, false)}
        </>
      )}
    </div>
  );
}
