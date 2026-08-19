// Automatische Auftragszuweisung für Termine.
// Regel: ein Mitarbeiter erhält dieselbe Auftragsvorlage NIE doppelt.
import { supabase } from "@/integrations/supabase/client";

export interface AutoAssignSlot {
  id: string;
  userId: string | null;
  assignmentId: string | null;
  dateStr: string;
  timeStr: string;
}

interface Assignment { user_id: string; task_template_id: string }
interface Template { id: string; is_active: boolean }

/** Plant, welche Vorlage welchem Termin zugewiesen würde – ohne Dubletten. */
export function planAutoAssignments(
  slots: AutoAssignSlot[],
  assignments: Assignment[],
  templates: Template[],
): { slot: AutoAssignSlot; templateId: string }[] {
  const active = templates.filter((t) => t.is_active);
  const taken = new Set(assignments.map((a) => `${a.user_id}::${a.task_template_id}`));
  const plan: { slot: AutoAssignSlot; templateId: string }[] = [];

  for (const slot of slots) {
    if (!slot.userId || slot.assignmentId) continue;
    const next = active.find((t) => !taken.has(`${slot.userId}::${t.id}`));
    if (!next) continue;
    taken.add(`${slot.userId}::${next.id}`);
    plan.push({ slot, templateId: next.id });
  }
  return plan;
}

/** Führt den Plan aus: Zuweisung anlegen + Termin verknüpfen. */
export async function runAutoAssignments(
  plan: { slot: AutoAssignSlot; templateId: string }[],
): Promise<{ created: number; failed: number }> {
  let created = 0;
  let failed = 0;

  for (const { slot, templateId } of plan) {
    const releaseAt = slot.dateStr
      ? new Date(`${slot.dateStr}T${slot.timeStr || "09:00"}`).toISOString()
      : null;

    const { data, error } = await supabase
      .from("task_assignments")
      .insert({
        user_id: slot.userId!,
        task_template_id: templateId,
        status: "zugewiesen",
        release_at: releaseAt,
      })
      .select("id")
      .single();

    if (error || !data) { failed++; continue; }
    created++;
    await supabase.from("bookings").update({ assignment_id: data.id }).eq("id", slot.id);
  }

  return { created, failed };
}