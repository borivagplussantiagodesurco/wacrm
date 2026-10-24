"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlarmClock, MessageSquare, Radar as RadarIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { Button, buttonVariants } from "@/components/ui/button";

interface RadarRow {
  id: string;
  contact_id: string;
  unread_count: number;
  last_message_text: string | null;
  last_message_at: string | null;
  contact: { name: string | null; phone: string } | null;
}

const THRESHOLDS = [24, 48, 72, 168] as const;

function ago(iso: string | null, now: number, t: (k: string, v?: Record<string, number>) => string) {
  if (!iso) return "—";
  const hours = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 3_600_000));
  return hours < 48 ? t("hoursAgo", { count: hours }) : t("daysAgo", { count: Math.floor(hours / 24) });
}

export default function RadarPage() {
  const t = useTranslations("Radar");
  const supabase = useMemo(() => createClient(), []);
  const { accountId, user } = useAuth();
  const canWrite = useCan("send-messages");

  const [rows, setRows] = useState<RadarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState<number>(48);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("conversations")
      .select(
        "id,contact_id,unread_count,last_message_text,last_message_at,contact:contacts(name,phone)",
      )
      .eq("status", "open")
      .not("last_message_at", "is", null)
      .order("last_message_at", { ascending: true })
      .limit(300);
    if (error) toast.error(t("loadError"));
    setRows((data ?? []) as unknown as RadarRow[]);
    setNow(Date.now());
    setLoading(false);
  }, [supabase, t]);

  useEffect(() => {
    // Carga inicial: la función solo actualiza estado tras el await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const cutoff = now - hours * 3_600_000;
  // "Esperando": el cliente escribió y nadie respondió (mensajes sin leer).
  const waiting = rows.filter((r) => r.unread_count > 0);
  // "Enfriados": ya se le respondió pero el hilo murió hace más de N horas.
  const cooled = rows.filter(
    (r) => r.unread_count === 0 && new Date(r.last_message_at as string).getTime() < cutoff,
  );

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
            className={`rounded-full px-2 py-0.5 text-xs ${urgent && list.length ? "bg-red-500/15 text-red-400" : "bg-muted text-muted-foreground"}`}
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
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.contact?.name || r.contact?.phone}</p>
                <p className="truncate text-sm text-muted-foreground">{r.last_message_text}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{ago(r.last_message_at, now, t)}</span>
              <Link
                href={`/inbox?c=${r.id}`}
                className={buttonVariants({ size: "sm", variant: "outline" })}
              >
                <MessageSquare className="mr-1 h-4 w-4" /> {t("open")}
              </Link>
              {canWrite && (
                <Button size="sm" variant="ghost" onClick={() => followUp(r)}>
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
      ) : (
        <>
          {section(t("waitingTitle"), t("waitingHint"), waiting, true)}
          {section(t("cooledTitle"), t("cooledHint"), cooled, false)}
        </>
      )}
    </div>
  );
}
