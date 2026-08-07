import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRight, ChevronDown } from "lucide-react";

export type SmtpTrouble = { id: string; name: string; reason: string };

/** Sammelt Domains, deren Mails aktuell nicht rausgehen (Pause / kein SMTP / letzter Test fehlgeschlagen). */
export async function loadSmtpTrouble(): Promise<SmtpTrouble[]> {
  const [{ data: tenants }, { data: health }] = await Promise.all([
    supabase
      .from("tenants")
      .select("id,name,emails_paused,emails_paused_reason,smtp_host,smtp_username,smtp_password,sender_email"),
    supabase.from("tenant_smtp_health" as any).select("tenant_id,last_verify_ok,last_fail_error"),
  ]);
  const healthMap = new Map<string, any>(((health as any[]) ?? []).map(h => [String(h.tenant_id), h]));
  const trouble: SmtpTrouble[] = [];
  for (const t of ((tenants as any[]) ?? [])) {
    const configured = Boolean(t.smtp_host && t.smtp_username && t.smtp_password && t.sender_email);
    const h = healthMap.get(String(t.id));
    if (t.emails_paused) {
      trouble.push({ id: t.id, name: t.name, reason: t.emails_paused_reason || "Mail-Versand pausiert" });
    } else if (!configured) {
      trouble.push({ id: t.id, name: t.name, reason: "Keine SMTP-Zugangsdaten hinterlegt" });
    } else if (h?.last_verify_ok === false) {
      trouble.push({ id: t.id, name: t.name, reason: h.last_fail_error || "Letzter SMTP-Check fehlgeschlagen" });
    }
  }
  return trouble;
}

/**
 * Kompakte Mitteilung statt großem rotem Panel.
 * - variant="dashboard": eine Zeile auf dem Dashboard, Details aufklappbar.
 * - variant="inline": schmaler Hinweis (z. B. im E-Mail-Center).
 */
export function SmtpTroubleNotice({ variant = "dashboard" }: { variant?: "dashboard" | "inline" }) {
  const [trouble, setTrouble] = useState<SmtpTrouble[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSmtpTrouble()
      .then(t => { if (!cancelled) setTrouble(t); })
      .catch(() => { if (!cancelled) setTrouble([]); });
    return () => { cancelled = true; };
  }, []);

  if (!trouble || trouble.length === 0) return null;

  if (variant === "inline") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
        <span className="text-destructive font-medium">
          {trouble.length} Domain(s) können aktuell keine Mails versenden
        </span>
        <Link to="/admin/tenants" className="ml-auto text-primary inline-flex items-center gap-1">
          Domains prüfen <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  return (
    <Card className="border-destructive/40 bg-destructive/[0.03]">
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-xs font-medium text-foreground">
            {trouble.length} {trouble.length === 1 ? "Domain kann" : "Domains können"} aktuell keine Mails versenden
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] gap-1"
            onClick={() => setOpen(o => !o)}
          >
            Details <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
          <Link to="/admin/tenants" className="ml-auto">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] gap-1">
              Zu Domains <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
        {open && (
          <div className="mt-2 space-y-1 border-t border-border pt-2">
            <p className="text-[11px] text-muted-foreground">
              SMTP-Daten korrigieren und dort „SMTP testen“ klicken — bei Erfolg wird eine automatische Pause sofort aufgehoben.
            </p>
            {trouble.map(t => (
              <div key={t.id} className="flex items-center gap-3 text-[11px]">
                <span className="font-medium truncate max-w-[12rem]">{t.name}</span>
                <span className="flex-1 truncate text-muted-foreground">{t.reason}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}