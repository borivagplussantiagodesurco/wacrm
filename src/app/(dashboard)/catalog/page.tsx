"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { formatPrice } from "@/lib/currency";
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

interface Product {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  price: number;
  currency: string;
  stock: number | null;
  active: boolean;
}

const EMPTY = {
  name: "",
  sku: "",
  description: "",
  price: "",
  currency: "",
  stock: "",
  active: true,
};

export default function CatalogPage() {
  const t = useTranslations("Catalog");
  const supabase = useMemo(() => createClient(), []);
  const { accountId, account } = useAuth();
  const canEdit = useCan("edit-settings");

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const defaultCurrency = account?.default_currency ?? "USD";

  // `silent` = recarga en segundo plano: si falla y ya hay datos, se conservan.
  const load = useCallback(
    async (silent = false) => {
      try {
        const { data, error } = await supabase
          .from("catalog_products")
          .select("id,name,sku,description,price,currency,stock,active")
          .order("name", { ascending: true })
          .limit(500);
        if (error) throw error;
        setProducts((data ?? []) as Product[]);
        setLoadFailed(false);
      } catch {
        if (!silent) setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    // Carga inicial: la función solo actualiza estado tras el await.
    void load();
  }, [load]);

  // Al volver a la pestaña se refresca el catálogo (otro miembro pudo editarlo).
  useRefreshOnFocus(() => void load(true));

  function openNew() {
    setEditingId(null);
    setForm({ ...EMPTY, currency: defaultCurrency });
    setOpen(true);
  }

  function openEdit(p: Product) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      sku: p.sku ?? "",
      description: p.description ?? "",
      price: String(p.price),
      currency: p.currency,
      stock: p.stock === null ? "" : String(p.stock),
      active: p.active,
    });
    setOpen(true);
  }

  async function save() {
    if (!accountId || !form.name.trim()) return;
    // Acepta coma decimal ("1,5"): se normaliza a punto antes de convertir.
    const priceText = form.price.trim().replace(",", ".");
    const stockText = form.stock.trim().replace(",", ".");
    const price = priceText === "" ? 0 : Number(priceText);
    const stock = stockText === "" ? null : Math.trunc(Number(stockText));
    if (!Number.isFinite(price) || price < 0) return toast.error(t("invalidPrice"));
    if (stock !== null && (!Number.isFinite(stock) || stock < 0)) {
      return toast.error(t("invalidStock"));
    }
    const currency = (form.currency || defaultCurrency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return toast.error(t("invalidCurrency"));
    const row = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      description: form.description.trim() || null,
      price,
      currency,
      stock,
      active: form.active,
    };
    setSaving(true);
    let failure: { code?: string } | null = null;
    try {
      const { error } = editingId
        ? await supabase.from("catalog_products").update(row).eq("id", editingId)
        : await supabase.from("catalog_products").insert({ ...row, account_id: accountId });
      failure = error;
    } catch {
      failure = {};
    } finally {
      setSaving(false);
    }
    if (failure) {
      return toast.error(failure.code === "23505" ? t("skuDuplicate") : t("saveError"));
    }
    toast.success(t("saved"));
    setOpen(false);
    void load(true);
  }

  async function remove(p: Product) {
    if (!window.confirm(t("confirmDelete", { name: p.name }))) return;
    try {
      const { error } = await supabase.from("catalog_products").delete().eq("id", p.id);
      if (error) throw error;
    } catch {
      return toast.error(t("saveError"));
    }
    toast.success(t("deleted"));
    void load(true);
  }

  const set = (k: keyof typeof EMPTY, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Package className="h-5 w-5" /> {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <GatedButton canAct={canEdit} gateReason="editCatalog" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" /> {t("new")}
        </GatedButton>
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
      ) : products.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">{t("colName")}</th>
                <th className="p-3">{t("colSku")}</th>
                <th className="p-3 text-right">{t("colPrice")}</th>
                <th className="p-3 text-right">{t("colStock")}</th>
                <th className="p-3">{t("colStatus")}</th>
                <th className="p-3">
                  <span className="sr-only">{t("colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="p-3">
                    <p className="font-medium">{p.name}</p>
                    {p.description && (
                      <p className="line-clamp-1 text-xs text-muted-foreground">{p.description}</p>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">{p.sku ?? "—"}</td>
                  <td className="p-3 text-right tabular-nums">
                    {formatPrice(Number(p.price), p.currency)}
                  </td>
                  <td
                    className={`p-3 text-right tabular-nums ${p.stock === 0 ? "font-medium text-red-600 dark:text-red-400" : ""}`}
                  >
                    {p.stock ?? "—"}
                  </td>
                  <td className="p-3">{p.active ? t("active") : t("inactive")}</td>
                  <td className="p-3">
                    {canEdit && (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          aria-label={t("edit")}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-primary"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(p)}
                          aria-label={t("delete")}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? t("edit") : t("new")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="p-name">{t("colName")}</Label>
              <Input id="p-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="p-sku">{t("colSku")}</Label>
                <Input id="p-sku" value={form.sku} onChange={(e) => set("sku", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p-stock">{t("colStock")}</Label>
                <Input
                  id="p-stock"
                  inputMode="numeric"
                  placeholder={t("stockPlaceholder")}
                  value={form.stock}
                  onChange={(e) => set("stock", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p-price">{t("colPrice")}</Label>
                <Input
                  id="p-price"
                  inputMode="decimal"
                  value={form.price}
                  onChange={(e) => set("price", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p-cur">{t("fieldCurrency")}</Label>
                <Input
                  id="p-cur"
                  maxLength={3}
                  value={form.currency}
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-desc">{t("fieldDescription")}</Label>
              <Input
                id="p-desc"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set("active", e.target.checked)}
              />
              {t("active")}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
