"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Circle, ListChecks, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
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
  const supabase = useMemo(() => createClient(), []);
  const { accountId, user } = useAuth();
  const canWrite = useCan("send-messages");

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);
  const [filter, setFilter] = useState<Filter>("pending");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [contactId, setContactId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [tasksRes, contactsRes] = await Promise.all([
      supabase
        .from("crm_tasks")
        .select(
          "id,title,notes,due_at,done_at,contact_id,contact:contacts(name,phone)",
        )
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(500),
      supabase
        .from("contacts")
        .select("id,name,phone")
        .order("updated_at", { ascending: false })
        .limit(200),
    ]);
    if (tasksRes.error) toast.error(t("loadError"));
    setTasks((tasksRes.data ?? []) as unknown as TaskRow[]);
    setContacts((contactsRes.data ?? []) as ContactOption[]);
    setNow(Date.now());
    setLoading(false);
  }, [supabase, t]);

  useEffect(() => {
    // Carga inicial: la función solo actualiza estado tras el await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const isOverdue = (r: TaskRow) =>
    !r.done_at && !!r.due_at && new Date(r.due_at).getTime() < now;
  const visible = tasks.filter((r) =>
    filter === "done" ? !!r.done_at : filter === "overdue" ? isOverdue(r) : !r.done_at,
  );
  const overdueCount = tasks.filter(isOverdue).length;

  async function create() {
    if (!accountId || !title.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("crm_tasks").insert({
      account_id: accountId,
      created_by: user?.id ?? null,
      assigned_to: user?.id ?? null,
      title: title.trim(),
      notes: notes.trim() || null,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      contact_id: contactId || null,
    });
    setSaving(false);
    if (error) return toast.error(t("saveError"));
    toast.success(t("created"));
    setOpen(false);
    setTitle("");
    setNotes("");
    setDueAt("");
    setContactId("");
    void load();
  }

  async function toggle(r: TaskRow) {
    const { error } = await supabase
      .from("crm_tasks")
      .update({ done_at: r.done_at ? null : new Date().toISOString() })
      .eq("id", r.id);
    if (error) return toast.error(t("saveError"));
    void load();
  }

  async function remove(r: TaskRow) {
    const { error } = await supabase.from("crm_tasks").delete().eq("id", r.id);
    if (error) return toast.error(t("saveError"));
    void load();
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
        <GatedButton canAct={canWrite} gateReason="create tasks" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> {t("new")}
        </GatedButton>
      </div>

      <div className="flex gap-2">
        {filters.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
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
                className="mt-0.5 text-muted-foreground hover:text-primary disabled:opacity-50"
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
                  <p className={`mt-1 text-xs ${isOverdue(r) ? "font-medium text-red-400" : "text-muted-foreground"}`}>
                    {t("due")}: {new Date(r.due_at).toLocaleString()}
                  </p>
                )}
              </div>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => remove(r)}
                  aria-label={t("delete")}
                  className="text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
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
              <select
                id="task-contact"
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t("noContact")}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-notes">{t("fieldNotes")}</Label>
              <Input id="task-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
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
