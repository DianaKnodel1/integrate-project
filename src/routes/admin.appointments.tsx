import { createFileRoute } from "@tanstack/react-router";
import { useAdminData } from "@/contexts/AdminDataContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Clock, User, Phone, ExternalLink, Briefcase } from "lucide-react";
import { TableSkeleton, PageHeaderSkeleton } from "@/components/SkeletonLoaders";
import { useNavigate } from "@/lib/router-compat";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/appointments")({
  component: AdminAppointmentsPage,
});

function AdminAppointmentsPage() {
  const { allBookings, profiles, loading } = useAdminData();
  const navigate = useNavigate();

  if (loading) return <div className="p-6 space-y-4"><PageHeaderSkeleton /><TableSkeleton /></div>;

  // Filter for employee bookings (excluding recruitment interviews)
  const employeeBookings = allBookings.filter((b: any) => {
    // If it has a user_id and NO application_id, it's definitely an employee task booking.
    // If it has an assignment_id, it's a booking for a specific task.
    return b.user_id && !b.application_id;
  });

  const sortedBookings = [...employeeBookings].sort((a: any, b: any) => {
    const dateA = a.booking_date && a.booking_time ? `${a.booking_date}T${a.booking_time}` : (a.scheduled_at || "");
    const dateB = b.booking_date && b.booking_time ? `${b.booking_date}T${b.booking_time}` : (b.scheduled_at || "");
    return dateB.localeCompare(dateA);
  });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
          <CalendarDays className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold">Mitarbeiter-Termine</h1>
          <p className="text-sm text-muted-foreground">Übersicht der Termine, die Mitarbeiter im Portal gebucht haben.</p>
        </div>
      </div>

      <div className="grid gap-4">
        {sortedBookings.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Keine Termine gefunden
            </CardContent>
          </Card>
        ) : (
          sortedBookings.map((b: any) => {
            const date = b.booking_date || (b.scheduled_at ? new Date(b.scheduled_at).toLocaleDateString("en-CA") : "—");
            const time = b.booking_time || (b.scheduled_at ? new Date(b.scheduled_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "—");
            const isPast = new Date(`${date}T${time}`).getTime() < Date.now();
            
            // Try to find if this booking belongs to an existing profile
            const profile = b.user_id ? profiles.find((p: any) => p.user_id === b.user_id) : null;
            const application = null; // Removed application lookup for employee appointments

            return (
              <Card key={b.id} className={isPast ? "opacity-60" : ""}>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-[200px]">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <Clock className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="font-bold flex items-center gap-2">
                        {new Date(date).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}
                        <Badge variant="outline" className="font-mono">{time}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {b.type || "Mitarbeiter-Auftragstermin"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 flex-1 min-w-[300px]">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <div className="text-sm">
                        <div className="font-medium">
                          {b.full_name || profile?.full_name || b.name || "Mitarbeiter"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {b.email || profile?.email || (application as any)?.email || "Keine E-Mail"}
                        </div>
                      </div>
                    </div>
                    {(b.phone || profile?.phone || (application as any)?.phone) && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{b.phone || profile?.phone || (application as any)?.phone}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={b.status === "cancelled" ? "destructive" : "secondary"}>
                      {b.status === "cancelled" ? "Storniert" : b.status === "no_show" ? "No-Show" : "Bestätigt"}
                    </Badge>
                    <div className="flex gap-1 ml-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => navigate(`/admin/mitarbeiter`)}
                      >
                        <Briefcase className="h-3.5 w-3.5" /> Zuweisen
                      </Button>
                      {(b.user_id || profile?.id) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5"
                          onClick={() => navigate(`/admin/personen/${profile?.id || b.user_id}`)}
                        >
                          Details <ExternalLink className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
