"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Circle, ListChecks, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  done_at: string | null;
  contact_id: string | null;
  contact: { name: string | null; phone: string } | null;
}

interface ContactOption {
  id: string;
  name: string | null;
  phone: string;
}

type Filter = "pending" | "overdue" | "done";

export default function TasksPage() {
  const t = useTranslations("Tasks");
  const locale = useLocale();
  const supabase = useMemo(() => createClient(), []);
  const { accountId, user } = useAuth();
  const canWrite = useCan("send-messages");

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(0);
  const [filter, setFilter] = useState<Filter>("pending");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);
  // Selector de contactos con búsqueda: consulta el servidor (name/phone,
  // máx. 20) en vez de precargar solo los 200 más recientes.
  const [contactQuery, setContactQuery] = useState("");
  const [contactResults, setContactResults] = useState<ContactOption[]>([]);
  const [contactSel, setContactSel] = useState<ContactOption | null>(null);
  const searchSeq = useRef(0);

  // `silent` = recarga en segundo plano (volver a la pestaña): si falla y ya
  // hay datos, se conservan en vez de reemplazarlos por una pantalla de error.
  const load = useCallback(
    async (silent = false) => {
      try {
        const { data, error } = await supabase
          .from("crm_tasks")
          .select(
            "id,title,notes,due_at,done_at,contact_id,contact:contacts(name,phone)",
          )
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(500);
        if (error) throw error;
        setTasks((data ?? []) as unknown as TaskRow[]);
        setLoadFailed(false);
      } catch {
        if (!silent) setLoadFailed(true);
      } finally {
        setNow(Date.now());
        setLoading(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    // Carga inicial: la función solo actualiza estado tras el await.
    void load();
  }, [load]);

  // Al volver a la pestaña se refresca; y "ahora" se recalcula cada minuto
  // para que lo vencido aparezca sin recargar la página.
  useRefreshOnFocus(() => void load(true));
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Búsqueda de contactos (solo con el diálogo abierto y sin contacto elegido).
  useEffect(() => {
    if (!open || contactSel) return;
    const seq = ++searchSeq.current;
    const handle = setTimeout(async () => {
      // Se quitan los caracteres con significado en el filtro `or()` y en
      // `ilike` (coma, paréntesis, %, _, \) para que no alteren la consulta.
      const q = contactQuery.replace(/[%_,()\\*]/g, " ").trim();
      let query = supabase
        .from("contacts")
        .select("id,name,phone")
        .order("updated_at", { ascending: false })
        .limit(20);
      if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
      try {
        const { data, error } = await query;
        if (seq === searchSeq.current) {
          setContactResults(error ? [] : ((data ?? []) as ContactOption[]));
        }
      } catch {
        if (seq === searchSeq.current) setContactResults([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [open, contactSel, contactQuery, supabase]);

  const isOverdue = (r: TaskRow) =>
    !r.done_at && !!r.due_at && new Date(r.due_at).getTime() < now;
  const visible = tasks.filter((r) =>
    filter === "done" ? !!r.done_at : filter === "overdue" ? isOverdue(r) : !r.done_at,
  );
  const overdueCount = tasks.filter(isOverdue).length;

  function resetForm() {
    setTitle("");
    setNotes("");
    setDueAt("");
    setContactQuery("");
    setContactResults([]);
    setContactSel(null);
  }

  function openNew() {
    resetForm();
    setOpen(true);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    setOpen(next);
  }

  async function create() {
    if (!accountId || !title.trim()) return;
    setSaving(true);
    let failed = false;
    try {
      const { error } = await supabase.from("crm_tasks").insert({
        account_id: accountId,
        created_by: user?.id ?? null,
        assigned_to: user?.id ?? null,
        title: title.trim(),
        notes: notes.trim() || null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        contact_id: contactSel?.id ?? null,
      });
      failed = !!error;
    } catch {
      failed = true;
    } finally {
      setSaving(false);
    }
    if (failed) return toast.error(t("saveError"));
    toast.success(t("created"));
    handleOpenChange(false);
    void load(true);
  }

  async function toggle(r: TaskRow) {
    try {
      const { error } = await supabase
        .from("crm_tasks")
        .update({ done_at: r.done_at ? null : new Date().toISOString() })
        .eq("id", r.id);
      if (error) throw error;
    } catch {
      return toast.error(t("saveError"));
    }
    void load(true);
  }

  async function remove(r: TaskRow) {
    if (!window.confirm(t("confirmDelete", { title: r.title }))) return;
    try {
      const { error } = await supabase.from("crm_tasks").delete().eq("id", r.id);
      if (error) throw error;
    } catch {
      return toast.error(t("saveError"));
    }
    toast.success(t("deleted"));
    void load(true);
  }

  const filters: { key: Filter; label: string }[] = [
    { key: "pending", label: t("filterPending") },
    { key: "overdue", label: `${t("filterOverdue")}${overdueCount ? ` (${overdueCount})` : ""}` },
    { key: "done", label: t("filterDone") },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <ListChecks className="h-5 w-5" /> {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <GatedButton canAct={canWrite} gateReason="createTasks" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" /> {t("new")}
        </GatedButton>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("filtersLabel")}>
        {filters.map((f) => (
          <Button
            key={f.key}
            size="sm"
            aria-pressed={filter === f.key}
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
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
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => (
            <li
              key={r.id}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
            >
              <button
                type="button"
                disabled={!canWrite}
                onClick={() => toggle(r)}
                aria-label={r.done_at ? t("reopen") : t("complete")}
                className="-m-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-primary disabled:opacity-50"
              >
                {r.done_at ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : (
                  <Circle className="h-5 w-5" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className={r.done_at ? "text-muted-foreground line-through" : "font-medium"}>
                  {r.title}
                </p>
                {r.contact && (
                  <p className="text-xs text-muted-foreground">
                    {r.contact.name || r.contact.phone}
                  </p>
                )}
                {r.notes && <p className="mt-1 text-sm text-muted-foreground">{r.notes}</p>}
                {r.due_at && (
                  <p className={`mt-1 text-xs ${isOverdue(r) ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                    {t("due")}: {new Date(r.due_at).toLocaleString(locale)}
                  </p>
                )}
              </div>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => remove(r)}
                  aria-label={t("delete")}
                  className="-m-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("new")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="task-title">{t("fieldTitle")}</Label>
              <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-due">{t("fieldDue")}</Label>
              <Input id="task-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-contact">{t("fieldContact")}</Label>
              {contactSel ? (
                <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm">
                  <span className="truncate">{contactSel.name || contactSel.phone}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setContactSel(null);
                      setContactQuery("");
                    }}
                    aria-label={t("contactClear")}
                    className="-mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    id="task-contact"
                    value={contactQuery}
                    onChange={(e) => setContactQuery(e.target.value)}
                    placeholder={t("contactSearchPlaceholder")}
                    autoComplete="off"
                  />
                  <ul className="max-h-40 overflow-y-auto rounded-md border border-border">
                    {contactResults.length === 0 ? (
                      <li className="p-2 text-xs text-muted-foreground">{t("contactNoResults")}</li>
                    ) : (
                      contactResults.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setContactSel(c)}
                            className="flex min-h-9 w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                          >
                            <span className="truncate">{c.name || c.phone}</span>
                            {c.name && (
                              <span className="shrink-0 text-xs text-muted-foreground">{c.phone}</span>
                            )}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-notes">{t("fieldNotes")}</Label>
              <Input id="task-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={create} disabled={saving || !title.trim()}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
