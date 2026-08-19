# Plan: Restore Admin Appointments and Scheduling Overview

The user reported that booked appointments and the assignment process are no longer visible or working as before. We need to restore the "Termine" (Appointments) overview and ensure the flow from booking to assignment is clear and functional.

## User Review Required

> [!IMPORTANT]
> - Should the dashboard also show a "Live Feed" of current/upcoming appointments, or is the dedicated "Termine" page sufficient?
> - In the "Termine" list, do you want to see the specific source (Landing Page) for each booking directly in the card?

## Proposed Changes

### 1. Sidebar Restoration
- Ensure "Termine" is prominently visible in `AdminLayout.tsx` under the "Personen" group.
- Keep the existing navigation link to `/admin/appointments`.

### 2. Dashboard Integration
- Add an "Aktuelle Termine" (Current Appointments) widget to the `admin.index.tsx` (Dashboard).
- This will show the next 5 upcoming appointments so the admin sees them immediately upon login.

### 3. Appointments Page Optimization (`admin.appointments.tsx`)
- Enhance the sorting logic to ensure upcoming appointments are at the top, followed by recent past ones.
- Add a search/filter bar to find specific candidates or dates.
- Standardize the "Zuweisen" (Assign) action to point to the employee management page where tasks can be handled.
- Improve data resolution: Ensure that if a user has multiple bookings, the most relevant details (name, phone, email) are always shown.

### 4. Application Funnel Visibility (`admin.bewerbungen.tsx`)
- Verify that "Termin gebucht" and "Kein Termin" filters are working correctly to identify candidates who haven't moved forward yet.

## Technical Details

- **Route:** `src/routes/admin.appointments.tsx` will remain the main entry point.
- **Component:** A new `UpcomingBookings` widget will be added to `src/routes/admin.index.tsx`.
- **Data:** Use `allBookings` from `AdminDataContext` to drive all visualizations.
- **Navigation:** Standardize the link pattern `/admin/personen/:id` for detailed applicant views.
