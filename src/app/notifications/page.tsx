import { redirect } from "next/navigation";

// Notification preferences are live at /account/notifications (Daily Challenge
// Alerts). This former stub route is kept as a redirect so old menu links and
// bookmarks never 404.
export default function NotificationsPage() {
  redirect("/account/notifications");
}
